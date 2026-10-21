"""Futter v2 – Freischaltung der Kursleitung und Betriebs-Administration.

Wer einen Kurs anlegen darf (immer mit bestätigter E-Mail-Adresse):
  1. Adresse/Domain auf der Freigabeliste (V2_KURSLEITUNG_DOMAINS oder vom Betreiber freigeschaltet)
  2. gültiger Einladungscode
Alle anderen können einen Antrag stellen; der Betreiber entscheidet auf der Admin-Seite.
"""
import hmac
import os
import secrets
import time

from flask import jsonify, render_template, request

import v2_mail as M
from v2_api import v2, _db, _now, _sha, _rate_hit, _json_body, CONSENT_VERSION

FOTO_GESAMT_BYTES = int(os.environ.get('V2_FOTO_GESAMT_MB', '5000')) * 1024 * 1024


def init_admin_db():
    with _db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS kursleitende (
                email_hmac TEXT PRIMARY KEY,
                email_enc TEXT NOT NULL,
                name_enc TEXT, org_enc TEXT, text_enc TEXT,
                status TEXT NOT NULL,            -- antrag | frei | abgelehnt
                via TEXT NOT NULL,               -- antrag | einladung | admin
                created_at TEXT NOT NULL, decided_at TEXT
            );
            CREATE TABLE IF NOT EXISTS einladungen (
                code_hash TEXT PRIMARY KEY,
                hinweis TEXT NOT NULL,           -- letzte Zeichen zur Wiedererkennung
                notiz TEXT,
                max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0,
                expires_at REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
        ''')


def _domains():
    return {d.strip().lower().lstrip('@') for d in os.environ.get('V2_KURSLEITUNG_DOMAINS', '').split(',') if d.strip()}


def _adressen():
    return {M.email_norm(d) for d in os.environ.get('V2_KURSLEITUNG_EMAILS', '').split(',') if d.strip()}


def darf_kurs_anlegen(email):
    email = M.email_norm(email)
    if email.split('@')[-1] in _domains() or email in _adressen():
        return True
    with _db() as conn:
        r = conn.execute('SELECT status FROM kursleitende WHERE email_hmac = ?', (M.email_hmac(email),)).fetchone()
    return bool(r and r['status'] == 'frei')


def _code_norm(code):
    return ''.join(ch for ch in str(code or '').upper() if ch.isalnum())


def einladung_gueltig(code):
    c = _code_norm(code)
    if len(c) < 8:
        return False
    with _db() as conn:
        r = conn.execute('SELECT * FROM einladungen WHERE code_hash = ?', (_sha('einladung|' + c),)).fetchone()
    return bool(r and not r['revoked'] and r['uses'] < r['max_uses'] and r['expires_at'] > time.time())


def einladung_einloesen(code, email):
    """Nach bestätigter E-Mail: Code verbrauchen und Adresse freischalten."""
    c = _code_norm(code)
    with _db() as conn:
        r = conn.execute('SELECT * FROM einladungen WHERE code_hash = ?', (_sha('einladung|' + c),)).fetchone()
        if not r or r['revoked'] or r['uses'] >= r['max_uses'] or r['expires_at'] < time.time():
            return False
        conn.execute('UPDATE einladungen SET uses = uses + 1 WHERE code_hash = ?', (r['code_hash'],))
        conn.execute('INSERT INTO kursleitende (email_hmac, email_enc, status, via, created_at, decided_at) VALUES (?, ?, \'frei\', \'einladung\', ?, ?) '
                     "ON CONFLICT(email_hmac) DO UPDATE SET status = 'frei', via = 'einladung', decided_at = excluded.decided_at",
                     (M.email_hmac(email), M.email_enc(email), _now(), _now()))
    return True


def foto_platz_frei(zusatz_bytes):
    """Gesamtobergrenze für Fotos auf dem Server."""
    return _foto_bytes() + zusatz_bytes <= FOTO_GESAMT_BYTES


def _foto_bytes():
    with _db() as conn:
        total = 0
        for t in ('e2e_fotos', 'kurs_fotos', 'pool_fotos'):
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (t,)).fetchone():
                total += conn.execute(f'SELECT COALESCE(SUM(bytes), 0) FROM {t}').fetchone()[0]
    return total


# --- Antrag stellen --------------------------------------------------------------------
@v2.route('/v2/api/kursleitung/status', methods=['POST'])
def kl_status():
    """Prüft, ob eine Adresse Kurse anlegen darf (ohne Details preiszugeben, nur ja/nein)."""
    _rate_hit('kl_status', limit=30, window=3600)
    email = (_json_body() or {}).get('email')
    if not M.email_ok(email):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    return jsonify({'frei': darf_kurs_anlegen(email)})


@v2.route('/v2/api/kursleitung/antrag/code', methods=['POST'])
def kl_antrag_code():
    _rate_hit('kl_antrag', limit=10, window=3600)
    email = (_json_body() or {}).get('email')
    if not M.email_ok(email):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    M.code_senden('antrag', email, 'Antrag Kursleitung')
    return jsonify({'status': 'sent'})


@v2.route('/v2/api/kursleitung/antrag', methods=['POST'])
def kl_antrag():
    b = _json_body() or {}
    email = b.get('email')
    if not M.email_ok(email) or (b.get('consent') or {}).get('accepted') is not True:
        return jsonify({'error': 'BAD_REQUEST'}), 400
    name, org, text = (str(b.get(k) or '').strip()[:lim] for k, lim in (('name', 120), ('org', 200), ('text', 1000)))
    if not name:
        return jsonify({'error': 'NAME_FEHLT'}), 400
    if not M.code_pruefen('antrag', email, b.get('code')):
        return jsonify({'error': 'CODE_INVALID'}), 400
    eh = M.email_hmac(email)
    frei = darf_kurs_anlegen(email)
    with _db() as conn:
        alt = conn.execute('SELECT status FROM kursleitende WHERE email_hmac = ?', (eh,)).fetchone()
        if alt and alt['status'] == 'frei':
            return jsonify({'status': 'frei'})
        conn.execute('INSERT INTO kursleitende (email_hmac, email_enc, name_enc, org_enc, text_enc, status, via, created_at) '
                     "VALUES (?, ?, ?, ?, ?, ?, 'antrag', ?) ON CONFLICT(email_hmac) DO UPDATE SET name_enc = excluded.name_enc, "
                     "org_enc = excluded.org_enc, text_enc = excluded.text_enc, status = excluded.status, created_at = excluded.created_at",
                     (eh, M.email_enc(email), M.text_enc(name, b'kl'), M.text_enc(org, b'kl'), M.text_enc(text, b'kl'),
                      'frei' if frei else 'antrag', _now()))
    if not frei and M.admin_adresse():
        M.senden(M.admin_adresse(), 'Neuer Antrag Kursleitung',
                 f'{name} ({org or "ohne Organisation"}) möchte Kurse anlegen.\n\n'
                 'Bitte auf der Admin-Seite entscheiden: https://apps.graswachstum.ch/futter/v2/admin\n')
    return jsonify({'status': 'frei' if frei else 'antrag'})


# --- Administration (Admin-Passwort wie im Dashboard) ---------------------------------
def _admin_ok():
    pw = os.environ.get('ADMIN_PASSWORD') or ''
    ok = bool(pw) and hmac.compare_digest(request.headers.get('X-Admin-Pass', ''), pw)
    if not ok:
        _rate_hit('admin_fail', limit=20, window=900)
    return ok


@v2.route('/v2/admin')
def v2_admin_page():
    return render_template('v2/admin.html')


@v2.route('/v2/api/admin/uebersicht')
def admin_uebersicht():
    if not _admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    with _db() as conn:
        kl = conn.execute('SELECT * FROM kursleitende ORDER BY status = ? DESC, created_at DESC', ('antrag',)).fetchall()
        inv = conn.execute('SELECT hinweis, notiz, max_uses, uses, expires_at, revoked, created_at, code_hash FROM einladungen ORDER BY created_at DESC').fetchall()
        stat = {
            'freigaben': conn.execute('SELECT COUNT(*) FROM e2e_spaces').fetchone()[0],
            'kurse': conn.execute("SELECT COUNT(*) FROM kurse WHERE status = 'aktiv'").fetchone()[0],
            'teilnehmende': conn.execute('SELECT COUNT(*) FROM kurs_teilnehmende').fetchone()[0],
            'fotoBytes': _foto_bytes(),
            'pool': conn.execute('SELECT COUNT(*) FROM pool_proben').fetchone()[0],
            'fotoLimit': FOTO_GESAMT_BYTES,
        }
    return jsonify({
        'kursleitende': [{'id': r['email_hmac'], 'email': M.email_dec(r['email_enc']), 'name': M.text_dec(r['name_enc'], b'kl') if r['name_enc'] else None,
                          'org': M.text_dec(r['org_enc'], b'kl') if r['org_enc'] else None, 'text': M.text_dec(r['text_enc'], b'kl') if r['text_enc'] else None,
                          'status': r['status'], 'via': r['via'], 'createdAt': r['created_at'], 'decidedAt': r['decided_at']} for r in kl],
        'einladungen': [{'id': r['code_hash'][:16], 'hinweis': r['hinweis'], 'notiz': r['notiz'], 'max': r['max_uses'], 'uses': r['uses'],
                         'expiresAt': r['expires_at'], 'revoked': bool(r['revoked']), 'createdAt': r['created_at']} for r in inv],
        'domains': sorted(_domains()), 'adressen': len(_adressen()), 'statistik': stat,
    })


@v2.route('/v2/api/admin/kursleitung/<eh>', methods=['POST'])
def admin_entscheid(eh):
    if not _admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    status = (_json_body() or {}).get('status')
    if status not in ('frei', 'abgelehnt', 'loeschen'):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    with _db() as conn:
        r = conn.execute('SELECT email_enc FROM kursleitende WHERE email_hmac = ?', (eh,)).fetchone()
        if not r:
            return jsonify({'error': 'NOT_FOUND'}), 404
        if status == 'loeschen':
            conn.execute('DELETE FROM kursleitende WHERE email_hmac = ?', (eh,))
        else:
            conn.execute('UPDATE kursleitende SET status = ?, decided_at = ? WHERE email_hmac = ?', (status, _now(), eh))
    email = M.email_dec(r['email_enc'])
    if email and status == 'frei':
        M.senden(email, 'Freigeschaltet: Kurse anlegen', 'Ihr Antrag wurde angenommen. Sie können jetzt in der Futterbeurteilung Kurse anlegen:\n'
                 'https://apps.graswachstum.ch/futter/v2/\n\n'
                 'Ein Kurs, den Sie vor der Freischaltung angelegt haben, wurde noch nicht gespeichert. '
                 'Bitte unter «Neuer Anlass» → «Kurs» nochmals anlegen – auf demselben Gerät sind Ihre Angaben bereits ausgefüllt.\n')
    elif email and status == 'abgelehnt':
        M.senden(email, 'Ihr Antrag Kursleitung', 'Ihr Antrag, Kurse anzulegen, wurde leider nicht angenommen.\n')
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/admin/einladungen', methods=['POST'])
def admin_einladung_neu():
    if not _admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    b = _json_body() or {}
    max_uses = max(1, min(500, int(b.get('max') or 1)))
    tage = max(1, min(365, int(b.get('tage') or 30)))
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    code = ''.join(secrets.choice(alphabet) for _ in range(12))
    with _db() as conn:
        conn.execute('INSERT INTO einladungen (code_hash, hinweis, notiz, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                     (_sha('einladung|' + code), code[-3:], str(b.get('notiz') or '')[:200], max_uses, time.time() + tage * 86400, _now()))
    return jsonify({'code': '-'.join(code[i:i + 4] for i in range(0, 12, 4)), 'max': max_uses, 'tage': tage})


@v2.route('/v2/api/admin/einladungen/<cid>', methods=['DELETE'])
def admin_einladung_sperren(cid):
    if not _admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    with _db() as conn:
        conn.execute('UPDATE einladungen SET revoked = 1 WHERE substr(code_hash, 1, 16) = ?', (cid,))
    return jsonify({'status': 'ok'})


_ = CONSENT_VERSION  # gleiche Einwilligungsbasis wie Freigaben
