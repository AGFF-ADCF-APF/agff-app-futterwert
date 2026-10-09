"""Futter v2 – Kursmodus (Schulklassen, Gruppen, Kurse).

Ablauf
- Kursleitung (freigeschaltet, E-Mail bestätigt) legt den Kurs an und druckt QR-Etiketten.
  Jedes Etikett ist eine im Kurs reservierte, noch leere Probe (Nr. 1, 2, …).
- Teilnehmende kleben ein Etikett auf ihre Probe und scannen es: Beitritt (nur Name),
  erster Scan einer leeren Probe → Ersterfassung (Futterart, Fotos, Standort, Schnittdatum,
  Labor). Weitere Scans → direkt zur Beurteilung.
- Die Kursleitung legt fest, welche Angaben der Ersterfassung als Hilfestellung erscheinen.
- Vergleich der Beurteilungen erst nach eigener Abgabe; Abgaben sind gesperrt.

Sicherheit
- Kurs-Link «#k=<id>.<geheimnis>[.<probe>]»: Kursschlüssel (Ende-zu-Ende für Kurstitel, Namen,
  Proben-Angaben, Standort, Notizen, Foto-Schlüssel) und Beitritts-Token (Server: nur Hash).
- Teilnahme ohne E-Mail möglich (Sitzung an Gerät gebunden); E-Mail optional für Zugriff von
  anderen Geräten. Adressen nur verschlüsselt (Serverschlüssel), Suche per HMAC.
- Fotos: eigener Schlüssel je Foto (steckt im verschlüsselten Proben-Paket), Server sieht nur Bytes;
  20 MB je Person und Kurs, plus Gesamtobergrenze.
"""
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import time

from flask import jsonify, request, send_from_directory

import v2_admin as ADM
import v2_mail as M
from v2_api import (v2, _db, _now, _sha, _rate_hit, _check_record, _check_privat, _json_body,
                    ID_RE, HASH_RE, TOKEN_RE, RETENTION_DAYS, MAX_RECORD_BYTES, FOTO_ID_RE)

KURS_CONSENT_VERSION = '2026-10-k4'
SESSION_TTL = 120 * 24 * 3600
MAX_PROBEN = 400
MAX_TEILNEHMENDE = 300
FOTO_DIR = os.environ.get('V2_FOTO_DIR', 'data/v2_fotos')
FOTO_PRO_PERSON = int(os.environ.get('V2_FOTO_MB_PRO_PERSON', '20')) * 1024 * 1024
MAX_FOTO_BYTES = 5 * 1024 * 1024
HINWEIS_KEYS = ('foto', 'standort', 'alter', 'labor', 'notiz', 'bezeichnung')
HINWEIS_DEFAULT = {'foto': True, 'standort': True, 'alter': True, 'labor': False, 'notiz': False, 'bezeichnung': True}


