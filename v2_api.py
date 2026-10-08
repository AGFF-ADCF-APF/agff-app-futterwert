"""Futter v2 (Beta) – eigenstaendiges Blueprint.

Grundsatz: Die App speichert primaer im Browser. Der Server liefert nur
die Seite, die Agroscope-Nährwerttabelle (aus der bestehenden
futterwerte.csv) und – NUR nach ausdruecklicher Zustimmung – einen
"Freigabe-Bereich" (Space) pro Anlass, auf den mit einem geheimen
Schluessel zugegriffen wird. Keine Konten, keine Tracker.

Daten liegen in einer eigenen SQLite-Datei (data/v2.db), die alte
Datenbank wird nicht angefasst.
"""
import csv
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, redirect, render_template, request, send_from_directory

v2 = Blueprint('v2', __name__)

V2_DB_PATH = os.environ.get('V2_DB_PATH', 'data/v2.db')
V2_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'v2')
CSV_PATH = 'data/futterwerte.csv'
# Bei Aenderung des Zustimmungstextes im Frontend MUSS diese Version mitwachsen.
CONSENT_VERSION = '2026-10-a'
RETENTION_DAYS = int(os.environ.get('V2_RETENTION_DAYS', '730'))
PRIVACY_URL = os.environ.get('V2_PRIVACY_URL', '')
MAX_RECORD_BYTES = 64 * 1024
MAX_RECORDS_PER_SPACE = 1000
ID_RE = re.compile(r'^[A-Za-z0-9_-]{6,64}$')


