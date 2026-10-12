"""Futter v2 – Konto (Anmeldung per E-Mail) und Cloud-Speicherung je App.

Anmeldung
- 6-stelliger Code (15 Minuten) und in derselben E-Mail ein Anmelde-Link «#login=<id>.<geheimnis>».
  Der Link gilt 24 Monate oder bis zum Widerruf; ein neu angeforderter Code macht frühere Links nicht ungültig.
  Der Server speichert vom Link nur einen Prüfwert (SHA-256), das Geheimnis steht nur in der E-Mail.
- Jede Anmeldung erzeugt eine Sitzung für dieses Gerät (Kopf «X-Konto», 24 Monate). Geräte und Links sind
  in der App einzeln widerrufbar.

Cloud-Speicherung (nur mit Konto, je App einzeln einschaltbar: «futter», «wiese»)
- Datensätze als JSON (Inhalt prüft und bereinigt die App beim Laden), Löschungen als Grabstein.
- Fotos: JPEG/WebP, Kontingent je Konto (Standard V2_KONTO_FOTO_MB), mehr auf Antrag (Admin).
- Ohne Ende-zu-Ende-Verschlüsselung (wie Gruppen/Kurse): Zugriff nur mit Sitzung; Adressen nur verschlüsselt.
- Löschung: jederzeit selbst; automatisch RETENTION_DAYS nach der letzten Anmeldung/Nutzung.
"""
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

import v2_admin as ADM
import v2_mail as M
from v2_api import (v2, _db, _now, _sha, _rate_hit, _json_body, _bild_typ, bild_senden, RateLimited,
                    TOKEN_RE, FOTO_ID_RE, RETENTION_DAYS)

LINK_TAGE = 730                     # Anmelde-Link: 24 Monate
SESSION_TAGE = 730                  # Gerät angemeldet: 24 Monate (wird bei Nutzung nicht verlängert)
MAX_LINKS = 30                      # aktive Links je Konto (älteste fallen weg)
APPS = ('futter', 'wiese')
REC_ID_RE = re.compile(r'^[A-Za-z0-9:_.-]{1,90}$')
MAX_REC_BYTES = 512 * 1024
MAX_RECS = 6000                     # je Konto und App
MAX_DATEN_BYTES = 60 * 1024 * 1024  # je Konto (alle Apps, ohne Fotos)
FOTO_STANDARD = int(os.environ.get('V2_KONTO_FOTO_MB', '100')) * 1024 * 1024
MAX_FOTO_BYTES = 5 * 1024 * 1024
FOTO_DIR = os.environ.get('V2_FOTO_DIR', 'data/v2_fotos')
CONSENT_VERSION_KONTO = '2026-10-konto1'