def init_kurs_db():
    with _db() as conn:
        # Beta-Schema (E-Mail Pflicht, keine Etiketten) entfernen, solange keine Kurse existieren
        cols = {r[1]: r for r in conn.execute('PRAGMA table_info(kurs_teilnehmende)')}
        pcols = {r[1] for r in conn.execute('PRAGMA table_info(kurs_proben)')}
        alt = (cols and cols['email_hmac'][3] == 1) or (pcols and 'nr' not in pcols)
        if alt and conn.execute('SELECT COUNT(*) FROM kurse').fetchone()[0] == 0:
            conn.executescript('DROP TABLE IF EXISTS kurs_beurteilungen; DROP TABLE IF EXISTS kurs_proben; DROP TABLE IF EXISTS kurs_sessions;'
                               'DROP TABLE IF EXISTS kurs_codes; DROP TABLE IF EXISTS kurs_teilnehmende; DROP TABLE IF EXISTS kurse;')
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS kurse (
                id TEXT PRIMARY KEY,
                join_hash TEXT NOT NULL,
                status TEXT NOT NULL,                 -- pending | aktiv
                pending_email_hmac TEXT, pending_einladung TEXT,
                meta_analyse TEXT, meta_privat TEXT,
                consent_version TEXT NOT NULL,
                naechste_nr INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS kurs_teilnehmende (
                id TEXT PRIMARY KEY,
                kurs_id TEXT NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
                email_hmac TEXT, email_enc TEXT,
                name_privat TEXT,
                rolle TEXT NOT NULL,                  -- leitung | teilnahme
                consent_version TEXT NOT NULL, consent_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (kurs_id, email_hmac)
            );
            CREATE TABLE IF NOT EXISTS kurs_sessions (
                token_hash TEXT PRIMARY KEY,
                teilnehmer_id TEXT NOT NULL REFERENCES kurs_teilnehmende(id) ON DELETE CASCADE,
                kurs_id TEXT NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS kurs_proben (
                kurs_id TEXT NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
                id TEXT NOT NULL, nr INTEGER NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,                 -- leer | erfasst
                owner_id TEXT,
                analyse TEXT, privat TEXT,
                labor TEXT,                           -- eigenes Paket: Freigabe serverseitig gesteuert
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
            CREATE TABLE IF NOT EXISTS kurs_fotos (
                kurs_id TEXT NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                teilnehmer_id TEXT NOT NULL,
                probe_id TEXT NOT NULL, art TEXT NOT NULL,
                bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
                PRIMARY KEY (kurs_id, id)
            );
        ''')
        if 'zweck' not in [c[1] for c in conn.execute('PRAGMA table_info(kurs_fotos)').fetchall()]:
            try:  # probe | beurteilung
                conn.execute("ALTER TABLE kurs_fotos ADD COLUMN zweck TEXT NOT NULL DEFAULT 'probe'")
            except sqlite3.OperationalError:
                pass  # parallel startende Worker: Spalte bereits angelegt
        conn.execute('DELETE FROM kurs_sessions WHERE expires_at < ?', (time.time(),))
        conn.execute("DELETE FROM kurse WHERE status = 'pending' AND created_at < ?",
                     (time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - 86400)),))


def _foto_dir(kurs_id):
    return os.path.join(FOTO_DIR, 'k_' + kurs_id)


def _kurs_entfernen(conn, kurs_id):
    conn.execute('DELETE FROM kurs_sessions WHERE kurs_id = ?', (kurs_id,))
    conn.execute('DELETE FROM kurse WHERE id = ?', (kurs_id,))
    shutil.rmtree(_foto_dir(kurs_id), ignore_errors=True)


def _purge(conn):
    cutoff = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - RETENTION_DAYS * 86400))
    for r in conn.execute('SELECT id FROM kurse WHERE updated_at < ?', (cutoff,)).fetchall():
        _kurs_entfernen(conn, r['id'])
    conn.execute('DELETE FROM kurs_sessions WHERE expires_at < ?', (time.time(),))


def _touch(conn, kurs_id):
    conn.execute('UPDATE kurse SET updated_at = ? WHERE id = ?', (_now(), kurs_id))


def _session(conn, kurs_id):
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


def _neue_session(conn, person_id, kurs_id):
    token = secrets.token_urlsafe(32)[:43]
    conn.execute('INSERT INTO kurs_sessions (token_hash, teilnehmer_id, kurs_id, expires_at) VALUES (?, ?, ?, ?)',
                 (_sha(token), person_id, kurs_id, time.time() + SESSION_TTL))
    return token


def _err(code, status):
    return jsonify({'error': code}), status


def _consent_ok(body):
    c = body.get('consent') or {}
    return c.get('accepted') is True and c.get('version') == KURS_CONSENT_VERSION


def _join_ok(conn, kurs_id, join_token):
    k = conn.execute('SELECT join_hash, status FROM kurse WHERE id = ?', (kurs_id,)).fetchone()
    ok = bool(k and k['status'] == 'aktiv' and TOKEN_RE.match(join_token or '') and hmac.compare_digest(k['join_hash'], _sha(join_token)))
    if not ok:
        _rate_hit('auth_fail', limit=60, window=600)
    return ok


def _hinweise_aus(meta_analyse):
    h = dict(HINWEIS_DEFAULT)
    try:
        h.update((json.loads(meta_analyse or '{}').get('hinweise') or {}))
    except (TypeError, ValueError):
        pass
    return h


def _hinweise(conn, kurs_id):
    k = conn.execute('SELECT meta_analyse FROM kurse WHERE id = ?', (kurs_id,)).fetchone()
    return _hinweise_aus(k['meta_analyse'] if k else None)


# --- Kurs anlegen (nur freigeschaltete Kursleitung, E-Mail bestätigt) -----------------
@v2.route('/v2/api/kurse', methods=['POST'])
def kurs_anlegen():
    _rate_hit('kurs_create', limit=10, window=3600)
    body = _json_body() or {}
    consent = body.get('consent') or {}
    if consent.get('accepted') is not True:
        return _err('CONSENT_REQUIRED', 400)
    if consent.get('version') != KURS_CONSENT_VERSION:
        return jsonify({'error': 'CONSENT_OUTDATED', 'consentVersion': KURS_CONSENT_VERSION}), 409
    email, join_hash, einladung = M.email_norm(body.get('email')), body.get('joinHash', ''), body.get('einladung')
    if not M.email_ok(email) or not HASH_RE.match(join_hash):
        return _err('BAD_REQUEST', 400)
    if not ADM.darf_kurs_anlegen(email) and not (einladung and ADM.einladung_gueltig(einladung)):
        return _err('NICHT_FREIGESCHALTET', 403)
    kurs_id = secrets.token_urlsafe(9)
    now = _now()
    with _db() as conn:
        _purge(conn)
        conn.execute('INSERT INTO kurse (id, join_hash, status, pending_email_hmac, pending_einladung, consent_version, created_at, updated_at) '
                     "VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)",
                     (kurs_id, join_hash, M.email_hmac(email), (str(einladung or '')[:40]) or None, KURS_CONSENT_VERSION, now, now))
    M.code_senden('kurs:' + kurs_id, email, 'Kurs anlegen')
    return jsonify({'id': kurs_id, 'consentVersion': KURS_CONSENT_VERSION}), 201


@v2.route('/v2/api/kurse/<kurs_id>/aktivieren', methods=['POST'])
def kurs_aktivieren(kurs_id):
    body = _json_body() or {}
    email = M.email_norm(body.get('email'))
    if not M.email_ok(email) or not ID_RE.match(kurs_id):
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        k = conn.execute('SELECT * FROM kurse WHERE id = ?', (kurs_id,)).fetchone()
    if not k or k['status'] != 'pending' or k['pending_email_hmac'] != M.email_hmac(email):
        return _err('NOT_FOUND', 404)
    if not M.code_pruefen('kurs:' + kurs_id, email, body.get('code')):
        return _err('CODE_INVALID', 400)
    if not ADM.darf_kurs_anlegen(email) and not (k['pending_einladung'] and ADM.einladung_einloesen(k['pending_einladung'], email)):
        return _err('NICHT_FREIGESCHALTET', 403)
    with _db() as conn:
        pid = secrets.token_urlsafe(9)
        conn.execute("UPDATE kurse SET status = 'aktiv', pending_email_hmac = NULL, pending_einladung = NULL WHERE id = ?", (kurs_id,))
        conn.execute("INSERT INTO kurs_teilnehmende (id, kurs_id, email_hmac, email_enc, rolle, consent_version, consent_at, created_at) "
                     "VALUES (?, ?, ?, ?, 'leitung', ?, ?, ?)", (pid, kurs_id, M.email_hmac(email), M.email_enc(email), KURS_CONSENT_VERSION, _now(), _now()))
        token = _neue_session(conn, pid, kurs_id)
    return jsonify({'session': token, 'ich': {'id': pid, 'rolle': 'leitung'}})


# --- Beitreten (ohne E-Mail) / E-Mail verknüpfen / Anmelden ---------------------------
@v2.route('/v2/api/kurse/<kurs_id>/beitreten', methods=['POST'])
def kurs_beitreten(kurs_id):
    _rate_hit('kurs_join', limit=40, window=3600)
    body = _json_body() or {}
    if not _consent_ok(body):
        return _err('CONSENT_REQUIRED', 400)
    with _db() as conn:
        if not _join_ok(conn, kurs_id, body.get('joinToken')):
            return _err('NOT_FOUND', 404)
        if conn.execute('SELECT COUNT(*) FROM kurs_teilnehmende WHERE kurs_id = ?', (kurs_id,)).fetchone()[0] >= MAX_TEILNEHMENDE:
            return _err('KURS_VOLL', 409)
        pid = secrets.token_urlsafe(9)
        conn.execute("INSERT INTO kurs_teilnehmende (id, kurs_id, rolle, consent_version, consent_at, created_at) VALUES (?, ?, 'teilnahme', ?, ?, ?)",
                     (pid, kurs_id, KURS_CONSENT_VERSION, _now(), _now()))
        token = _neue_session(conn, pid, kurs_id)
        _touch(conn, kurs_id)
    return jsonify({'session': token, 'ich': {'id': pid, 'rolle': 'teilnahme'}})


@v2.route('/v2/api/kurse/<kurs_id>/email/code', methods=['POST'])
def kurs_email_code(kurs_id):
    """Code zum Verknüpfen (mit Sitzung) oder zum Anmelden auf neuem Gerät (mit Beitritts-Token)."""
    body = _json_body() or {}
    email = M.email_norm(body.get('email'))
    if not M.email_ok(email):
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not (ich or _join_ok(conn, kurs_id, body.get('joinToken'))):
            return _err('NOT_FOUND', 404)
    # Mit Sitzung (Adresse verknüpfen): Bestätigungslink; ohne (Anmeldung neues Gerät): nur Code
    link = (os.environ.get('V2_PUBLIC_URL') or 'https://apps.graswachstum.ch/futter/v2/') + '#km=' + kurs_id + '.' if ich else None
    M.code_senden('kurs:' + kurs_id, email, 'Kurs', link=link)
    return jsonify({'status': 'sent'})


@v2.route('/v2/api/kurse/<kurs_id>/email/verify', methods=['POST'])
def kurs_email_verify(kurs_id):
    """Mit Sitzung: E-Mail mit der eigenen Teilnahme verknüpfen. Ohne: mit bekannter Adresse anmelden."""
    body = _json_body() or {}
    email = M.email_norm(body.get('email'))
    if not M.email_ok(email):
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich and not _join_ok(conn, kurs_id, body.get('joinToken')):
            return _err('NOT_FOUND', 404)
    if not M.code_pruefen('kurs:' + kurs_id, email, body.get('code')):
        return _err('CODE_INVALID', 400)
    eh = M.email_hmac(email)
    with _db() as conn:
        andere = conn.execute('SELECT * FROM kurs_teilnehmende WHERE kurs_id = ? AND email_hmac = ?', (kurs_id, eh)).fetchone()
        if ich:
            if andere and andere['id'] != ich['id']:
                return _err('EMAIL_VERGEBEN', 409)
            conn.execute('UPDATE kurs_teilnehmende SET email_hmac = ?, email_enc = ? WHERE id = ?', (eh, M.email_enc(email), ich['id']))
            return jsonify({'status': 'verknuepft', 'ich': {'id': ich['id'], 'rolle': ich['rolle']}})
        if not andere:
            return _err('UNBEKANNT', 404)
        token = _neue_session(conn, andere['id'], kurs_id)
    return jsonify({'session': token, 'ich': {'id': andere['id'], 'rolle': andere['rolle']}})


@v2.route('/v2/api/kurse/<kurs_id>/logout', methods=['POST'])
def kurs_logout(kurs_id):
    tok = request.headers.get('X-Kurs-Session', '')
    with _db() as conn:
        conn.execute('DELETE FROM kurs_sessions WHERE token_hash = ? AND kurs_id = ?', (_sha(tok), kurs_id))
    return jsonify({'status': 'ok'})


# --- Lesen ---------------------------------------------------------------------------
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
        personen = conn.execute('SELECT id, rolle, name_privat, email_enc FROM kurs_teilnehmende WHERE kurs_id = ? ORDER BY rolle = ? DESC, created_at',
                                (kurs_id, 'leitung')).fetchall()
        proben = conn.execute('SELECT * FROM kurs_proben WHERE kurs_id = ? ORDER BY nr', (kurs_id,)).fetchall()
        abgaben = {r['probe_id']: r['n'] for r in conn.execute(
            'SELECT probe_id, COUNT(*) AS n FROM kurs_beurteilungen WHERE kurs_id = ? GROUP BY probe_id', (kurs_id,))}
        meine = {r['probe_id']: r['abgegeben_at'] for r in conn.execute(
            'SELECT probe_id, abgegeben_at FROM kurs_beurteilungen WHERE kurs_id = ? AND teilnehmer_id = ?', (kurs_id, ich['id']))}
        foto_bytes = conn.execute('SELECT COALESCE(SUM(bytes), 0) FROM kurs_fotos WHERE kurs_id = ? AND teilnehmer_id = ?', (kurs_id, ich['id'])).fetchone()[0]
    hinweise = _hinweise_aus(k['meta_analyse'])
    teilnehmende = []
    for p in personen:
        email = M.email_dec(p['email_enc']) if p['email_enc'] else None
        teilnehmende.append({'id': p['id'], 'rolle': p['rolle'], 'name': _box(p['name_privat']), 'mitEmail': bool(email),
                             'email': (email if (leitung or p['id'] == ich['id']) else M.email_mask(email)) if email else None})
    return jsonify({
        'kurs': {'id': k['id'], 'meta': {'analyse': _box(k['meta_analyse']) or {}, 'privat': _box(k['meta_privat'])}, 'updatedAt': k['updated_at'],
                 'consentVersion': k['consent_version']},
        'hinweise': hinweise,
        'ich': {'id': ich['id'], 'rolle': ich['rolle'], 'fotoBytes': foto_bytes, 'fotoLimit': FOTO_PRO_PERSON},
        'teilnehmende': teilnehmende,
        # Leere Etiketten sieht nur die Kursleitung
        'proben': [{'id': r['id'], 'nr': r['nr'], 'status': r['status'], 'eigene': r['owner_id'] == ich['id'], 'ownerId': r['owner_id'],
                    'analyse': _box(r['analyse']) or {}, 'privat': _box(r['privat']),
                    'labor': _box(r['labor']) if (leitung or r['owner_id'] == ich['id'] or hinweise.get('labor') or meine.get(r['id'])) else None,
                    'hatLabor': bool(r['labor']), 'poolId': r['pool_id'] if 'pool_id' in r.keys() else None,
                    'abgaben': abgaben.get(r['id'], 0), 'meineAbgabe': meine.get(r['id'])} for r in proben
                   if r['status'] == 'erfasst' or leitung],
        'retentionDays': RETENTION_DAYS,
    })


@v2.route('/v2/api/kurse/<kurs_id>/proben/<probe_id>/status', methods=['GET'])
def kurs_probe_status(kurs_id, probe_id):
    """Für den Scan eines Etiketts: leer (→ erfassen) oder erfasst (→ beurteilen)."""
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich:
            return _err('NOT_FOUND', 404)
        r = conn.execute('SELECT status, owner_id, nr FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id)).fetchone()
    if not r:
        return _err('NOT_FOUND', 404)
    return jsonify({'status': r['status'], 'eigene': r['owner_id'] == ich['id'], 'nr': r['nr']})


# --- Kursleitung: Meta, Hinweise, Etiketten -------------------------------------------
def _leitung(conn, kurs_id):
    ich = _session(conn, kurs_id)
    return ich if ich and ich['rolle'] == 'leitung' else None


@v2.route('/v2/api/kurse/<kurs_id>/meta', methods=['PUT'])
def kurs_meta(kurs_id):
    body = _json_body() or {}
    an, pv = body.get('analyse') or {}, body.get('privat')
    if not isinstance(an, dict) or not set(an) <= {'datum', 'hinweise', 'beitragen'} or not _check_privat(pv):
        return _err('REJECTED_CONTENT', 422)
    if 'beitragen' in an and not isinstance(an['beitragen'], bool):
        return _err('REJECTED_CONTENT', 422)
    if an.get('datum') and not re.match(r'^\d{4}-\d{2}-\d{2}$', str(an['datum'])):
        return _err('REJECTED_CONTENT', 422)
    h = an.get('hinweise')
    if h is not None and (not isinstance(h, dict) or not set(h) <= set(HINWEIS_KEYS) or not all(isinstance(v, bool) for v in h.values())):
        return _err('REJECTED_CONTENT', 422)
    with _db() as conn:
        if not _leitung(conn, kurs_id):
            return _err('NOT_FOUND', 404)
        conn.execute('UPDATE kurse SET meta_analyse = ?, meta_privat = ?, updated_at = ? WHERE id = ?',
                     (json.dumps(an), json.dumps(pv) if pv else None, _now(), kurs_id))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/kurse/<kurs_id>/etiketten', methods=['POST'])
def kurs_etiketten(kurs_id):
    """Reserviert N leere Proben (fortlaufende Nummern) für den Etikettendruck."""
    n = (_json_body() or {}).get('anzahl')
    if not isinstance(n, int) or not 1 <= n <= 105:
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        if not _leitung(conn, kurs_id):
            return _err('NOT_FOUND', 404)
        if conn.execute('SELECT COUNT(*) FROM kurs_proben WHERE kurs_id = ?', (kurs_id,)).fetchone()[0] + n > MAX_PROBEN:
            return _err('ZU_VIELE_PROBEN', 409)
        start = conn.execute('SELECT naechste_nr FROM kurse WHERE id = ?', (kurs_id,)).fetchone()[0]
        out = []
        for i in range(n):
            pid = secrets.token_urlsafe(9)
            conn.execute("INSERT INTO kurs_proben (kurs_id, id, nr, sort, status, updated_at) VALUES (?, ?, ?, ?, 'leer', ?)",
                         (kurs_id, pid, start + i, start + i, _now()))
            out.append({'id': pid, 'nr': start + i})
        conn.execute('UPDATE kurse SET naechste_nr = ? WHERE id = ?', (start + n, kurs_id))
        _touch(conn, kurs_id)
    return jsonify({'proben': out})


def _check_erfassung(an, pv):
    return isinstance(an, dict) and set(an) <= {'typ'} and an.get('typ') in ('heu', 'gras', 'mais') and _check_privat(pv)


@v2.route('/v2/api/kurse/<kurs_id>/proben/<probe_id>', methods=['PUT'])
def kurs_probe_erfassen(kurs_id, probe_id):
    """Ersterfassung einer leeren Probe (erste Person wird Besitzer) bzw. Änderung durch Besitzer/Kursleitung.
    Die Kursleitung kann Proben auch ohne Etikett direkt anlegen."""
    body = _json_body() or {}
    an, pv, lab = body.get('analyse') or {}, body.get('privat'), body.get('labor')
    if not ID_RE.match(probe_id) or not _check_erfassung(an, pv) or not _check_privat(lab):
        return _err('REJECTED_CONTENT', 422)
    lab_json = json.dumps(lab) if lab else None
    pool_id = body.get('poolId')
    if pool_id is not None:
        import v2_pool as POOL
        with _db() as conn:
            if not ID_RE.match(str(pool_id)) or not POOL.eintrag(conn, pool_id):
                return _err('POOL_UNBEKANNT', 404)
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich:
            return _err('NOT_FOUND', 404)
        r = conn.execute('SELECT * FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id)).fetchone()
        if r is None:
            if ich['rolle'] != 'leitung':
                return _err('NOT_FOUND', 404)
            if conn.execute('SELECT COUNT(*) FROM kurs_proben WHERE kurs_id = ?', (kurs_id,)).fetchone()[0] >= MAX_PROBEN:
                return _err('ZU_VIELE_PROBEN', 409)
            nr = conn.execute('SELECT naechste_nr FROM kurse WHERE id = ?', (kurs_id,)).fetchone()[0]
            if pool_id is not None and ich['rolle'] != 'leitung':
                return _err('NOT_FOUND', 404)
            conn.execute("INSERT INTO kurs_proben (kurs_id, id, nr, sort, status, owner_id, analyse, privat, labor, pool_id, updated_at) VALUES (?, ?, ?, ?, 'erfasst', ?, ?, ?, ?, ?, ?)",
                         (kurs_id, probe_id, nr, nr, ich['id'], json.dumps(an), json.dumps(pv) if pv else None, lab_json, pool_id, _now()))
            conn.execute('UPDATE kurse SET naechste_nr = ? WHERE id = ?', (nr + 1, kurs_id))
        else:
            if r['status'] == 'erfasst' and r['owner_id'] != ich['id'] and ich['rolle'] != 'leitung':
                return _err('BEREITS_ERFASST', 409)
            if r['status'] == 'erfasst' and json.loads(r['analyse'] or '{}').get('typ') != an['typ'] and conn.execute(
                    'SELECT 1 FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ?', (kurs_id, probe_id)).fetchone():
                return _err('TYP_FEST', 409)  # Futterart nach ersten Abgaben nicht mehr änderbar
            conn.execute("UPDATE kurs_proben SET status = 'erfasst', owner_id = ?, analyse = ?, privat = ?, labor = ?, updated_at = ? WHERE kurs_id = ? AND id = ?",
                         (r['owner_id'] or ich['id'], json.dumps(an), json.dumps(pv) if pv else None, lab_json, _now(), kurs_id, probe_id))
        _touch(conn, kurs_id)
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/kurse/<kurs_id>/proben/<probe_id>', methods=['DELETE'])
def kurs_probe_loeschen(kurs_id, probe_id):
    with _db() as conn:
        if not _leitung(conn, kurs_id):
            return _err('NOT_FOUND', 404)
        conn.execute('DELETE FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ?', (kurs_id, probe_id))
        for f in conn.execute('SELECT id FROM kurs_fotos WHERE kurs_id = ? AND probe_id = ?', (kurs_id, probe_id)).fetchall():
            _foto_loeschen(conn, kurs_id, f['id'])
        conn.execute('DELETE FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id))
        _touch(conn, kurs_id)
    return jsonify({'status': 'deleted'})


# --- Beurteilungen ------------------------------------------------------------------
@v2.route('/v2/api/kurse/<kurs_id>/proben/<probe_id>/beurteilung', methods=['PUT'])
def kurs_abgeben(kurs_id, probe_id):
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
        kp = conn.execute('SELECT analyse, status FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id)).fetchone()
        if not kp or kp['status'] != 'erfasst':
            return _err('NOT_FOUND', 404)
        if json.loads(kp['analyse'] or '{}').get('typ') != an.get('typ'):
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
        kp = conn.execute('SELECT pool_id FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id)).fetchone()
        referenzen = []
        if kp and kp['pool_id']:
            import v2_pool as POOL
            referenzen = (POOL.eintrag(conn, kp['pool_id']) or {}).get('referenzen', [])
    return jsonify({'beurteilungen': [{'teilnehmerId': r['teilnehmer_id'], 'analyse': json.loads(r['analyse']), 'privat': _box(r['privat']),
                                       'abgegebenAt': r['abgegeben_at']} for r in rows], 'referenzen': referenzen})


# --- Fotos der Ersterfassung --------------------------------------------------------------
def _foto_pfad(kurs_id, foto_id):
    return os.path.join(_foto_dir(kurs_id), foto_id + '.bin')


def _foto_loeschen(conn, kurs_id, foto_id):
    conn.execute('DELETE FROM kurs_fotos WHERE kurs_id = ? AND id = ?', (kurs_id, foto_id))
    try:
        os.remove(_foto_pfad(kurs_id, foto_id))
    except FileNotFoundError:
        pass


@v2.route('/v2/api/kurse/<kurs_id>/fotos/<foto_id>', methods=['PUT'])
def kurs_foto_put(kurs_id, foto_id):
    probe_id, art = request.args.get('probe', ''), request.args.get('art', '')
    zweck = request.args.get('zu', 'probe')
    if not FOTO_ID_RE.match(foto_id) or not ID_RE.match(probe_id) or art not in ('futter', 'labor') or zweck not in ('probe', 'beurteilung'):
        return _err('BAD_REQUEST', 400)
    if (request.content_length or 0) > MAX_FOTO_BYTES:
        return _err('TOO_LARGE', 413)
    data = request.get_data(cache=False)
    if len(data) > MAX_FOTO_BYTES or len(data) < 30 or data[0] != 1:
        return _err('REJECTED_CONTENT', 422)
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich:
            return _err('NOT_FOUND', 404)
        kp = conn.execute('SELECT owner_id, status FROM kurs_proben WHERE kurs_id = ? AND id = ?', (kurs_id, probe_id)).fetchone()
        if not kp:
            return _err('NOT_FOUND', 404)
        # Fotos zur Probe: Besitzer/Kursleitung. Fotos zur eigenen Beurteilung: alle Kursmitglieder.
        if zweck == 'probe' and kp['owner_id'] not in (None, ich['id']) and ich['rolle'] != 'leitung':
            return _err('NOT_FOUND', 404)
        if zweck == 'beurteilung' and kp['status'] != 'erfasst':
            return _err('NOT_FOUND', 404)
        alt = conn.execute('SELECT bytes, teilnehmer_id FROM kurs_fotos WHERE kurs_id = ? AND id = ?', (kurs_id, foto_id)).fetchone()
        if alt and alt['teilnehmer_id'] != ich['id']:
            return _err('NOT_FOUND', 404)
        belegt = conn.execute('SELECT COALESCE(SUM(bytes), 0) FROM kurs_fotos WHERE kurs_id = ? AND teilnehmer_id = ? AND id != ?',
                              (kurs_id, ich['id'], foto_id)).fetchone()[0]
        if belegt + len(data) > FOTO_PRO_PERSON:
            return _err('QUOTA', 409)
    if not ADM.foto_platz_frei(len(data) - (alt['bytes'] if alt else 0)):
        return _err('SERVER_VOLL', 507)
    os.makedirs(_foto_dir(kurs_id), exist_ok=True)
    tmp = _foto_pfad(kurs_id, foto_id) + '.tmp'
    with open(tmp, 'wb') as fh:
        fh.write(data)
    os.replace(tmp, _foto_pfad(kurs_id, foto_id))
    with _db() as conn:
        conn.execute('INSERT INTO kurs_fotos (kurs_id, id, teilnehmer_id, probe_id, art, bytes, created_at, zweck) VALUES (?, ?, ?, ?, ?, ?, ?, ?) '
                     'ON CONFLICT(kurs_id, id) DO UPDATE SET bytes = excluded.bytes', (kurs_id, foto_id, ich['id'], probe_id, art, len(data), _now(), zweck))
        _touch(conn, kurs_id)
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/kurse/<kurs_id>/fotos/<foto_id>', methods=['GET'])
def kurs_foto_get(kurs_id, foto_id):
    """Sichtbar für: Hochladende, Kursleitung, alle Kursmitglieder falls als Hilfestellung freigegeben (nur Fotos zur Probe, nicht zu Beurteilungen),
    sonst nach eigener Abgabe der betreffenden Probe."""
    if not FOTO_ID_RE.match(foto_id):
        return _err('BAD_REQUEST', 400)
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich:
            return _err('NOT_FOUND', 404)
        f = conn.execute('SELECT * FROM kurs_fotos WHERE kurs_id = ? AND id = ?', (kurs_id, foto_id)).fetchone()
        pool_quelle = None
        if not f:
            # Foto einer aus dem Pool übernommenen Probe (keine Kopie)
            import v2_pool as POOL
            for kp in conn.execute('SELECT id, pool_id FROM kurs_proben WHERE kurs_id = ? AND pool_id IS NOT NULL', (kurs_id,)).fetchall():
                d = POOL.eintrag(conn, kp['pool_id']) or {}
                pf = next((x for x in d.get('fotos', []) if x['id'] == foto_id), None)
                if pf:
                    f = {'teilnehmer_id': None, 'art': pf['art'], 'probe_id': kp['id'], 'zweck': 'probe'}
                    pool_quelle = kp['pool_id']
                    break
        if not f:
            return _err('NOT_FOUND', 404)
        h = _hinweise(conn, kurs_id)
        frei = (f['teilnehmer_id'] == ich['id'] or ich['rolle'] == 'leitung'
                or (f['zweck'] == 'probe' and ((f['art'] == 'futter' and h.get('foto')) or (f['art'] == 'labor' and h.get('labor'))))
                or conn.execute('SELECT 1 FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ? AND teilnehmer_id = ?',
                                (kurs_id, f['probe_id'], ich['id'])).fetchone())
    if not frei:
        return _err('ERST_EIGENE_ABGEBEN', 403)
    if pool_quelle:
        import v2_pool as POOL
        return POOL.foto_senden(pool_quelle, foto_id)
    resp = send_from_directory(os.path.abspath(_foto_dir(kurs_id)), foto_id + '.bin', mimetype='application/octet-stream')
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@v2.route('/v2/api/kurse/<kurs_id>/fotos/<foto_id>', methods=['DELETE'])
def kurs_foto_delete(kurs_id, foto_id):
    with _db() as conn:
        ich = _session(conn, kurs_id)
        f = ich and conn.execute('SELECT teilnehmer_id FROM kurs_fotos WHERE kurs_id = ? AND id = ?', (kurs_id, foto_id)).fetchone()
        if not f or (f['teilnehmer_id'] != ich['id'] and ich['rolle'] != 'leitung'):
            return _err('NOT_FOUND', 404)
        _foto_loeschen(conn, kurs_id, foto_id)
    return jsonify({'status': 'deleted'})


# --- Name, Austreten, Entfernen, Löschen ---------------------------------------------------
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


@v2.route('/v2/api/kurse/<kurs_id>/teilnehmende/<tid>', methods=['DELETE'])
def kurs_person_loeschen(kurs_id, tid):
    with _db() as conn:
        ich = _session(conn, kurs_id)
        if not ich or (ich['id'] != tid and ich['rolle'] != 'leitung'):
            return _err('NOT_FOUND', 404)
        ziel = conn.execute('SELECT rolle FROM kurs_teilnehmende WHERE id = ? AND kurs_id = ?', (tid, kurs_id)).fetchone()
        if not ziel:
            return _err('NOT_FOUND', 404)
        if ziel['rolle'] == 'leitung':
            return _err('LEITUNG_LOESCHT_KURS', 409)
        for f in conn.execute('SELECT id FROM kurs_fotos WHERE kurs_id = ? AND teilnehmer_id = ?', (kurs_id, tid)).fetchall():
            _foto_loeschen(conn, kurs_id, f['id'])
        # Erfasste Proben bleiben dem Kurs erhalten (ohne Besitzer); Fotos und Abgaben der Person werden gelöscht
        conn.execute('UPDATE kurs_proben SET owner_id = NULL WHERE kurs_id = ? AND owner_id = ?', (kurs_id, tid))
        conn.execute('DELETE FROM kurs_teilnehmende WHERE id = ?', (tid,))
        _touch(conn, kurs_id)
    return jsonify({'status': 'deleted'})


@v2.route('/v2/api/kurse/<kurs_id>', methods=['DELETE'])
def kurs_loeschen(kurs_id):
    with _db() as conn:
        if not _leitung(conn, kurs_id):
            return _err('NOT_FOUND', 404)
        _kurs_entfernen(conn, kurs_id)
    return jsonify({'status': 'deleted'})


@v2.route('/v2/api/kurs-config')
def kurs_config():
    return jsonify({'consentVersion': KURS_CONSENT_VERSION, 'retentionDays': RETENTION_DAYS, 'hinweiseDefault': HINWEIS_DEFAULT,
                    'fotoLimitMb': FOTO_PRO_PERSON // (1024 * 1024), 'mail': bool(os.environ.get('SMTP_HOST'))})
