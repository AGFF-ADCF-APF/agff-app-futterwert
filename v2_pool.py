"""Futter v2 – Probenpool für Kursleitende.

Kursleitende stellen ausgewählte Kursproben (Beschreibung, Region, Alter, Laborwerte, Fotos,
ausgewählte Beurteilungen als anonyme Referenzen) in einen gemeinsamen Pool. Andere freigeschaltete
Kursleitende können sie in eigene Kurse übernehmen.

Datenschutz: Pool-Einträge sind bewusste Veröffentlichungen an alle Kursleitenden – daher nicht
Ende-zu-Ende verschlüsselt, sondern mit Serverschlüssel (Datenbank) bzw. Foto-Schlüssel (Dateien)
gespeichert. Referenzen enthalten keine Namen. Zugriff nur mit gültiger Kursleitungs-Sitzung.
"""
import json
import os
import re
import shutil
import sqlite3
import time

from flask import jsonify, request, send_from_directory

import v2_mail as M
from v2_api import v2, _db, _now, _sha, _rate_hit, _check_record, _json_body, ID_RE, TOKEN_RE, FOTO_ID_RE

FOTO_DIR = os.environ.get('V2_FOTO_DIR', 'data/v2_fotos')
MAX_FOTO_BYTES = 5 * 1024 * 1024
MAX_EINTRAEGE = 2000
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def init_pool_db():
    with _db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS pool_proben (
                id TEXT PRIMARY KEY,
                creator_hmac TEXT NOT NULL,
                typ TEXT NOT NULL,
                daten_enc TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pool_fotos (
                pool_id TEXT NOT NULL REFERENCES pool_proben(id) ON DELETE CASCADE,
                id TEXT NOT NULL, bytes INTEGER NOT NULL,
                PRIMARY KEY (pool_id, id)
            );
        ''')
        cols = {r[1] for r in conn.execute('PRAGMA table_info(kurs_proben)')}
        if cols and 'pool_id' not in cols:
            try:
                conn.execute('ALTER TABLE kurs_proben ADD COLUMN pool_id TEXT')
            except sqlite3.OperationalError:
                pass  # parallel startende Worker


def _dir(pool_id):
    return os.path.join(FOTO_DIR, 'pool', pool_id)


def _leitung():
    """Kursleitungs-Sitzung aus beliebigem Kurs (Header X-Kurs-Id, X-Kurs-Session). Liefert E-Mail-HMAC."""
    kurs_id, tok = request.headers.get('X-Kurs-Id', ''), request.headers.get('X-Kurs-Session', '')
    if not ID_RE.match(kurs_id) or not TOKEN_RE.match(tok):
        return None
    with _db() as conn:
        row = conn.execute("SELECT t.email_hmac FROM kurs_sessions s JOIN kurs_teilnehmende t ON t.id = s.teilnehmer_id "
                           "WHERE s.token_hash = ? AND s.kurs_id = ? AND s.expires_at > ? AND t.rolle = 'leitung'",
                           (_sha(tok), kurs_id, time.time())).fetchone()
    if not row or not row['email_hmac']:
        _rate_hit('auth_fail', limit=60, window=600)
        return None
    return row['email_hmac']


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


def _text(v, n):
    return v is None or (isinstance(v, str) and len(v) <= n)


def pruefen(d):
    """Whitelist der Pool-Daten. Gibt bereinigte Daten oder None zurück."""
    if not isinstance(d, dict) or d.get('typ') not in ('heu', 'gras', 'mais'):
        return None
    if not all(_text(d.get(k), n) for k, n in (('titel', 120), ('beschreibung', 1000), ('quelle', 200))):
        return None
    out = {'typ': d['typ'], 'titel': (d.get('titel') or '').strip() or 'Probe', 'beschreibung': d.get('beschreibung') or '', 'quelle': d.get('quelle') or ''}
    if d.get('schnitt'):
        if not _DATE_RE.match(str(d['schnitt'])):
            return None
        out['schnitt'] = d['schnitt']
    reg = d.get('region')
    if reg:
        if not isinstance(reg, dict) or not set(reg) <= {'ort', 'hoehe'} or not _text(reg.get('ort'), 80) or not _text(reg.get('hoehe'), 6):
            return None
        out['region'] = {k: v for k, v in reg.items() if v}
    lab = d.get('labor')
    if lab:
        if not isinstance(lab, dict) or not set(lab) <= {'ts', 'nel', 'apde', 'apdn', 'rp', 'ph'} or not all(_num(v, 0, 2000) for v in lab.values()):
            return None
        out['labor'] = lab
    fotos = d.get('fotos') or []
    if not isinstance(fotos, list) or len(fotos) > 8:
        return None
    out['fotos'] = []
    for f in fotos:
        if (not isinstance(f, dict) or not FOTO_ID_RE.match(str(f.get('id', ''))) or f.get('art') not in ('futter', 'labor')
                or not re.match(r'^[A-Za-z0-9_-]{43}$', str(f.get('key', ''))) or f.get('mime') not in ('image/webp', 'image/jpeg')):
            return None
        out['fotos'].append({k: f[k] for k in ('id', 'art', 'key', 'mime', 'w', 'h') if k in f and (k not in ('w', 'h') or _num(f[k], 1, 10000))})
    refs = d.get('referenzen') or []
    if not isinstance(refs, list) or len(refs) > 20:
        return None
    out['referenzen'] = []
    for r in refs:
        an = isinstance(r, dict) and r.get('analyse')
        if not an or not isinstance(an, dict) or not ID_RE.match(str(an.get('id', ''))) or not _check_record(an['id'], {'analyse': an}) or not _text(r.get('label'), 40):
            return None
        out['referenzen'].append({'label': (r.get('label') or 'Referenz').strip()[:40], 'analyse': an})
    return out


def eintrag(conn, pool_id):
    r = conn.execute('SELECT * FROM pool_proben WHERE id = ?', (pool_id,)).fetchone()
    if not r:
        return None
    try:
        return json.loads(M.text_dec(r['daten_enc'], b'pool') or 'null')
    except ValueError:
        return None


# --- Pool lesen / anlegen / löschen -----------------------------------------------------
@v2.route('/v2/api/pool', methods=['GET'])
def pool_liste():
    ich = _leitung()
    if not ich:
        return jsonify({'error': 'NOT_FOUND'}), 404
    with _db() as conn:
        rows = conn.execute('SELECT id, creator_hmac, created_at FROM pool_proben ORDER BY created_at DESC').fetchall()
        out = []
        for r in rows:
            d = eintrag(conn, r['id'])
            if d:
                out.append({'id': r['id'], 'eigen': r['creator_hmac'] == ich, 'createdAt': r['created_at'], 'daten': d})
    return jsonify({'eintraege': out})


@v2.route('/v2/api/pool/<pool_id>', methods=['PUT'])
def pool_speichern(pool_id):
    ich = _leitung()
    if not ich or not ID_RE.match(pool_id):
        return jsonify({'error': 'NOT_FOUND'}), 404
    _rate_hit('pool_put', limit=60, window=3600)
    d = pruefen((_json_body() or {}).get('daten'))
    if d is None:
        return jsonify({'error': 'REJECTED_CONTENT'}), 422
    with _db() as conn:
        alt = conn.execute('SELECT creator_hmac FROM pool_proben WHERE id = ?', (pool_id,)).fetchone()
        if alt and alt['creator_hmac'] != ich:
            return jsonify({'error': 'NOT_FOUND'}), 404
        if not alt and conn.execute('SELECT COUNT(*) FROM pool_proben').fetchone()[0] >= MAX_EINTRAEGE:
            return jsonify({'error': 'POOL_VOLL'}), 409
        conn.execute('INSERT INTO pool_proben (id, creator_hmac, typ, daten_enc, created_at) VALUES (?, ?, ?, ?, ?) '
                     'ON CONFLICT(id) DO UPDATE SET typ = excluded.typ, daten_enc = excluded.daten_enc',
                     (pool_id, ich, d['typ'], M.text_enc(json.dumps(d, ensure_ascii=False), b'pool'), _now()))
    return jsonify({'status': 'ok'})


def _loeschen(pool_id):
    with _db() as conn:
        conn.execute('DELETE FROM pool_proben WHERE id = ?', (pool_id,))
    shutil.rmtree(_dir(pool_id), ignore_errors=True)


@v2.route('/v2/api/pool/<pool_id>', methods=['DELETE'])
def pool_loeschen(pool_id):
    ich = _leitung()
    with _db() as conn:
        r = conn.execute('SELECT creator_hmac FROM pool_proben WHERE id = ?', (pool_id,)).fetchone()
    if not ich or not r or r['creator_hmac'] != ich:
        return jsonify({'error': 'NOT_FOUND'}), 404
    _loeschen(pool_id)
    return jsonify({'status': 'deleted'})


# --- Fotos ----------------------------------------------------------------------------
@v2.route('/v2/api/pool/<pool_id>/fotos/<foto_id>', methods=['PUT'])
def pool_foto_put(pool_id, foto_id):
    ich = _leitung()
    if not ich or not ID_RE.match(pool_id) or not FOTO_ID_RE.match(foto_id):
        return jsonify({'error': 'NOT_FOUND'}), 404
    data = request.get_data(cache=False)
    if len(data) > MAX_FOTO_BYTES or len(data) < 30 or data[0] != 1:
        return jsonify({'error': 'REJECTED_CONTENT'}), 422
    with _db() as conn:
        r = conn.execute('SELECT creator_hmac FROM pool_proben WHERE id = ?', (pool_id,)).fetchone()
        d = eintrag(conn, pool_id)
    if not r or r['creator_hmac'] != ich or not d or foto_id not in {f['id'] for f in d.get('fotos', [])}:
        return jsonify({'error': 'NOT_FOUND'}), 404
    import v2_admin as ADM
    if not ADM.foto_platz_frei(len(data)):
        return jsonify({'error': 'SERVER_VOLL'}), 507
    os.makedirs(_dir(pool_id), exist_ok=True)
    tmp = os.path.join(_dir(pool_id), foto_id + '.tmp')
    with open(tmp, 'wb') as fh:
        fh.write(data)
    os.replace(tmp, os.path.join(_dir(pool_id), foto_id + '.bin'))
    with _db() as conn:
        conn.execute('INSERT INTO pool_fotos (pool_id, id, bytes) VALUES (?, ?, ?) ON CONFLICT(pool_id, id) DO UPDATE SET bytes = excluded.bytes',
                     (pool_id, foto_id, len(data)))
    return jsonify({'status': 'ok'})


def foto_senden(pool_id, foto_id):
    resp = send_from_directory(os.path.abspath(_dir(pool_id)), foto_id + '.bin', mimetype='application/octet-stream')
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@v2.route('/v2/api/pool/<pool_id>/fotos/<foto_id>', methods=['GET'])
def pool_foto_get(pool_id, foto_id):
    if not _leitung() or not ID_RE.match(pool_id) or not FOTO_ID_RE.match(foto_id):
        return jsonify({'error': 'NOT_FOUND'}), 404
    with _db() as conn:
        if not conn.execute('SELECT 1 FROM pool_fotos WHERE pool_id = ? AND id = ?', (pool_id, foto_id)).fetchone():
            return jsonify({'error': 'NOT_FOUND'}), 404
    return foto_senden(pool_id, foto_id)


# --- Admin: Pool-Einträge entfernen ------------------------------------------------------
@v2.route('/v2/api/admin/pool', methods=['GET'])
def admin_pool():
    import v2_admin as ADM
    if not ADM._admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    with _db() as conn:
        rows = conn.execute('SELECT id, created_at FROM pool_proben ORDER BY created_at DESC').fetchall()
        out = [{'id': r['id'], 'createdAt': r['created_at'], 'daten': {k: v for k, v in (eintrag(conn, r['id']) or {}).items() if k in ('titel', 'typ', 'quelle', 'beschreibung')}} for r in rows]
    return jsonify({'eintraege': out})


@v2.route('/v2/api/admin/pool/<pool_id>', methods=['DELETE'])
def admin_pool_loeschen(pool_id):
    import v2_admin as ADM
    if not ADM._admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    _loeschen(pool_id)
    return jsonify({'status': 'deleted'})