def init_konto_db():
    with _db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS konten (
                id TEXT PRIMARY KEY,
                email_hmac TEXT NOT NULL UNIQUE,
                email_enc TEXT NOT NULL,
                cloud_futter INTEGER NOT NULL DEFAULT 0,
                cloud_wiese INTEGER NOT NULL DEFAULT 0,
                consent_version TEXT, consent_at TEXT,
                created_at TEXT NOT NULL, last_seen TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS konto_links (
                id TEXT PRIMARY KEY,
                email_hmac TEXT NOT NULL,
                email_enc TEXT NOT NULL,
                secret_hash TEXT NOT NULL,
                created_at TEXT NOT NULL, expires_at REAL NOT NULL,
                used_at TEXT, revoked INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS konto_sessions (
                id TEXT PRIMARY KEY,
                konto_id TEXT NOT NULL REFERENCES konten(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                via TEXT NOT NULL,                 -- code | link
                geraet TEXT,
                created_at TEXT NOT NULL, last_used TEXT NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS konto_daten (
                konto_id TEXT NOT NULL REFERENCES konten(id) ON DELETE CASCADE,
                app TEXT NOT NULL, id TEXT NOT NULL,
                data TEXT,                         -- NULL = gelöscht (Grabstein)
                bytes INTEGER NOT NULL DEFAULT 0,
                client_updated_at TEXT, updated_at TEXT NOT NULL,
                PRIMARY KEY (konto_id, app, id)
            );
            CREATE INDEX IF NOT EXISTS konto_daten_seit ON konto_daten (konto_id, app, updated_at);
            CREATE TABLE IF NOT EXISTS konto_fotos (
                konto_id TEXT NOT NULL REFERENCES konten(id) ON DELETE CASCADE,
                id TEXT NOT NULL, app TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
                PRIMARY KEY (konto_id, id)
            );
            CREATE TABLE IF NOT EXISTS foto_quota (
                email_hmac TEXT PRIMARY KEY,
                mb INTEGER NOT NULL,               -- zusätzlich freigegebene MB (gilt für Konto, eigene Gruppen und Kurse)
                decided_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS quota_antraege (
                id TEXT PRIMARY KEY,
                email_hmac TEXT NOT NULL,
                email_enc TEXT NOT NULL,
                bereich TEXT NOT NULL,             -- konto | gruppe | kurs
                wunsch_mb INTEGER NOT NULL,
                text_enc TEXT,
                status TEXT NOT NULL,              -- offen | ok | abgelehnt
                created_at TEXT NOT NULL, decided_at TEXT
            );
        ''')
        _purge(conn)


def _purge(conn):
    """Konten ohne Nutzung seit RETENTION_DAYS samt Daten und Fotos löschen; abgelaufene Links/Sitzungen entfernen."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    for r in conn.execute('SELECT id FROM konten WHERE last_seen < ?', (cutoff,)).fetchall():
        _fotos_weg(r['id'])
    conn.execute('DELETE FROM konten WHERE last_seen < ?', (cutoff,))
    conn.execute('DELETE FROM konto_links WHERE expires_at < ?', (time.time(),))
    conn.execute('DELETE FROM konto_sessions WHERE expires_at < ?', (time.time(),))


def _fotos_weg(konto_id):
    import shutil
    shutil.rmtree(os.path.join(FOTO_DIR, 'konto_' + konto_id), ignore_errors=True)


def _jetzt_fein():
    """Zeitstempel mit Mikrosekunden: Abgleich-Cursor («seit») darf keine Änderung derselben Sekunde verpassen."""
    return datetime.now(timezone.utc).isoformat()


def _err(code, status):
    return jsonify({'error': code}), status


# --- Kontingent (gemeinsam für Konto, Gruppen und Kurse) -------------------------------
def foto_limit(email_hmac, standard):
    """Standard-Kontingent plus vom Betreiber freigegebene Zusatz-MB für diese Adresse."""
    if not email_hmac:
        return standard
    with _db() as conn:
        r = conn.execute('SELECT mb FROM foto_quota WHERE email_hmac = ?', (email_hmac,)).fetchone()
    return standard + (r['mb'] * 1024 * 1024 if r else 0)


# --- Sitzung ---------------------------------------------------------------------------
def _konto(conn):
    tok = request.headers.get('X-Konto', '')
    if not TOKEN_RE.match(tok):
        return None
    s = conn.execute('SELECT s.id AS sid, s.expires_at, k.* FROM konto_sessions s JOIN konten k ON k.id = s.konto_id WHERE s.token_hash = ?',
                     (_sha('konto|' + tok),)).fetchone()
    if not s or s['expires_at'] < time.time():
        _rate_hit('konto_fail', limit=60, window=600)
        return None
    jetzt = _now()
    if (s['last_seen'] or '')[:10] != jetzt[:10]:
        conn.execute('UPDATE konten SET last_seen = ? WHERE id = ?', (jetzt, s['id']))
        conn.execute('UPDATE konto_sessions SET last_used = ? WHERE id = ?', (jetzt, s['sid']))
    return s


def konto_email(conn=None):
    """Für andere Module: bestätigte Adresse der aktuellen Sitzung (oder None)."""
    if conn is None:
        with _db() as c:
            k = _konto(c)
    else:
        k = _konto(conn)
    return M.email_dec(k['email_enc']) if k else None


def _geraet():
    ua = request.headers.get('User-Agent', '')[:300]
    teile = [n for n, p in (('iPhone', 'iPhone'), ('iPad', 'iPad'), ('Android', 'Android'), ('Windows', 'Windows'), ('Mac', 'Macintosh'), ('Linux', 'Linux')) if p in ua][:1]
    br = [n for n, p in (('Edge', 'Edg/'), ('Firefox', 'Firefox/'), ('Chrome', 'Chrome/'), ('Safari', 'Safari/')) if p in ua][:1]
    return ' · '.join(teile + br) or 'Browser'


def _anmelden(conn, email, via):
    eh = M.email_hmac(email)
    k = conn.execute('SELECT * FROM konten WHERE email_hmac = ?', (eh,)).fetchone()
    if not k:
        kid = secrets.token_urlsafe(9)
        conn.execute('INSERT INTO konten (id, email_hmac, email_enc, created_at, last_seen) VALUES (?, ?, ?, ?, ?)', (kid, eh, M.email_enc(email), _now(), _now()))
    else:
        kid = k['id']
        conn.execute('UPDATE konten SET last_seen = ? WHERE id = ?', (_now(), kid))
    tok = secrets.token_urlsafe(32)
    conn.execute('INSERT INTO konto_sessions (id, konto_id, token_hash, via, geraet, created_at, last_used, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                 (secrets.token_urlsafe(9), kid, _sha('konto|' + tok), via, _geraet(), _now(), _now(), time.time() + SESSION_TAGE * 86400))
    return tok


# --- Anmeldung -----------------------------------------------------------------------------
@v2.route('/v2/api/konto/code', methods=['POST'])
def konto_code():
    """Code (15 Min.) und Anmelde-Link (24 Monate) per E-Mail. Frühere Links bleiben gültig."""
    _rate_hit('konto_code', limit=10, window=3600)
    body = _json_body() or {}
    email = M.email_norm(body.get('email'))
    if not M.email_ok(email):
        return _err('BAD_REQUEST', 400)
    # Link nur auf diesen Server: Host aus der Anfrage (Traefik leitet nur die echte Domain weiter), nie fremde Domains
    from urllib.parse import urlsplit
    basis = str(body.get('appUrl') or '')
    u = urlsplit(basis)
    lokal = u.hostname in ('localhost', '127.0.0.1')
    if u.netloc != request.host or (u.scheme != 'https' and not lokal) or not re.match(r'^/[A-Za-z0-9/_.-]*$', u.path or '/') or u.query or u.fragment:
        basis = 'https://' + request.host + '/futter/v2/'
    else:
        basis = u.scheme + '://' + u.netloc + (u.path or '/')
    code = M.code_erzeugen('konto', email)
    lid, geheim = secrets.token_urlsafe(9), secrets.token_urlsafe(32)
    eh = M.email_hmac(email)
    with _db() as conn:
        conn.execute('INSERT INTO konto_links (id, email_hmac, email_enc, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
                     (lid, eh, M.email_enc(email), _sha('link|' + geheim), _now(), time.time() + LINK_TAGE * 86400))
        alte = conn.execute('SELECT id FROM konto_links WHERE email_hmac = ? AND revoked = 0 ORDER BY created_at DESC LIMIT -1 OFFSET ?', (eh, MAX_LINKS)).fetchall()
        for r in alte:
            conn.execute('UPDATE konto_links SET revoked = 1 WHERE id = ?', (r['id'],))
    link = basis + '#login=' + lid + '.' + geheim
    M.login_senden(email, code, link)
    return jsonify({'status': 'sent'})


@v2.route('/v2/api/konto/login', methods=['POST'])
def konto_login():
    _rate_hit('konto_login', limit=30, window=900)
    body = _json_body() or {}
    link = str(body.get('link') or '')
    with _db() as conn:
        _purge(conn)
    if link:
        m = re.match(r'^([A-Za-z0-9_-]{6,20})\.([A-Za-z0-9_-]{43})$', link)
        with _db() as conn:
            r = conn.execute('SELECT * FROM konto_links WHERE id = ?', (m.group(1),)).fetchone() if m else None
            if not r or r['revoked'] or r['expires_at'] < time.time() or not hmac.compare_digest(r['secret_hash'], _sha('link|' + m.group(2))):
                _rate_hit('konto_link_fail', limit=10, window=900)
                return _err('LINK_UNGUELTIG', 404)
            email = M.email_dec(r['email_enc'])
            if not email:
                return _err('LINK_UNGUELTIG', 404)
            conn.execute('UPDATE konto_links SET used_at = ? WHERE id = ?', (_now(), r['id']))
            tok = _anmelden(conn, email, 'link')
    else:
        email = M.email_norm(body.get('email'))
        # Code in eigener Verbindung prüfen (nicht innerhalb einer offenen Schreib-Transaktion)
        if not M.email_ok(email) or not M.code_pruefen('konto', email, body.get('code')):
            return _err('CODE_INVALID', 400)
        with _db() as conn:
            tok = _anmelden(conn, email, 'code')
    return jsonify({'session': tok, 'email': email})


@v2.route('/v2/api/konto', methods=['GET'])
def konto_info():
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        links = conn.execute('SELECT id, created_at, expires_at, used_at FROM konto_links WHERE email_hmac = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC',
                             (k['email_hmac'], time.time())).fetchall()
        sess = conn.execute('SELECT id, via, geraet, created_at, last_used FROM konto_sessions WHERE konto_id = ? AND expires_at > ? ORDER BY last_used DESC', (k['id'], time.time())).fetchall()
        n = {a: conn.execute('SELECT COUNT(*) FROM konto_daten WHERE konto_id = ? AND app = ? AND data IS NOT NULL', (k['id'], a)).fetchone()[0] for a in APPS}
        fb = conn.execute('SELECT COALESCE(SUM(bytes), 0) FROM konto_fotos WHERE konto_id = ?', (k['id'],)).fetchone()[0]
        antrag = conn.execute("SELECT wunsch_mb, created_at FROM quota_antraege WHERE email_hmac = ? AND status = 'offen' ORDER BY created_at DESC LIMIT 1", (k['email_hmac'],)).fetchone()
    return jsonify({
        'email': M.email_dec(k['email_enc']), 'createdAt': k['created_at'],
        'cloud': {'futter': bool(k['cloud_futter']), 'wiese': bool(k['cloud_wiese'])}, 'anzahl': n,
        'fotos': {'bytes': fb, 'limit': foto_limit(k['email_hmac'], FOTO_STANDARD), 'antrag': dict(antrag) if antrag else None},
        'links': [{'id': r['id'], 'createdAt': r['created_at'], 'expiresAt': r['expires_at'], 'usedAt': r['used_at']} for r in links],
        'geraete': [{'id': r['id'], 'via': r['via'], 'geraet': r['geraet'], 'createdAt': r['created_at'], 'lastUsed': r['last_used'], 'ich': r['id'] == k['sid']} for r in sess],
        'retentionDays': RETENTION_DAYS, 'consentVersion': CONSENT_VERSION_KONTO,
    })


@v2.route('/v2/api/konto/links/<lid>', methods=['DELETE'])
def konto_link_weg(lid):
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        conn.execute('UPDATE konto_links SET revoked = 1 WHERE id = ? AND email_hmac = ?', (lid, k['email_hmac']))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/konto/links', methods=['DELETE'])
def konto_links_alle_weg():
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        conn.execute('UPDATE konto_links SET revoked = 1 WHERE email_hmac = ?', (k['email_hmac'],))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/konto/geraete/<sid>', methods=['DELETE'])
def konto_geraet_weg(sid):
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        conn.execute('DELETE FROM konto_sessions WHERE id = ? AND konto_id = ?', (sid, k['id']))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/konto/logout', methods=['POST'])
def konto_logout():
    with _db() as conn:
        k = _konto(conn)
        if k:
            conn.execute('DELETE FROM konto_sessions WHERE id = ?', (k['sid'],))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/konto/cloud', methods=['PUT'])
def konto_cloud():
    """Cloud-Speicherung je App ein/aus. Aus + «loeschen» entfernt die Daten (und Fotos) dieser App vom Server."""
    body = _json_body() or {}
    app, an = body.get('app'), body.get('an')
    if app not in APPS or not isinstance(an, bool):
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        if an:
            c = body.get('consent') or {}
            if c.get('accepted') is not True or c.get('version') != CONSENT_VERSION_KONTO:
                return jsonify({'error': 'CONSENT_REQUIRED', 'consentVersion': CONSENT_VERSION_KONTO}), 400
            conn.execute(f'UPDATE konten SET cloud_{app} = 1, consent_version = ?, consent_at = ? WHERE id = ?', (CONSENT_VERSION_KONTO, _now(), k['id']))
        else:
            conn.execute(f'UPDATE konten SET cloud_{app} = 0 WHERE id = ?', (k['id'],))
            if body.get('loeschen'):
                _app_loeschen(conn, k['id'], app)
    return jsonify({'status': 'ok'})


def _app_loeschen(conn, konto_id, app):
    conn.execute('DELETE FROM konto_daten WHERE konto_id = ? AND app = ?', (konto_id, app))
    for f in conn.execute('SELECT id FROM konto_fotos WHERE konto_id = ? AND app = ?', (konto_id, app)).fetchall():
        try:
            os.remove(_foto_pfad(konto_id, f['id']))
        except FileNotFoundError:
            pass
    conn.execute('DELETE FROM konto_fotos WHERE konto_id = ? AND app = ?', (konto_id, app))


@v2.route('/v2/api/konto', methods=['DELETE'])
def konto_loeschen():
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        conn.execute('DELETE FROM konten WHERE id = ?', (k['id'],))
        conn.execute('UPDATE konto_links SET revoked = 1 WHERE email_hmac = ?', (k['email_hmac'],))
    _fotos_weg(k['id'])
    return jsonify({'status': 'deleted'})


# --- Daten -------------------------------------------------------------------------------
def _app_ok(app, k):
    return app in APPS and bool(k[f'cloud_{app}'])


@v2.route('/v2/api/konto/daten/<app>', methods=['GET'])
def konto_daten_lesen(app):
    seit = str(request.args.get('seit') or '')[:40]
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        if not _app_ok(app, k):
            return _err('CLOUD_AUS', 409)
        rows = conn.execute('SELECT id, data, client_updated_at, updated_at FROM konto_daten WHERE konto_id = ? AND app = ? AND updated_at > ? ORDER BY updated_at',
                            (k['id'], app, seit)).fetchall()
    return jsonify({'records': [{'id': r['id'], 'data': json.loads(r['data']) if r['data'] else None, 'clientUpdatedAt': r['client_updated_at'], 'updatedAt': r['updated_at']} for r in rows],
                    'stand': max([r['updated_at'] for r in rows], default=seit)})


def _tiefe_ok(v, t=0):
    if t > 10:
        return False
    if isinstance(v, dict):
        return len(v) <= 400 and all(isinstance(x, str) and len(x) <= 100 and _tiefe_ok(y, t + 1) for x, y in v.items())
    if isinstance(v, list):
        return len(v) <= 2000 and all(_tiefe_ok(x, t + 1) for x in v)
    return v is None or isinstance(v, (bool, int, float)) or (isinstance(v, str) and len(v) <= 20000)


@v2.route('/v2/api/konto/daten/<app>', methods=['PUT'])
def konto_daten_schreiben(app):
    """Stapel: {records: [{id, data|null, updatedAt}]}. Ältere Fassungen als die gespeicherte werden übergangen."""
    raw = request.get_data(cache=False, as_text=True)
    if len(raw.encode('utf-8')) > 8 * 1024 * 1024:
        return _err('TOO_LARGE', 413)
    try:
        recs = json.loads(raw).get('records')
    except (ValueError, AttributeError):
        return _err('BAD_JSON', 400)
    if not isinstance(recs, list) or len(recs) > 300:
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        if not _app_ok(app, k):
            return _err('CLOUD_AUS', 409)
        n = conn.execute('SELECT COUNT(*) FROM konto_daten WHERE konto_id = ? AND app = ?', (k['id'], app)).fetchone()[0]
        total = conn.execute('SELECT COALESCE(SUM(bytes), 0) FROM konto_daten WHERE konto_id = ?', (k['id'],)).fetchone()[0]
        ok, alt = [], []
        jetzt = _jetzt_fein()
        for r in recs:
            if not isinstance(r, dict) or not REC_ID_RE.match(str(r.get('id', ''))):
                return _err('BAD_ID', 400)
            d = r.get('data')
            if d is not None and (not isinstance(d, (dict, list)) or not _tiefe_ok(d)):
                return _err('REJECTED_CONTENT', 422)
            txt = json.dumps(d, ensure_ascii=False, separators=(',', ':')) if d is not None else None
            b = len(txt.encode('utf-8')) if txt else 0
            if b > MAX_REC_BYTES:
                return _err('TOO_LARGE', 413)
            cu = str(r.get('updatedAt') or '')[:40]
            ex = conn.execute('SELECT client_updated_at, bytes FROM konto_daten WHERE konto_id = ? AND app = ? AND id = ?', (k['id'], app, r['id'])).fetchone()
            if ex and ex['client_updated_at'] and cu and ex['client_updated_at'] > cu:
                alt.append(r['id'])
                continue
            if not ex:
                n += 1
                if n > MAX_RECS:
                    return _err('ZU_VIELE', 409)
            total += b - (ex['bytes'] if ex else 0)
            if total > MAX_DATEN_BYTES:
                return _err('SPEICHER_VOLL', 409)
            conn.execute('INSERT INTO konto_daten (konto_id, app, id, data, bytes, client_updated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) '
                         'ON CONFLICT(konto_id, app, id) DO UPDATE SET data = excluded.data, bytes = excluded.bytes, client_updated_at = excluded.client_updated_at, updated_at = excluded.updated_at',
                         (k['id'], app, r['id'], txt, b, cu, jetzt))
            ok.append(r['id'])
    return jsonify({'ok': ok, 'stale': alt, 'stand': jetzt})


# --- Fotos -----------------------------------------------------------------------------
def _foto_pfad(konto_id, foto_id):
    return os.path.join(FOTO_DIR, 'konto_' + konto_id, foto_id + '.bin')


@v2.route('/v2/api/konto/fotos/<foto_id>', methods=['PUT'])
def konto_foto_put(foto_id):
    app = request.args.get('app', '')
    if not FOTO_ID_RE.match(foto_id) or app not in APPS:
        return _err('BAD_REQUEST', 400)
    if (request.content_length or 0) > MAX_FOTO_BYTES:
        return _err('TOO_LARGE', 413)
    data = request.get_data(cache=False)
    if len(data) > MAX_FOTO_BYTES or len(data) < 100 or not _bild_typ(data[:12]):
        return _err('REJECTED_CONTENT', 422)
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        if not _app_ok(app, k):
            return _err('CLOUD_AUS', 409)
        belegt = conn.execute('SELECT COALESCE(SUM(bytes), 0) FROM konto_fotos WHERE konto_id = ? AND id != ?', (k['id'], foto_id)).fetchone()[0]
        limit = foto_limit(k['email_hmac'], FOTO_STANDARD)
        if belegt + len(data) > limit:
            return jsonify({'error': 'QUOTA', 'bytes': belegt, 'limit': limit}), 409
        if not ADM.foto_platz_frei(len(data)):
            return _err('SERVER_VOLL', 507)
        os.makedirs(os.path.dirname(_foto_pfad(k['id'], foto_id)), exist_ok=True)
        tmp = _foto_pfad(k['id'], foto_id) + '.tmp'
        with open(tmp, 'wb') as fh:
            fh.write(data)
        os.replace(tmp, _foto_pfad(k['id'], foto_id))
        conn.execute('INSERT INTO konto_fotos (konto_id, id, app, bytes, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(konto_id, id) DO UPDATE SET bytes = excluded.bytes',
                     (k['id'], foto_id, app, len(data), _now()))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/konto/fotos/<foto_id>', methods=['GET'])
def konto_foto_get(foto_id):
    if not FOTO_ID_RE.match(foto_id):
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        k = _konto(conn)
        if not k or not conn.execute('SELECT 1 FROM konto_fotos WHERE konto_id = ? AND id = ?', (k['id'], foto_id)).fetchone():
            return _err('NOT_FOUND', 404)
    return bild_senden(os.path.dirname(_foto_pfad(k['id'], foto_id)), foto_id + '.bin')


@v2.route('/v2/api/konto/fotos', methods=['GET'])
def konto_foto_liste():
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        rows = conn.execute('SELECT id, app FROM konto_fotos WHERE konto_id = ?', (k['id'],)).fetchall()
    return jsonify({'fotos': [{'id': r['id'], 'app': r['app']} for r in rows]})


@v2.route('/v2/api/konto/fotos/<foto_id>', methods=['DELETE'])
def konto_foto_delete(foto_id):
    if not FOTO_ID_RE.match(foto_id):
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        k = _konto(conn)
        if not k:
            return _err('NOT_FOUND', 404)
        conn.execute('DELETE FROM konto_fotos WHERE konto_id = ? AND id = ?', (k['id'], foto_id))
    try:
        os.remove(_foto_pfad(k['id'], foto_id))
    except FileNotFoundError:
        pass
    return jsonify({'status': 'deleted'})


# --- Antrag auf mehr Foto-Speicher ----------------------------------------------------------
@v2.route('/v2/api/quota-antrag', methods=['POST'])
def quota_antrag():
    """Mit Konto-Sitzung (bevorzugt) oder Adresse + Code («quota»)."""
    _rate_hit('quota_antrag', limit=5, window=3600)
    body = _json_body() or {}
    bereich = body.get('bereich') if body.get('bereich') in ('konto', 'gruppe', 'kurs') else 'konto'
    try:
        wunsch = max(10, min(5000, int(body.get('wunschMb') or 0)))
    except (TypeError, ValueError):
        return _err('BAD_REQUEST', 400)
    text = str(body.get('begruendung') or '').strip()[:1000]
    email = konto_email()
    if not email:
        email = M.email_norm(body.get('email'))
        if not M.email_ok(email) or not M.code_pruefen('quota', email, body.get('code')):
            return _err('CODE_INVALID', 400)
    with _db() as conn:
        conn.execute("INSERT INTO quota_antraege (id, email_hmac, email_enc, bereich, wunsch_mb, text_enc, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'offen', ?)",
                     (secrets.token_urlsafe(9), M.email_hmac(email), M.email_enc(email), bereich, wunsch, M.text_enc(text, b'quota') if text else None, _now()))
    adm = M.admin_adresse()
    if adm:
        M.senden(adm, 'Antrag: mehr Foto-Speicher', f'Neuer Antrag auf {wunsch} MB zusätzlichen Foto-Speicher ({bereich}). Bitte auf der Admin-Seite entscheiden.\n')
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/quota-antrag/code', methods=['POST'])
def quota_antrag_code():
    _rate_hit('quota_code', limit=10, window=3600)
    email = M.email_norm((_json_body() or {}).get('email'))
    if not M.email_ok(email):
        return _err('BAD_REQUEST', 400)
    M.code_senden('quota', email, 'Antrag Foto-Speicher')
    return jsonify({'status': 'sent'})


@v2.route('/v2/api/admin/quota', methods=['GET'])
def admin_quota_liste():
    if not ADM._admin_ok():
        return _err('NOT_FOUND', 404)
    with _db() as conn:
        rows = conn.execute("SELECT * FROM quota_antraege ORDER BY status = 'offen' DESC, created_at DESC LIMIT 200").fetchall()
        q = {r['email_hmac']: r['mb'] for r in conn.execute('SELECT * FROM foto_quota').fetchall()}
        konten = conn.execute('SELECT COUNT(*) FROM konten').fetchone()[0]
    return jsonify({'konten': konten, 'antraege': [{'id': r['id'], 'email': M.email_dec(r['email_enc']), 'bereich': r['bereich'], 'wunschMb': r['wunsch_mb'],
                                                   'text': M.text_dec(r['text_enc'], b'quota') if r['text_enc'] else None, 'status': r['status'],
                                                   'createdAt': r['created_at'], 'zusatzMb': q.get(r['email_hmac'], 0)} for r in rows]})


@v2.route('/v2/api/admin/quota/<aid>', methods=['POST'])
def admin_quota_entscheid(aid):
    if not ADM._admin_ok():
        return _err('NOT_FOUND', 404)
    b = _json_body() or {}
    status = b.get('status')
    if status not in ('ok', 'abgelehnt'):
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        r = conn.execute('SELECT * FROM quota_antraege WHERE id = ?', (aid,)).fetchone()
        if not r:
            return _err('NOT_FOUND', 404)
        mb = r['wunsch_mb']
        if status == 'ok':
            try:
                mb = max(1, min(20000, int(b.get('mb') or r['wunsch_mb'])))
            except (TypeError, ValueError):
                return _err('BAD_REQUEST', 400)
            conn.execute('INSERT INTO foto_quota (email_hmac, mb, decided_at) VALUES (?, ?, ?) ON CONFLICT(email_hmac) DO UPDATE SET mb = excluded.mb, decided_at = excluded.decided_at',
                         (r['email_hmac'], mb, _now()))
        conn.execute('UPDATE quota_antraege SET status = ?, decided_at = ? WHERE id = ?', (status, _now(), aid))
    email = M.email_dec(r['email_enc'])
    if email:
        M.senden(email, 'Ihr Antrag Foto-Speicher', (f'Ihr Antrag wurde angenommen: zusätzlich {mb} MB Foto-Speicher.\n' if status == 'ok'
                                                     else 'Ihr Antrag auf mehr Foto-Speicher wurde leider nicht angenommen.\n'))
    return jsonify({'status': 'ok'})


_ = RateLimited
