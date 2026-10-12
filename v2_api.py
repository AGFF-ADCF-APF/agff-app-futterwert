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
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, redirect, render_template, request, send_from_directory

v2 = Blueprint('v2', __name__)

V2_DB_PATH = os.environ.get('V2_DB_PATH', 'data/v2.db')
V2_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'v2')
CSV_PATH = 'data/futterwerte.csv'
# Bei Aenderung des Zustimmungstextes im Frontend MUSS diese Version mitwachsen.
CONSENT_VERSION = '2026-10-c'  # c: Speicherung auf dem Server ohne Ende-zu-Ende-Verschlüsselung (Zugriff per Link)
RETENTION_DAYS = int(os.environ.get('V2_RETENTION_DAYS', '730'))
PRIVACY_URL = os.environ.get('V2_PRIVACY_URL', '')
MAX_RECORD_BYTES = 64 * 1024
MAX_RECORDS_PER_SPACE = 1000
ID_RE = re.compile(r'^[A-Za-z0-9_-]{6,64}$')


# --- DB ---------------------------------------------------------------
# Ende-zu-Ende-Modell: Der Server kennt nur Hashes der Zugriffs-Tokens, die lesbaren
# Analysedaten und verschlüsselte Pakete («privat») für alles Personenbezogene.
# Schlüssel und Tokens werden im Browser aus dem Geheimnis im Link (#…) abgeleitet.
TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{43}$')       # 32 Byte base64url
HASH_RE = re.compile(r'^[0-9a-f]{64}$')


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
        # Vorgängerschema (Klartext, Beta-Test) entfernen, sofern leer
        for old in ('records', 'spaces'):
            exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (old,)).fetchone()
            if exists and conn.execute(f'SELECT COUNT(*) FROM {old}').fetchone()[0] == 0:
                conn.execute(f'DROP TABLE {old}')
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS e2e_spaces (
                id TEXT PRIMARY KEY,
                read_hash TEXT NOT NULL,
                write_hash TEXT NOT NULL,
                epoch INTEGER NOT NULL DEFAULT 1,
                consent_version TEXT NOT NULL,
                consent_at TEXT NOT NULL,
                owner_email_hmac TEXT, owner_email_enc TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS e2e_fotos (
                space_id TEXT NOT NULL REFERENCES e2e_spaces(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (space_id, id)
            );
            CREATE TABLE IF NOT EXISTS e2e_records (
                space_id TEXT NOT NULL REFERENCES e2e_spaces(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                analyse TEXT NOT NULL,
                privat TEXT,
                client_updated_at TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (space_id, id)
            );
        ''')
        _migrate_spaces(conn)


def _migrate_spaces(conn):
    cols = {r[1] for r in conn.execute('PRAGMA table_info(e2e_spaces)')}
    for c in ('owner_email_hmac', 'owner_email_enc'):
        if c not in cols:
            conn.execute(f'ALTER TABLE e2e_spaces ADD COLUMN {c} TEXT')


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _sha(token):
    return hashlib.sha256(token.encode('ascii')).hexdigest()


FOTO_DIR = os.environ.get('V2_FOTO_DIR', 'data/v2_fotos')
FOTO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{16}$')
MAX_FOTO_BYTES = 5 * 1024 * 1024          # verschlüsselt, inkl. Kopf
MAX_FOTOS_PER_SPACE = 400
# Fotos: 20 MB je Person und Anlass (eine Freigabe = ein Anlass einer Person), Gesamtobergrenze in v2_admin
MAX_FOTO_TOTAL = int(os.environ.get('V2_FOTO_MB_PRO_PERSON', '20')) * 1024 * 1024


def _foto_path(space_id, foto_id):
    return os.path.join(FOTO_DIR, space_id, foto_id + '.bin')


def _fotos_entfernen(space_id):
    import shutil
    shutil.rmtree(os.path.join(FOTO_DIR, space_id), ignore_errors=True)


def _purge_expired(conn):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    for row in conn.execute('SELECT id FROM e2e_spaces WHERE updated_at < ?', (cutoff,)).fetchall():
        _fotos_entfernen(row['id'] if isinstance(row, sqlite3.Row) else row[0])
    conn.execute('DELETE FROM e2e_spaces WHERE updated_at < ?', (cutoff,))


def _auth(conn, space_id, need_write=False):
    """Prüft Lese- bzw. Schreib-Token. Gibt die Space-Zeile oder None zurück (keine Unterscheidung nach aussen)."""
    if not ID_RE.match(space_id or ''):
        return None
    row = conn.execute('SELECT * FROM e2e_spaces WHERE id = ?', (space_id,)).fetchone()
    if not row:
        return None
    header, column = ('X-Write-Token', 'write_hash') if need_write else ('X-Read-Token', 'read_hash')
    token = request.headers.get(header, '')
    if not TOKEN_RE.match(token) or not hmac.compare_digest(row[column], _sha(token)):
        _rate_hit('auth_fail', limit=60, window=600)
        return None
    return row


def _touch(conn, space_id):
    conn.execute('UPDATE e2e_spaces SET updated_at = ? WHERE id = ?', (_now(), space_id))


# --- Einfache Ratenbegrenzung (pro Prozess, nur im Speicher; IPs werden nicht gespeichert) ---
_rate_lock = threading.Lock()
_rate = defaultdict(deque)


class RateLimited(Exception):
    pass


def _client_key():
    raw = request.headers.get('X-Real-Ip') or request.remote_addr or '?'
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _rate_hit(bucket, limit, window):
    key = (bucket, _client_key())
    now = time.monotonic()
    with _rate_lock:
        q = _rate[key]
        while q and now - q[0] > window:
            q.popleft()
        q.append(now)
        if len(q) > limit:
            raise RateLimited()


@v2.errorhandler(RateLimited)
def _rate_limited(_e):
    return jsonify({'error': 'RATE_LIMITED'}), 429


# --- Inhaltsprüfung: auf dem Server darf kein personenbezogener Klartext landen ----
_SHORT_RE = re.compile(r'^[A-Za-z0-9_.-]{0,16}$')
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_ISO_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$')
_B64_RE = re.compile(r'^[A-Za-z0-9_-]+$')
PROBE_KEYS = {'id', 'typ', 'createdAt', 'updatedAt', 'quelle', 'kopf', 'antworten', 'rad'}


def _scalar_ok(v):
    if isinstance(v, bool) or v is None:
        return True
    if isinstance(v, (int, float)):
        return abs(v) < 1e6
    return isinstance(v, str) and bool(_SHORT_RE.match(v))


_KEY_RE = re.compile(r'^[A-Za-z0-9_.-]{1,40}$')
_CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def _frei_ok(v, tiefe=0):
    """Freie, personenbezogene Angaben (Namen, Notizen, Standort, Foto-Metadaten): begrenzte JSON-Struktur.
    Gespeichert auf dem Server (seit 2026-10 ohne Ende-zu-Ende-Verschlüsselung), sichtbar nur mit Zugriff."""
    if v is None or isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return abs(v) < 1e12
    if isinstance(v, str):
        return len(v) <= 5000 and not _CTRL_RE.search(v)
    if tiefe >= 4:
        return False
    if isinstance(v, list):
        return len(v) <= 60 and all(_frei_ok(x, tiefe + 1) for x in v)
    if isinstance(v, dict):
        return len(v) <= 80 and all(isinstance(k, str) and _KEY_RE.match(k) and _frei_ok(x, tiefe + 1) for k, x in v.items())
    return False


def _check_privat(pv):
    if pv is None:
        return True
    if not isinstance(pv, dict) or not _frei_ok(pv):
        return False
    return len(json.dumps(pv, ensure_ascii=False).encode('utf-8')) <= MAX_RECORD_BYTES


def _bild_typ(kopf):
    """Nur echte Bilder annehmen bzw. ausliefern (JPEG, WebP)."""
    if kopf[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if kopf[:4] == b'RIFF' and kopf[8:12] == b'WEBP':
        return 'image/webp'
    return None


def bild_senden(ordner, datei):
    """Foto ausliefern: Typ aus dem Dateikopf (Altbestand verschlüsselt → octet-stream), nie zwischenspeichern."""
    pfad = os.path.join(os.path.abspath(ordner), datei)
    try:
        with open(pfad, 'rb') as fh:
            typ = _bild_typ(fh.read(12)) or 'application/octet-stream'
    except FileNotFoundError:
        return jsonify({'error': 'NOT_FOUND'}), 404
    resp = send_from_directory(os.path.abspath(ordner), datei, mimetype=typ)
    resp.headers['Cache-Control'] = 'no-store'
    resp.headers['Content-Disposition'] = 'inline'
    return resp


FUTTERARTEN = ('heu', 'gras', 'mais', 'gruen', 'gps')


def _check_record(record_id, data):
    """Whitelist der Analysedaten (anonym auswertbar). Freitext und Personenbezogenes nur im Teil «privat»."""
    if not isinstance(data, dict) or not set(data) <= {'analyse', 'privat'}:
        return False
    an = data.get('analyse') or {}
    if not isinstance(an, dict) or not _check_privat(data.get('privat')):
        return False
    if record_id == 'anlassmeta':
        return set(an) <= {'id', 'datum'} and (an.get('datum') in (None, '') or bool(_DATE_RE.match(str(an.get('datum')))))
    if not set(an) <= PROBE_KEYS or an.get('id') != record_id or an.get('typ') not in FUTTERARTEN:
        return False
    for k in ('createdAt', 'updatedAt'):
        if an.get(k) is not None and not (isinstance(an[k], str) and _ISO_RE.match(an[k])):
            return False
    if an.get('quelle') not in (None, 'v1'):
        return False
    kopf = an.get('kopf') or {}
    if not isinstance(kopf, dict) or not set(kopf) <= {'schnitt'} or (kopf.get('schnitt') and not _DATE_RE.match(str(kopf['schnitt']))):
        return False
    for part in ('antworten', 'rad'):
        d = an.get(part) or {}
        if not isinstance(d, dict) or len(d) > 40 or not all(_SHORT_RE.match(k) and _scalar_ok(v) for k, v in d.items()):
            return False
    return True


# --- Sicherheits-Header ------------------------------------------------
# Strikte CSP: nur eigene Skripte, keine Inline-Skripte, keine Fremd-Ressourcen.
# style-src-attr erlaubt style="..."-Attribute (Layout), aber keine fremden Stylesheets.
CSP = '; '.join([
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",  # WebAssembly für Texterkennung auf dem Gerät (kein JS-eval)
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
    resp.headers['Permissions-Policy'] = 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()'
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
    if filename.endswith('.mjs'):
        resp = send_from_directory(V2_STATIC_DIR, filename, mimetype='text/javascript')
    elif filename.endswith('.traineddata.gz'):
        # Roh ausliefern (nicht als Content-Encoding), Tesseract.js entpackt selbst
        resp = send_from_directory(V2_STATIC_DIR, filename, mimetype='application/octet-stream')
        resp.headers.pop('Content-Encoding', None)
    else:
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


# --- Freigabe-Bereiche (nur mit Zustimmung; Zugriff nur mit Lese-/Bearbeiten-Link) ----
mimetypes.add_type("image/webp", ".webp")  # fehlt in python:slim
ASSET_BUILD = 'b1-45'  # gleich wie ?v= in templates/v2/index.html


@v2.route('/v2/api/config')
def v2_config():
    resp = jsonify({'consentVersion': CONSENT_VERSION, 'retentionDays': RETENTION_DAYS,
                    'privacyUrl': PRIVACY_URL or None, 'build': ASSET_BUILD})
    resp.headers['Cache-Control'] = 'no-store'
    return resp


def _json_body():
    raw = request.get_data(cache=False, as_text=True)
    if len(raw.encode('utf-8')) > MAX_RECORD_BYTES * 40:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


@v2.route('/v2/api/spaces/code', methods=['POST'])
def v2_space_code():
    """Bestätigungscode vor dem ersten Speichern auf dem Server."""
    _rate_hit('space_code', limit=20, window=3600)
    import v2_mail as M
    email = (_json_body() or {}).get('email')
    if not M.email_ok(email):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    M.code_senden('space', email, 'Speichern auf dem Server')
    return jsonify({'status': 'sent'})


@v2.route('/v2/api/spaces', methods=['POST'])
def v2_create_space():
    _rate_hit('create', limit=30, window=3600)
    body = _json_body() or {}
    consent = body.get('consent') or {}
    if consent.get('accepted') is not True:
        return jsonify({'error': 'CONSENT_REQUIRED'}), 400
    if consent.get('version') != CONSENT_VERSION:
        return jsonify({'error': 'CONSENT_OUTDATED', 'consentVersion': CONSENT_VERSION}), 409
    rh, wh = body.get('readHash', ''), body.get('writeHash', '')
    if not (HASH_RE.match(rh) and HASH_RE.match(wh)) or rh == wh:
        return jsonify({'error': 'BAD_KEYS'}), 400
    import v2_mail as M  # spät importiert (v2_mail importiert dieses Modul)
    email = M.email_norm(body.get('email'))
    if not M.email_ok(email):
        return jsonify({'error': 'EMAIL_REQUIRED'}), 400
    if not M.code_pruefen('space', email, body.get('code')):
        return jsonify({'error': 'CODE_INVALID'}), 400
    space_id = secrets.token_urlsafe(9)
    now = _now()
    with _db() as conn:
        _purge_expired(conn)
        conn.execute('INSERT INTO e2e_spaces (id, read_hash, write_hash, consent_version, consent_at, owner_email_hmac, owner_email_enc, created_at, updated_at) '
                     'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (space_id, rh, wh, CONSENT_VERSION, now, M.email_hmac(email), M.email_enc(email), now, now))
    return jsonify({'id': space_id, 'consentAt': now, 'retentionDays': RETENTION_DAYS}), 201


@v2.route('/v2/api/spaces/<space_id>', methods=['GET'])
def v2_get_space(space_id):
    with _db() as conn:
        space = _auth(conn, space_id)
        if not space:
            return jsonify({'error': 'NOT_FOUND'}), 404
        rows = conn.execute('SELECT id, analyse, privat, client_updated_at, updated_at FROM e2e_records WHERE space_id = ?',
                            (space_id,)).fetchall()
    records = [{'id': r['id'], 'data': {'analyse': json.loads(r['analyse']), 'privat': json.loads(r['privat']) if r['privat'] else None},
                'clientUpdatedAt': r['client_updated_at'], 'updatedAt': r['updated_at']} for r in rows]
    return jsonify({'space': {'id': space['id'], 'epoch': space['epoch'], 'createdAt': space['created_at'], 'updatedAt': space['updated_at'],
                              'consentAt': space['consent_at'], 'consentVersion': space['consent_version']},
                    'records': records, 'retentionDays': RETENTION_DAYS})


@v2.route('/v2/api/spaces/<space_id>', methods=['DELETE'])
def v2_delete_space(space_id):
    with _db() as conn:
        if not _auth(conn, space_id, need_write=True):
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.execute('DELETE FROM e2e_spaces WHERE id = ?', (space_id,))
    _fotos_entfernen(space_id)
    return jsonify({'status': 'deleted'})


def _store(conn, space_id, record_id, data, client_updated):
    conn.execute('INSERT INTO e2e_records (space_id, id, analyse, privat, client_updated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
                 'ON CONFLICT(space_id, id) DO UPDATE SET analyse = excluded.analyse, privat = excluded.privat, '
                 'client_updated_at = excluded.client_updated_at, updated_at = excluded.updated_at',
                 (space_id, record_id, json.dumps(data.get('analyse') or {}, ensure_ascii=False),
                  json.dumps(data['privat']) if data.get('privat') else None, client_updated, _now()))


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
    if not _check_record(record_id, data):
        return jsonify({'error': 'REJECTED_CONTENT'}), 422
    client_updated = str(body.get('updatedAt') or '')[:40]
    with _db() as conn:
        if not _auth(conn, space_id, need_write=True):
            return jsonify({'error': 'NOT_FOUND'}), 404
        existing = conn.execute('SELECT client_updated_at FROM e2e_records WHERE space_id = ? AND id = ?',
                                (space_id, record_id)).fetchone()
        if existing is None:
            count = conn.execute('SELECT COUNT(*) FROM e2e_records WHERE space_id = ?', (space_id,)).fetchone()[0]
            if count >= MAX_RECORDS_PER_SPACE:
                return jsonify({'error': 'SPACE_FULL'}), 409
        elif existing['client_updated_at'] and client_updated and existing['client_updated_at'] > client_updated:
            return jsonify({'status': 'stale'}), 409
        _store(conn, space_id, record_id, data, client_updated)
        _touch(conn, space_id)
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/spaces/<space_id>/records/<record_id>', methods=['DELETE'])
def v2_delete_record(space_id, record_id):
    with _db() as conn:
        if not _auth(conn, space_id, need_write=True):
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.execute('DELETE FROM e2e_records WHERE space_id = ? AND id = ?', (space_id, record_id))
        _touch(conn, space_id)
    return jsonify({'status': 'deleted'})


@v2.route('/v2/api/spaces/<space_id>/rotate', methods=['POST'])
def v2_rotate(space_id):
    """Links erneuern: neue Token-Hashes (und aktueller Stand der Datensätze) in einer Transaktion.
    Danach sind alle alten Links ungültig."""
    body = _json_body() or {}
    rh, wh, recs = body.get('readHash', ''), body.get('writeHash', ''), body.get('records')
    if not (HASH_RE.match(rh) and HASH_RE.match(wh)) or rh == wh or not isinstance(recs, list) or len(recs) > MAX_RECORDS_PER_SPACE + 1:
        return jsonify({'error': 'BAD_REQUEST'}), 400
    for r in recs:
        if not isinstance(r, dict) or not ID_RE.match(str(r.get('id', ''))) or not _check_record(r['id'], r.get('data')):
            return jsonify({'error': 'REJECTED_CONTENT', 'id': str(r.get('id', ''))[:64] if isinstance(r, dict) else None}), 422
    with _db() as conn:
        space = _auth(conn, space_id, need_write=True)
        if not space:
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.execute('DELETE FROM e2e_records WHERE space_id = ?', (space_id,))
        for r in recs:
            _store(conn, space_id, r['id'], r['data'], str(r.get('updatedAt') or '')[:40])
        conn.execute('UPDATE e2e_spaces SET read_hash = ?, write_hash = ?, epoch = epoch + 1, updated_at = ? WHERE id = ?',
                     (rh, wh, _now(), space_id))
    return jsonify({'status': 'rotated', 'epoch': space['epoch'] + 1})


# --- Fotos (JPEG/WebP ohne Metadaten; Zugriff nur mit Link) ---
@v2.route('/v2/api/spaces/<space_id>/fotos/<foto_id>', methods=['PUT'])
def v2_foto_put(space_id, foto_id):
    if not FOTO_ID_RE.match(foto_id):
        return jsonify({'error': 'BAD_ID'}), 400
    if (request.content_length or 0) > MAX_FOTO_BYTES:
        return jsonify({'error': 'TOO_LARGE'}), 413
    data = request.get_data(cache=False)
    if len(data) > MAX_FOTO_BYTES or len(data) < 100 or not _bild_typ(data[:12]):
        return jsonify({'error': 'REJECTED_CONTENT'}), 422
    with _db() as conn:
        if not _auth(conn, space_id, need_write=True):
            return jsonify({'error': 'NOT_FOUND'}), 404
        n, total = conn.execute('SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM e2e_fotos WHERE space_id = ? AND id != ?',
                                (space_id, foto_id)).fetchone()
        if n >= MAX_FOTOS_PER_SPACE or total + len(data) > MAX_FOTO_TOTAL:
            return jsonify({'error': 'QUOTA'}), 409
        import v2_admin as ADM
        if not ADM.foto_platz_frei(len(data)):
            return jsonify({'error': 'SERVER_VOLL'}), 507
        os.makedirs(os.path.join(FOTO_DIR, space_id), exist_ok=True)
        tmp = _foto_path(space_id, foto_id) + '.tmp'
        with open(tmp, 'wb') as fh:
            fh.write(data)
        os.replace(tmp, _foto_path(space_id, foto_id))
        conn.execute('INSERT INTO e2e_fotos (space_id, id, bytes, created_at) VALUES (?, ?, ?, ?) '
                     'ON CONFLICT(space_id, id) DO UPDATE SET bytes = excluded.bytes', (space_id, foto_id, len(data), _now()))
        _touch(conn, space_id)
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/spaces/<space_id>/fotos/<foto_id>', methods=['GET'])
def v2_foto_get(space_id, foto_id):
    if not FOTO_ID_RE.match(foto_id):
        return jsonify({'error': 'BAD_ID'}), 400
    with _db() as conn:
        if not _auth(conn, space_id):
            return jsonify({'error': 'NOT_FOUND'}), 404
        if not conn.execute('SELECT 1 FROM e2e_fotos WHERE space_id = ? AND id = ?', (space_id, foto_id)).fetchone():
            return jsonify({'error': 'NOT_FOUND'}), 404
    return bild_senden(os.path.join(FOTO_DIR, space_id), foto_id + '.bin')


@v2.route('/v2/api/spaces/<space_id>/fotos/<foto_id>', methods=['DELETE'])
def v2_foto_delete(space_id, foto_id):
    if not FOTO_ID_RE.match(foto_id):
        return jsonify({'error': 'BAD_ID'}), 400
    with _db() as conn:
        if not _auth(conn, space_id, need_write=True):
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.execute('DELETE FROM e2e_fotos WHERE space_id = ? AND id = ?', (space_id, foto_id))
        _touch(conn, space_id)
    try:
        os.remove(_foto_path(space_id, foto_id))
    except FileNotFoundError:
        pass
    return jsonify({'status': 'deleted'})