# --- DB ---------------------------------------------------------------
def _db():
    if not os.path.exists(V2_DB_PATH):
        init_v2_db()
    conn = sqlite3.connect(V2_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def init_v2_db():
    os.makedirs(os.path.dirname(V2_DB_PATH) or '.', exist_ok=True)
    with sqlite3.connect(V2_DB_PATH) as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS spaces (
                id TEXT PRIMARY KEY,
                key_hash TEXT NOT NULL,
                titel TEXT,
                consent_version TEXT NOT NULL,
                consent_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS records (
                space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                data TEXT NOT NULL,
                client_updated_at TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (space_id, id)
            );
        ''')


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _hash_key(key):
    return hashlib.sha256(key.encode('utf-8')).hexdigest()


def _purge_expired(conn):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    conn.execute('DELETE FROM spaces WHERE updated_at < ?', (cutoff,))


def _auth_space(conn, space_id):
    """Liefert die Space-Zeile, falls der Schluessel stimmt, sonst None."""
    if not ID_RE.match(space_id or ''):
        return None
    key = request.headers.get('X-Space-Key', '')
    row = conn.execute('SELECT * FROM spaces WHERE id = ?', (space_id,)).fetchone()
    if not row or not key or not hmac.compare_digest(row['key_hash'], _hash_key(key)):
        return None
    return row


def _touch(conn, space_id):
    conn.execute('UPDATE spaces SET updated_at = ? WHERE id = ?', (_now(), space_id))


# --- Sicherheits-Header ------------------------------------------------
# Strikte CSP: nur eigene Skripte, keine Inline-Skripte, keine Fremd-Ressourcen.
# style-src-attr erlaubt style="..."-Attribute (Layout), aber keine fremden Stylesheets.
CSP = '; '.join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
])


@v2.after_request
def v2_security_headers(resp):
    resp.headers['Content-Security-Policy'] = CSP
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['Referrer-Policy'] = 'no-referrer'
    resp.headers['X-Frame-Options'] = 'DENY'
    resp.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    resp.headers['Cross-Origin-Resource-Policy'] = 'same-origin'
    resp.headers['Permissions-Policy'] = 'camera=(self), geolocation=(), microphone=(), payment=(), usb=()'
    resp.headers['Strict-Transport-Security'] = 'max-age=31536000'
    if request.path.startswith('/v2/api/') and request.path != '/v2/api/basis':
        resp.headers['Cache-Control'] = 'no-store'
    return resp


# --- Seiten -------------------------------------------------------------
@v2.route('/v2')
def v2_redirect():
    # Relativer Redirect, damit der von Traefik entfernte /futter-Prefix erhalten bleibt.
    return redirect('v2/', code=301)


@v2.route('/v2/')
def v2_index():
    return render_template('v2/index.html', consent_version=CONSENT_VERSION,
                           retention_days=RETENTION_DAYS, privacy_url=PRIVACY_URL)


@v2.route('/v2/datenschutz')
def v2_privacy():
    return render_template('v2/datenschutz.html', retention_days=RETENTION_DAYS)


@v2.route('/v2/sw.js')
def v2_service_worker():
    resp = send_from_directory(V2_STATIC_DIR, 'sw.js', mimetype='text/javascript')
    resp.headers['Cache-Control'] = 'no-cache'
    resp.headers['Service-Worker-Allowed'] = './'
    return resp


@v2.route('/v2/manifest.webmanifest')
def v2_manifest():
    return send_from_directory(V2_STATIC_DIR, 'manifest.webmanifest', mimetype='application/manifest+json')


@v2.route('/v2/assets/<path:filename>')
def v2_assets(filename):
    resp = send_from_directory(V2_STATIC_DIR, filename)
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


# --- Naehrwert-Basis (bestehende Datenbasis) ---------------------------------
_BASIS_CACHE = {'mtime': None, 'data': None}
_BESTAND_MAP = {
    'G': 'G', 'GR': 'GR', 'A': 'A', 'AR': 'AR', 'L': 'L', 'KF': 'KF', 'KG': 'KG',
    'ITALIENISCHES RAIGRAS': 'ITRG', 'LUZERNE': 'LUZ',
}
# Konservierung ueber das Code-Suffix bestimmen (-e Silage, -s Duerrfutter,
# -v Gruenfutter): In der CSV sind It.RG/Luzerne-Silagen 1. Aufwuchs
# faelschlich als "Dürrfutter" beschriftet, das Suffix ist konsistent.
_KONS_BY_SUFFIX = {'e': 'silage', 's': 'heu', 'v': 'gruen'}
_METRICS = {
    'nel': 'NEL', 'nev': 'NEV', 'apde': 'APDE', 'apdn': 'APDN', 'rp': 'RP', 'rf': 'RF',
    'ndf': 'NDF', 'adf': 'ADF', 'zucker': 'Zucker', 'ra': 'RA', 'ca': 'Ca', 'p': 'P',
    'mg': 'Mg', 'k': 'K', 'ts': 'TS', 'tsv': 'TSV_MB3_EXTRAHIERT',
}


def _num(value):
    try:
        return round(float(str(value).replace(',', '.').strip()), 3)
    except (TypeError, ValueError):
        return None


def load_basis():
    """futterwerte.csv -> {kons: {aufwuchs: {bestand: {stadium: {metric: wert}}}}}"""
    mtime = os.path.getmtime(CSV_PATH)
    if _BASIS_CACHE['mtime'] == mtime:
        return _BASIS_CACHE['data']
    with open(CSV_PATH, encoding='utf-8-sig') as fh:
        rows = list(csv.reader(fh, delimiter=';'))
    header = [h.split('[')[0].strip() for h in rows[0]]
    col = {name: i for i, name in enumerate(header)}
    out = {}
    for row in rows[1:]:
        if len(row) < len(header) - 1:
            continue
        code = row[col['code']].strip()
        kons = _KONS_BY_SUFFIX.get(code.rsplit('-', 1)[-1]) if '-' in code else None
        bestand = _BESTAND_MAP.get(row[col['Bestand']].strip().upper())
        aufwuchs = {'erster': '1', 'folgende': 'f'}.get(row[col['Aufwuchs']].strip())
        stadium = row[col['Stadium']].strip()
        if not (kons and bestand and aufwuchs and stadium.isdigit()):
            continue
        values = {k: _num(row[col[src]]) for k, src in _METRICS.items() if src in col}
        out.setdefault(kons, {}).setdefault(aufwuchs, {}).setdefault(bestand, {})[stadium] = values
    _BASIS_CACHE.update(mtime=mtime, data=out)
    return out


@v2.route('/v2/api/basis')
def v2_basis():
    resp = jsonify({'quelle': 'Agroscope Fütterungsempfehlungen (futterwerte.csv)', 'tabelle': load_basis()})
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp


# --- Freigabe-Bereiche (nur mit Zustimmung) ------------------------------
@v2.route('/v2/api/config')
def v2_config():
    return jsonify({'consentVersion': CONSENT_VERSION, 'retentionDays': RETENTION_DAYS,
                    'privacyUrl': PRIVACY_URL or None})


@v2.route('/v2/api/spaces', methods=['POST'])
def v2_create_space():
    body = request.get_json(silent=True) or {}
    consent = body.get('consent') or {}
    if consent.get('accepted') is not True:
        return jsonify({'error': 'CONSENT_REQUIRED'}), 400
    if consent.get('version') != CONSENT_VERSION:
        return jsonify({'error': 'CONSENT_OUTDATED', 'consentVersion': CONSENT_VERSION}), 409
    titel = str(body.get('titel') or '')[:200]
    space_id = secrets.token_urlsafe(9)
    key = secrets.token_urlsafe(24)
    now = _now()
    with _db() as conn:
        _purge_expired(conn)
        conn.execute('INSERT INTO spaces (id, key_hash, titel, consent_version, consent_at, created_at, updated_at) '
                     'VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (space_id, _hash_key(key), titel, CONSENT_VERSION, now, now, now))
    return jsonify({'id': space_id, 'key': key, 'consentAt': now, 'retentionDays': RETENTION_DAYS}), 201


@v2.route('/v2/api/spaces/<space_id>', methods=['GET'])
def v2_get_space(space_id):
    with _db() as conn:
        space = _auth_space(conn, space_id)
        if not space:
            return jsonify({'error': 'NOT_FOUND'}), 404
        rows = conn.execute('SELECT id, data, client_updated_at, updated_at FROM records WHERE space_id = ?',
                            (space_id,)).fetchall()
    records = []
    for r in rows:
        try:
            records.append({'id': r['id'], 'data': json.loads(r['data']),
                            'clientUpdatedAt': r['client_updated_at'], 'updatedAt': r['updated_at']})
        except ValueError:
            continue
    return jsonify({'space': {'id': space['id'], 'titel': space['titel'], 'createdAt': space['created_at'],
                              'updatedAt': space['updated_at'], 'consentAt': space['consent_at'],
                              'consentVersion': space['consent_version']},
                    'records': records, 'retentionDays': RETENTION_DAYS})


@v2.route('/v2/api/spaces/<space_id>', methods=['PATCH'])
def v2_patch_space(space_id):
    body = request.get_json(silent=True) or {}
    with _db() as conn:
        if not _auth_space(conn, space_id):
            return jsonify({'error': 'NOT_FOUND'}), 404
        if 'titel' in body:
            conn.execute('UPDATE spaces SET titel = ? WHERE id = ?', (str(body.get('titel') or '')[:200], space_id))
        _touch(conn, space_id)
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/spaces/<space_id>', methods=['DELETE'])
def v2_delete_space(space_id):
    with _db() as conn:
        if not _auth_space(conn, space_id):
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.execute('DELETE FROM spaces WHERE id = ?', (space_id,))
    return jsonify({'status': 'deleted'})


@v2.route('/v2/api/spaces/<space_id>/records/<record_id>', methods=['PUT'])
def v2_put_record(space_id, record_id):
    if not ID_RE.match(record_id):
        return jsonify({'error': 'BAD_ID'}), 400
    raw = request.get_data(cache=False, as_text=True)
    if len(raw.encode('utf-8')) > MAX_RECORD_BYTES:
        return jsonify({'error': 'TOO_LARGE'}), 413
    try:
        body = json.loads(raw)
    except ValueError:
        return jsonify({'error': 'BAD_JSON'}), 400
    data = body.get('data')
    if not isinstance(data, dict):
        return jsonify({'error': 'BAD_DATA'}), 400
    client_updated = str(body.get('updatedAt') or '')[:40]
    with _db() as conn:
        if not _auth_space(conn, space_id):
            return jsonify({'error': 'NOT_FOUND'}), 404
        existing = conn.execute('SELECT client_updated_at FROM records WHERE space_id = ? AND id = ?',
                                (space_id, record_id)).fetchone()
        if existing is None:
            count = conn.execute('SELECT COUNT(*) FROM records WHERE space_id = ?', (space_id,)).fetchone()[0]
            if count >= MAX_RECORDS_PER_SPACE:
                return jsonify({'error': 'SPACE_FULL'}), 409
        elif existing['client_updated_at'] and client_updated and existing['client_updated_at'] > client_updated:
            # Neuere Fassung liegt bereits auf dem Server (anderes Geraet).
            return jsonify({'status': 'stale'}), 409
        conn.execute('INSERT INTO records (space_id, id, data, client_updated_at, updated_at) VALUES (?, ?, ?, ?, ?) '
                     'ON CONFLICT(space_id, id) DO UPDATE SET data = excluded.data, '
                     'client_updated_at = excluded.client_updated_at, updated_at = excluded.updated_at',
                     (space_id, record_id, json.dumps(data, ensure_ascii=False), client_updated, _now()))
        _touch(conn, space_id)
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/spaces/<space_id>/records/<record_id>', methods=['DELETE'])
def v2_delete_record(space_id, record_id):
    with _db() as conn:
        if not _auth_space(conn, space_id):
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.execute('DELETE FROM records WHERE space_id = ? AND id = ?', (space_id, record_id))
        _touch(conn, space_id)
    return jsonify({'status': 'deleted'})
