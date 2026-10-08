"""Futter v2 – Kursmodus (Schulklassen, Gruppen, Kurse).

Sicherheitsmodell
- Kurs-Link «#k=<id>.<geheimnis>»: Aus dem Geheimnis leitet der Browser den Kursschlüssel
  (Ende-zu-Ende für Kurstitel, Namen, Probenbezeichnungen, Notizen) und ein Beitritts-Token ab.
  Der Server kennt nur den Hash des Beitritts-Tokens.
- Anmeldung per E-Mail-Code (6 Ziffern, 15 Min., max. 5 Versuche). E-Mail-Adressen liegen
  mit Server-Schlüssel verschlüsselt (AES-GCM) in der DB, Suche über HMAC. Die Kursleitung
  sieht Adressen vollständig, alle anderen nur gekürzt.
- Beurteilungen anderer gibt der Server erst frei, wenn die eigene Beurteilung derselben
  Probe abgegeben ist. Abgegebene Beurteilungen sind gesperrt.
- Lesbar sind nur Analysedaten (gleiche Whitelist wie bei Freigaben).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import ssl
import sys
import threading
import time
from email.message import EmailMessage

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import jsonify, request

from v2_api import (v2, _db, _now, _sha, _rate_hit, _check_record, _check_privat, _json_body,
                    ID_RE, HASH_RE, TOKEN_RE, RETENTION_DAYS, MAX_RECORD_BYTES)

KURS_CONSENT_VERSION = '2026-10-k1'
CODE_TTL = 15 * 60
CODE_ATTEMPTS = 5
SESSION_TTL = 60 * 24 * 3600
EMAIL_RE = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$')
MAX_PROBEN = 60
MAX_TEILNEHMENDE = 300


# --- Server-Schlüssel (nur für E-Mail-Adressen) ------------------------------------
def _server_key():
    raw = os.environ.get('V2_SERVER_KEY', '')
    try:
        key = base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4))
    except ValueError:
        key = b''
    if len(key) != 32:
        raise RuntimeError('V2_SERVER_KEY fehlt oder ist ungültig (32 Byte base64url erwartet)')
    return key


def _email_norm(email):
    return (email or '').strip().lower()


def _email_hmac(email):
    return hmac.new(_server_key(), b'email|' + _email_norm(email).encode(), hashlib.sha256).hexdigest()


def _email_enc(email):
    nonce = secrets.token_bytes(12)
    ct = AESGCM(_server_key()).encrypt(nonce, _email_norm(email).encode(), b'agff-email')
    return base64.urlsafe_b64encode(nonce + ct).decode()


def _email_dec(blob):
    try:
        raw = base64.urlsafe_b64decode(blob)
        return AESGCM(_server_key()).decrypt(raw[:12], raw[12:], b'agff-email').decode()
    except Exception:  # noqa: BLE001 – unlesbar = nicht anzeigen
        return None


def _email_mask(email):
    if not email or '@' not in email:
        return '…'
    local, domain = email.split('@', 1)
    head = local[:2] if len(local) > 3 else local[:1]
    tld = domain.rsplit('.', 1)[-1]
    return f'{head}…@…{domain.rsplit(".", 1)[0][-2:]}.{tld}' if '.' in domain else f'{head}…@…'


# --- Mailversand (im Hintergrund, Antwort unabhängig vom Ergebnis) ---------------------
def _send_code_mail(to_addr, code):
    if os.environ.get('V2_MAIL_DRYRUN') == '1':  # nur für automatische Tests
        _DRYRUN_OUTBOX.append((to_addr, code))
        if os.environ.get('V2_MAIL_DRYRUN_FILE'):
            with open(os.environ['V2_MAIL_DRYRUN_FILE'], 'a') as fh:
                fh.write(json.dumps({'to': to_addr, 'code': code}) + '\n')
        return
    host, user, pw = os.environ.get('SMTP_HOST'), os.environ.get('SMTP_USER'), os.environ.get('SMTP_PASS')
    sender = os.environ.get('SMTP_FROM') or user
    if not (host and user and pw):
        print('KURS: SMTP nicht konfiguriert – Code nicht versendet', file=sys.stderr)
        return
    msg = EmailMessage()
    msg['Subject'] = f'Ihr Anmeldecode: {code}'
    msg['From'] = f'Futterbeurteilung <{sender}>'
    msg['To'] = to_addr
    msg['Auto-Submitted'] = 'auto-generated'
    msg.set_content(
        f'Ihr Anmeldecode für die Futterbeurteilung (Kurs) lautet:\n\n    {code}\n\n'
        'Der Code ist 15 Minuten gültig. Geben Sie ihn in der App ein.\n\n'
        'Falls Sie keinen Code angefordert haben, können Sie diese E-Mail ignorieren.\n\n'
        '-- \nAGFF Futterbeurteilung v2 · apps.graswachstum.ch\n'
        'Diese Nachricht wurde automatisch versendet. Bitte nicht antworten.\n')

    def run():
        try:
            with smtplib.SMTP_SSL(host, 465, timeout=20, context=ssl.create_default_context()) as s:
                s.login(user, pw)
                s.send_message(msg)
        except Exception as e:  # noqa: BLE001
            print(f'KURS: Mailversand fehlgeschlagen: {type(e).__name__}', file=sys.stderr)
    threading.Thread(target=run, daemon=True).start()


_DRYRUN_OUTBOX = []


# --- Datenbank ---------------------------------------------------------------------
def init_kurs_db():
    with _db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS kurse (
                id TEXT PRIMARY KEY,
                join_hash TEXT NOT NULL,
                status TEXT NOT NULL,                 -- pending | aktiv
                pending_email_hmac TEXT,
                meta_analyse TEXT, meta_privat TEXT,
                consent_version TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS kurs_teilnehmende (
                id TEXT PRIMARY KEY,
                kurs_id TEXT NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
                email_hmac TEXT NOT NULL, email_enc TEXT NOT NULL,
                name_privat TEXT,
                rolle TEXT NOT NULL,                  -- leitung | teilnahme
                consent_version TEXT NOT NULL, consent_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (kurs_id, email_hmac)
            );
            CREATE TABLE IF NOT EXISTS kurs_codes (
                kurs_id TEXT NOT NULL, email_hmac TEXT NOT NULL,
                code_hash TEXT NOT NULL, expires_at REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (kurs_id, email_hmac)
            );
            CREATE TABLE IF NOT EXISTS kurs_sessions (
                token_hash TEXT PRIMARY KEY,
                teilnehmer_id TEXT NOT NULL REFERENCES kurs_teilnehmende(id) ON DELETE CASCADE,
                kurs_id TEXT NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS kurs_proben (
                kurs_id TEXT NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
                id TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
                analyse TEXT NOT NULL, privat TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (kurs_id, id)
            );
            CREATE TABLE IF NOT EXISTS kurs_beurteilungen (
                kurs_id TEXT NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
                probe_id TEXT NOT NULL,
                teilnehmer_id TEXT NOT NULL REFERENCES kurs_teilnehmende(id) ON DELETE CASCADE,
                analyse TEXT NOT NULL, privat TEXT,
                abgegeben_at TEXT NOT NULL,
                PRIMARY KEY (kurs_id, probe_id, teilnehmer_id)
            );
        ''')
        # Abgelaufenes aufräumen
        conn.execute('DELETE FROM kurs_codes WHERE expires_at < ?', (time.time(),))
        conn.execute('DELETE FROM kurs_sessions WHERE expires_at < ?', (time.time(),))
        conn.execute("DELETE FROM kurse WHERE status = 'pending' AND created_at < ?",
                     (time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - 86400)),))


def _purge(conn):
    cutoff = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - RETENTION_DAYS * 86400))
    conn.execute('DELETE FROM kurse WHERE updated_at < ?', (cutoff,))
    conn.execute('DELETE FROM kurs_codes WHERE expires_at < ?', (time.time(),))
    conn.execute('DELETE FROM kurs_sessions WHERE expires_at < ?', (time.time(),))


def _touch(conn, kurs_id):
    conn.execute('UPDATE kurse SET updated_at = ? WHERE id = ?', (_now(), kurs_id))


def _session(conn, kurs_id):
    """Angemeldete Person (Zeile) oder None."""
    tok = request.headers.get('X-Kurs-Session', '')
    if not TOKEN_RE.match(tok) or not ID_RE.match(kurs_id or ''):
        return None
    row = conn.execute('SELECT t.* FROM kurs_sessions s JOIN kurs_teilnehmende t ON t.id = s.teilnehmer_id '
                       'WHERE s.token_hash = ? AND s.kurs_id = ? AND s.expires_at > ?', (_sha(tok), kurs_id, time.time())).fetchone()
    if not row:
        _rate_hit('auth_fail', limit=60, window=600)
        return None
    conn.execute('UPDATE kurs_sessions SET expires_at = ? WHERE token_hash = ?', (time.time() + SESSION_TTL, _sha(tok)))
    return row


def _err(code, status):
    return jsonify({'error': code}), status


def _new_code(conn, kurs_id, email):
    code = f'{secrets.randbelow(1_000_000):06d}'
    conn.execute('INSERT INTO kurs_codes (kurs_id, email_hmac, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0) '
                 'ON CONFLICT(kurs_id, email_hmac) DO UPDATE SET code_hash = excluded.code_hash, '
                 'expires_at = excluded.expires_at, attempts = 0',
                 (kurs_id, _email_hmac(email), _sha(kurs_id + '|' + code), time.time() + CODE_TTL))
    return code


# --- Kurs anlegen / Anmelden --------------------------------------------------------
@v2.route('/v2/api/kurse', methods=['POST'])
def kurs_anlegen():
    _rate_hit('kurs_create', limit=10, window=3600)
    body = _json_body() or {}
    consent = body.get('consent') or {}
    if consent.get('accepted') is not True:
        return _err('CONSENT_REQUIRED', 400)
    if consent.get('version') != KURS_CONSENT_VERSION:
        return jsonify({'error': 'CONSENT_OUTDATED', 'consentVersion': KURS_CONSENT_VERSION}), 409
    email, join_hash = _email_norm(body.get('email')), body.get('joinHash', '')
    if not EMAIL_RE.match(email) or not HASH_RE.match(join_hash):
        return _err('BAD_REQUEST', 400)
    _rate_hit('code_mail:' + _email_hmac(email), limit=5, window=3600)
    kurs_id = secrets.token_urlsafe(9)
    now = _now()
    with _db() as conn:
        _purge(conn)
        conn.execute('INSERT INTO kurse (id, join_hash, status, pending_email_hmac, consent_version, created_at, updated_at) '
                     "VALUES (?, ?, 'pending', ?, ?, ?, ?)", (kurs_id, join_hash, _email_hmac(email), KURS_CONSENT_VERSION, now, now))
        code = _new_code(conn, kurs_id, email)
    _send_code_mail(email, code)
    return jsonify({'id': kurs_id, 'consentVersion': KURS_CONSENT_VERSION}), 201


@v2.route('/v2/api/kurse/<kurs_id>/code', methods=['POST'])
def kurs_code(kurs_id):
    """Code für Beitritt oder erneute Anmeldung. Antwortet immer gleich (keine Auskunft, ob Adresse bekannt)."""
    _rate_hit('kurs_code', limit=20, window=3600)
    body = _json_body() or {}
    email, join_token = _email_norm(body.get('email')), body.get('joinToken', '')
    if not EMAIL_RE.match(email) or not TOKEN_RE.match(join_token) or not ID_RE.match(kurs_id):
        return _err('BAD_REQUEST', 400)
    _rate_hit('code_mail:' + _email_hmac(email), limit=5, window=3600)
    with _db() as conn:
        k = conn.execute("SELECT join_hash, status FROM kurse WHERE id = ?", (kurs_id,)).fetchone()
        if not k or k['status'] != 'aktiv' or not hmac.compare_digest(k['join_hash'], _sha(join_token)):
            _rate_hit('auth_fail', limit=60, window=600)
            return _err('NOT_FOUND', 404)
        code = _new_code(conn, kurs_id, email)
    _send_code_mail(email, code)
    return jsonify({'status': 'sent'})


@v2.route('/v2/api/kurse/<kurs_id>/verify', methods=['POST'])
def kurs_verify(kurs_id):
    body = _json_body() or {}
    email, code = _email_norm(body.get('email')), str(body.get('code') or '').strip()
    if not EMAIL_RE.match(email) or not re.match(r'^\d{6}$', code) or not ID_RE.match(kurs_id):
        return _err('BAD_REQUEST', 400)
    eh = _email_hmac(email)
    with _db() as conn:
        c = conn.execute('SELECT * FROM kurs_codes WHERE kurs_id = ? AND email_hmac = ?', (kurs_id, eh)).fetchone()
        if not c or c['expires_at'] < time.time():
            return _err('CODE_INVALID', 400)
        if not hmac.compare_digest(c['code_hash'], _sha(kurs_id + '|' + code)):
            if c['attempts'] + 1 >= CODE_ATTEMPTS:
                conn.execute('DELETE FROM kurs_codes WHERE kurs_id = ? AND email_hmac = ?', (kurs_id, eh))
            else:
                conn.execute('UPDATE kurs_codes SET attempts = attempts + 1 WHERE kurs_id = ? AND email_hmac = ?', (kurs_id, eh))
            return _err('CODE_INVALID', 400)
        conn.execute('DELETE FROM kurs_codes WHERE kurs_id = ? AND email_hmac = ?', (kurs_id, eh))
        kurs = conn.execute('SELECT * FROM kurse WHERE id = ?', (kurs_id,)).fetchone()
        if not kurs:
            return _err('NOT_FOUND', 404)
        person = conn.execute('SELECT * FROM kurs_teilnehmende WHERE kurs_id = ? AND email_hmac = ?', (kurs_id, eh)).fetchone()
        neu = False
        if not person:
            consent = body.get('consent') or {}
            if consent.get('accepted') is not True or consent.get('version') != KURS_CONSENT_VERSION:
                return _err('CONSENT_REQUIRED', 400)
            if kurs['status'] == 'pending':
                if not hmac.compare_digest(kurs['pending_email_hmac'] or '', eh):
                    return _err('NOT_FOUND', 404)
                rolle = 'leitung'
                conn.execute("UPDATE kurse SET status = 'aktiv', pending_email_hmac = NULL WHERE id = ?", (kurs_id,))
            else:
                count = conn.execute('SELECT COUNT(*) FROM kurs_teilnehmende WHERE kurs_id = ?', (kurs_id,)).fetchone()[0]
                if count >= MAX_TEILNEHMENDE:
                    return _err('KURS_VOLL', 409)
                rolle = 'teilnahme'
            pid = secrets.token_urlsafe(9)
            conn.execute('INSERT INTO kurs_teilnehmende (id, kurs_id, email_hmac, email_enc, rolle, consent_version, consent_at, created_at) '
                         'VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (pid, kurs_id, eh, _email_enc(email), rolle, KURS_CONSENT_VERSION, _now(), _now()))
            person = conn.execute('SELECT * FROM kurs_teilnehmende WHERE id = ?', (pid,)).fetchone()
            neu = True
        token = secrets.token_urlsafe(32)[:43]
        conn.execute('INSERT INTO kurs_sessions (token_hash, teilnehmer_id, kurs_id, expires_at) VALUES (?, ?, ?, ?)',
                     (_sha(token), person['id'], kurs_id, time.time() + SESSION_TTL))
        _touch(conn, kurs_id)
    return jsonify({'session': token, 'ich': {'id': person['id'], 'rolle': person['rolle']}, 'neu': neu})


@v2.route('/v2/api/kurse/<kurs_id>/logout', methods=['POST'])
def kurs_logout(kurs_id):
    tok = request.headers.get('X-Kurs-Session', '')
    with _db() as conn:
        conn.execute('DELETE FROM kurs_sessions WHERE token_hash = ? AND kurs_id = ?', (_sha(tok), kurs_id))
    return jsonify({'status': 'ok'})


# --- Kurs lesen / verwalten ---------------------------------------------------------
def _box(v):
    return json.loads(v) if v else None


@v2.route('/v2/api/kurse/<kurs_id>', methods=['GET'])
def kurs_lesen(kurs_id):
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich:
            return _err('NOT_FOUND', 404)
        k = conn.execute('SELECT * FROM kurse WHERE id = ?', (kurs_id,)).fetchone()
        leitung = ich['rolle'] == 'leitung'
        personen = conn.execute('SELECT id, rolle, name_privat, email_enc, created_at FROM kurs_teilnehmende WHERE kurs_id = ? ORDER BY rolle = ? DESC, created_at',
                                (kurs_id, 'leitung')).fetchall()
        proben = conn.execute('SELECT id, sort, analyse, privat FROM kurs_proben WHERE kurs_id = ? ORDER BY sort, id', (kurs_id,)).fetchall()
        abgaben = {r['probe_id']: r['n'] for r in conn.execute(
            'SELECT probe_id, COUNT(*) AS n FROM kurs_beurteilungen WHERE kurs_id = ? GROUP BY probe_id', (kurs_id,))}
        meine = {r['probe_id']: r['abgegeben_at'] for r in conn.execute(
            'SELECT probe_id, abgegeben_at FROM kurs_beurteilungen WHERE kurs_id = ? AND teilnehmer_id = ?', (kurs_id, ich['id']))}
    teilnehmende = []
    for p in personen:
        email = _email_dec(p['email_enc'])
        teilnehmende.append({'id': p['id'], 'rolle': p['rolle'], 'name': _box(p['name_privat']),
                             'email': email if (leitung or p['id'] == ich['id']) else _email_mask(email)})
    return jsonify({
        'kurs': {'id': k['id'], 'meta': {'analyse': _box(k['meta_analyse']) or {}, 'privat': _box(k['meta_privat'])},
                 'createdAt': k['created_at'], 'updatedAt': k['updated_at']},
        'ich': {'id': ich['id'], 'rolle': ich['rolle']},
        'teilnehmende': teilnehmende,
        'proben': [{'id': r['id'], 'sort': r['sort'], 'analyse': _box(r['analyse']), 'privat': _box(r['privat']),
                    'abgaben': abgaben.get(r['id'], 0), 'meineAbgabe': meine.get(r['id'])} for r in proben],
        'retentionDays': RETENTION_DAYS,
    })


def _leitung(conn, kurs_id):
    ich = _session(conn, kurs_id)
    return ich if ich and ich['rolle'] == 'leitung' else None


@v2.route('/v2/api/kurse/<kurs_id>/meta', methods=['PUT'])
def kurs_meta(kurs_id):
    body = _json_body() or {}
    an, pv = body.get('analyse') or {}, body.get('privat')
    if not isinstance(an, dict) or not set(an) <= {'datum'} or not _check_privat(pv):
        return _err('REJECTED_CONTENT', 422)
    if an.get('datum') and not re.match(r'^\d{4}-\d{2}-\d{2}$', str(an['datum'])):
        return _err('REJECTED_CONTENT', 422)
    with _db() as conn:
        if not _leitung(conn, kurs_id):
            return _err('NOT_FOUND', 404)
        conn.execute('UPDATE kurse SET meta_analyse = ?, meta_privat = ?, updated_at = ? WHERE id = ?',
                     (json.dumps(an), json.dumps(pv) if pv else None, _now(), kurs_id))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/kurse/<kurs_id>/ich', methods=['PUT'])
def kurs_name(kurs_id):
    pv = (_json_body() or {}).get('name')
    if not pv or not _check_privat(pv) or len(pv['ct']) > 2000:
        return _err('REJECTED_CONTENT', 422)
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich:
            return _err('NOT_FOUND', 404)
        conn.execute('UPDATE kurs_teilnehmende SET name_privat = ? WHERE id = ?', (json.dumps(pv), ich['id']))
        _touch(conn, kurs_id)
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/kurse/<kurs_id>/proben/<probe_id>', methods=['PUT'])
def kurs_probe_setzen(kurs_id, probe_id):
    body = _json_body() or {}
    an, pv = body.get('analyse') or {}, body.get('privat')
    if (not ID_RE.match(probe_id) or not isinstance(an, dict) or set(an) - {'typ'} or an.get('typ') not in ('heu', 'gras', 'mais')
            or not _check_privat(pv)):
        return _err('REJECTED_CONTENT', 422)
    sort = int(body.get('sort') or 0) if str(body.get('sort') or '0').isdigit() else 0
    with _db() as conn:
        if not _leitung(conn, kurs_id):
            return _err('NOT_FOUND', 404)
        n = conn.execute('SELECT COUNT(*) FROM kurs_proben WHERE kurs_id = ?', (kurs_id,)).fetchone()[0]
        exists = conn.execute('SELECT 1 FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id)).fetchone()
        if not exists and n >= MAX_PROBEN:
            return _err('ZU_VIELE_PROBEN', 409)
        conn.execute('INSERT INTO kurs_proben (kurs_id, id, sort, analyse, privat, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
                     'ON CONFLICT(kurs_id, id) DO UPDATE SET sort = excluded.sort, analyse = excluded.analyse, '
                     'privat = excluded.privat, updated_at = excluded.updated_at',
                     (kurs_id, probe_id, sort, json.dumps(an), json.dumps(pv) if pv else None, _now()))
        _touch(conn, kurs_id)
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/kurse/<kurs_id>/proben/<probe_id>', methods=['DELETE'])
def kurs_probe_loeschen(kurs_id, probe_id):
    with _db() as conn:
        if not _leitung(conn, kurs_id):
            return _err('NOT_FOUND', 404)
        conn.execute('DELETE FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ?', (kurs_id, probe_id))
        conn.execute('DELETE FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id))
        _touch(conn, kurs_id)
    return jsonify({'status': 'deleted'})


# --- Beurteilungen ------------------------------------------------------------------
@v2.route('/v2/api/kurse/<kurs_id>/proben/<probe_id>/beurteilung', methods=['PUT'])
def kurs_abgeben(kurs_id, probe_id):
    """Eigene Beurteilung abgeben. Danach unveränderlich (fairer Vergleich)."""
    raw = request.get_data(cache=False, as_text=True)
    if len(raw.encode('utf-8')) > MAX_RECORD_BYTES:
        return _err('TOO_LARGE', 413)
    try:
        data = json.loads(raw).get('data')
    except (ValueError, AttributeError):
        return _err('BAD_JSON', 400)
    an = (data or {}).get('analyse') or {}
    if not isinstance(an, dict) or not ID_RE.match(str(an.get('id', ''))) or not _check_record(an['id'], data):
        return _err('REJECTED_CONTENT', 422)
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich:
            return _err('NOT_FOUND', 404)
        kp = conn.execute('SELECT analyse FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id)).fetchone()
        if not kp:
            return _err('NOT_FOUND', 404)
        if json.loads(kp['analyse']).get('typ') != an.get('typ'):
            return _err('FALSCHER_TYP', 422)
        if conn.execute('SELECT 1 FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ? AND teilnehmer_id = ?',
                        (kurs_id, probe_id, ich['id'])).fetchone():
            return _err('BEREITS_ABGEGEBEN', 409)
        conn.execute('INSERT INTO kurs_beurteilungen (kurs_id, probe_id, teilnehmer_id, analyse, privat, abgegeben_at) VALUES (?, ?, ?, ?, ?, ?)',
                     (kurs_id, probe_id, ich['id'], json.dumps(an), json.dumps(data['privat']) if data.get('privat') else None, _now()))
        _touch(conn, kurs_id)
    return jsonify({'status': 'abgegeben'})


@v2.route('/v2/api/kurse/<kurs_id>/proben/<probe_id>/beurteilungen', methods=['GET'])
def kurs_vergleich(kurs_id, probe_id):
    """Alle Abgaben zu einer Probe – für Teilnehmende erst nach eigener Abgabe."""
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich:
            return _err('NOT_FOUND', 404)
        eigene = conn.execute('SELECT 1 FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ? AND teilnehmer_id = ?',
                              (kurs_id, probe_id, ich['id'])).fetchone()
        if ich['rolle'] != 'leitung' and not eigene:
            return _err('ERST_EIGENE_ABGEBEN', 403)
        rows = conn.execute('SELECT teilnehmer_id, analyse, privat, abgegeben_at FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ?',
                            (kurs_id, probe_id)).fetchall()
    return jsonify({'beurteilungen': [{'teilnehmerId': r['teilnehmer_id'], 'analyse': json.loads(r['analyse']), 'privat': _box(r['privat']),
                                       'abgegebenAt': r['abgegeben_at']} for r in rows]})


# --- Austreten / Entfernen / Kurs löschen -----------------------------------------------
@v2.route('/v2/api/kurse/<kurs_id>/teilnehmende/<tid>', methods=['DELETE'])
def kurs_person_loeschen(kurs_id, tid):
    """Eigene Daten löschen (austreten) oder – als Kursleitung – eine Person entfernen."""
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich or (ich['id'] != tid and ich['rolle'] != 'leitung'):
            return _err('NOT_FOUND', 404)
        ziel = conn.execute('SELECT rolle FROM kurs_teilnehmende WHERE id = ? AND kurs_id = ?', (tid, kurs_id)).fetchone()
        if not ziel:
            return _err('NOT_FOUND', 404)
        if ziel['rolle'] == 'leitung':
            return _err('LEITUNG_LOESCHT_KURS', 409)  # Kursleitung löscht den ganzen Kurs
        conn.execute('DELETE FROM kurs_teilnehmende WHERE id = ?', (tid,))
        _touch(conn, kurs_id)
    return jsonify({'status': 'deleted'})


@v2.route('/v2/api/kurse/<kurs_id>', methods=['DELETE'])
def kurs_loeschen(kurs_id):
    with _db() as conn:
        if not _leitung(conn, kurs_id):
            return _err('NOT_FOUND', 404)
        conn.execute('DELETE FROM kurs_sessions WHERE kurs_id = ?', (kurs_id,))
        conn.execute('DELETE FROM kurs_codes WHERE kurs_id = ?', (kurs_id,))
        conn.execute('DELETE FROM kurse WHERE id = ?', (kurs_id,))
    return jsonify({'status': 'deleted'})


@v2.route('/v2/api/kurs-config')
def kurs_config():
    return jsonify({'consentVersion': KURS_CONSENT_VERSION, 'retentionDays': RETENTION_DAYS,
                    'mail': bool(os.environ.get('SMTP_HOST'))})
