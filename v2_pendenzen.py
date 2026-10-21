"""Futter v2 – Pendenzenliste (Backend) mit Experten-Zugang.

- Der Betreiber (Admin-Passwort) legt Pendenzen an: Titel, Beschreibung, Links zu den betroffenen Stellen, Anhänge.
- Experten erhalten einen persönlichen Link (Token im #-Teil, auf dem Server nur als Hash). Sie sehen nur die ihnen
  zugeteilten Pendenzen und können abhaken, eine Korrektur melden oder eine Notiz hinterlassen. Ein Link lässt sich
  jederzeit sperren oder erneuern.
- Verlaufseinträge, Namen/E-Mail der Experten und Anhänge werden mit dem Server-Schlüssel verschlüsselt gespeichert.
"""
import base64
import re
import secrets

from flask import Response, jsonify, render_template, request

import v2_mail as M
from v2_admin import _admin_ok
from v2_api import v2, _db, _now, _sha, _rate_hit, _json_body, TOKEN_RE

AAD = b'agff-pendenz'
STATUS = ('offen', 'korrektur', 'erledigt')
MAX_ANHANG = 20 * 1024 * 1024
ID_RE = re.compile(r'^[A-Za-z0-9_-]{8,32}$')
NAME_RE = re.compile(r'[^\w .,()+&-]', re.UNICODE)
URL_OK = re.compile(r'^(https://[\w.-]+(/[^\s"<>]*)?|#/[^\s"<>]*|\./[^\s"<>]*|\?[^\s"<>]*)$')


def init_pendenzen_db():
    with _db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS pendenzen (
                id TEXT PRIMARY KEY, titel TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
                stellen TEXT NOT NULL DEFAULT '[]',   -- JSON [{label, url}]
                status TEXT NOT NULL DEFAULT 'offen', prioritaet INTEGER NOT NULL DEFAULT 2,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pendenz_eintraege (
                id INTEGER PRIMARY KEY AUTOINCREMENT, pendenz_id TEXT NOT NULL REFERENCES pendenzen(id) ON DELETE CASCADE,
                von TEXT NOT NULL,                    -- 'admin' oder Experten-ID
                art TEXT NOT NULL,                    -- notiz | korrektur | erledigt | offen | status
                text_enc TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pendenz_anhaenge (
                id TEXT PRIMARY KEY, pendenz_id TEXT NOT NULL REFERENCES pendenzen(id) ON DELETE CASCADE,
                name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, daten_enc TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS experten (
                id TEXT PRIMARY KEY, name_enc TEXT NOT NULL, email_enc TEXT, notiz_enc TEXT,
                token_hash TEXT UNIQUE, gesperrt INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_seen TEXT
            );
            CREATE TABLE IF NOT EXISTS pendenz_experten (
                pendenz_id TEXT NOT NULL REFERENCES pendenzen(id) ON DELETE CASCADE,
                experte_id TEXT NOT NULL REFERENCES experten(id) ON DELETE CASCADE,
                PRIMARY KEY (pendenz_id, experte_id)
            );
        ''')


# --- Hilfen ---------------------------------------------------------------------------
def _enc(s):
    return M.text_enc(s, AAD) if s else None


def _dec(s):
    return M.text_dec(s, AAD) if s else None


def _id():
    return secrets.token_urlsafe(9)


def _stellen(liste):
    out = []
    for s in (liste or [])[:20]:
        if not isinstance(s, dict):
            continue
        label = str(s.get('label') or '').strip()[:160]
        url = str(s.get('url') or '').strip()[:500]
        if label and URL_OK.match(url):
            out.append({'label': label, 'url': url})
    return out


def _pendenz_json(conn, r, experten_namen, mit_zuteilung=True):
    import json
    eintr = conn.execute('SELECT * FROM pendenz_eintraege WHERE pendenz_id = ? ORDER BY id', (r['id'],)).fetchall()
    anh = conn.execute('SELECT id, name, mime, bytes, created_at FROM pendenz_anhaenge WHERE pendenz_id = ? ORDER BY created_at', (r['id'],)).fetchall()
    d = {'id': r['id'], 'titel': r['titel'], 'text': r['text'], 'stellen': json.loads(r['stellen'] or '[]'), 'status': r['status'],
         'prioritaet': r['prioritaet'], 'createdAt': r['created_at'], 'updatedAt': r['updated_at'],
         'verlauf': [{'von': 'Betreiber' if e['von'] == 'admin' else experten_namen.get(e['von'], 'Experte'), 'art': e['art'],
                      'text': _dec(e['text_enc']), 'at': e['created_at']} for e in eintr],
         'anhaenge': [{'id': a['id'], 'name': a['name'], 'mime': a['mime'], 'bytes': a['bytes'], 'at': a['created_at']} for a in anh]}
    if mit_zuteilung:
        d['experten'] = [x['experte_id'] for x in conn.execute('SELECT experte_id FROM pendenz_experten WHERE pendenz_id = ?', (r['id'],))]
    return d


def _namen(conn):
    return {r['id']: (_dec(r['name_enc']) or 'Experte') for r in conn.execute('SELECT id, name_enc FROM experten')}


def _download(a):
    raw = base64.b64decode(_dec(a['daten_enc']) or '')
    name = re.sub(r'[^\w.()+ -]', '_', a['name'])
    resp = Response(raw, mimetype=a['mime'] if re.match(r'^[\w.+-]+/[\w.+-]+$', a['mime']) else 'application/octet-stream')
    resp.headers['Content-Disposition'] = 'attachment; filename="' + name.replace('"', '') + '"'
    resp.headers['Cache-Control'] = 'no-store'
    return resp


def neue_pendenz(titel, text, stellen=None, prioritaet=2):
    """Auch serverseitig nutzbar (z. B. beim Einrichten)."""
    pid = _id()
    import json
    with _db() as conn:
        conn.execute('INSERT INTO pendenzen (id, titel, text, stellen, status, prioritaet, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                     (pid, titel[:200], (text or '')[:8000], json.dumps(_stellen(stellen), ensure_ascii=False), 'offen', int(prioritaet), _now(), _now()))
    return pid


def anhang_speichern(pid, name, mime, daten):
    if len(daten) > MAX_ANHANG:
        raise ValueError('zu gross')
    aid = _id()
    with _db() as conn:
        conn.execute('INSERT INTO pendenz_anhaenge (id, pendenz_id, name, mime, bytes, daten_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (aid, pid, NAME_RE.sub('_', name)[:150] or 'anhang', mime[:100], len(daten), _enc(base64.b64encode(daten).decode()), _now()))
    return aid


# --- Admin ----------------------------------------------------------------------------
def _nf():
    return jsonify({'error': 'NOT_FOUND'}), 404


@v2.route('/v2/api/admin/pendenzen')
def adm_pendenzen():
    if not _admin_ok():
        return _nf()
    with _db() as conn:
        namen = _namen(conn)
        p = [_pendenz_json(conn, r, namen) for r in conn.execute("SELECT * FROM pendenzen ORDER BY status = 'erledigt', prioritaet, created_at")]
        ex = [{'id': r['id'], 'name': _dec(r['name_enc']), 'email': _dec(r['email_enc']), 'notiz': _dec(r['notiz_enc']), 'gesperrt': bool(r['gesperrt']),
               'aktiv': bool(r['token_hash']) and not r['gesperrt'], 'lastSeen': r['last_seen']} for r in conn.execute('SELECT * FROM experten ORDER BY created_at')]
    return jsonify({'pendenzen': p, 'experten': ex})


@v2.route('/v2/api/admin/pendenzen', methods=['POST'])
def adm_pendenz_neu():
    if not _admin_ok():
        return _nf()
    b = _json_body() or {}
    titel = str(b.get('titel') or '').strip()
    if not titel:
        return jsonify({'error': 'BAD_REQUEST'}), 400
    return jsonify({'id': neue_pendenz(titel, str(b.get('text') or ''), b.get('stellen'), b.get('prioritaet') or 2)})


@v2.route('/v2/api/admin/pendenzen/<pid>', methods=['POST', 'DELETE'])
def adm_pendenz(pid):
    if not _admin_ok() or not ID_RE.match(pid):
        return _nf()
    import json
    with _db() as conn:
        r = conn.execute('SELECT * FROM pendenzen WHERE id = ?', (pid,)).fetchone()
        if not r:
            return _nf()
        if request.method == 'DELETE':
            conn.execute('DELETE FROM pendenzen WHERE id = ?', (pid,))
            return jsonify({'status': 'deleted'})
        b = _json_body() or {}
        felder = {}
        if 'titel' in b and str(b['titel']).strip():
            felder['titel'] = str(b['titel']).strip()[:200]
        if 'text' in b:
            felder['text'] = str(b['text'] or '')[:8000]
        if 'stellen' in b:
            felder['stellen'] = json.dumps(_stellen(b['stellen']), ensure_ascii=False)
        if b.get('status') in STATUS and b['status'] != r['status']:
            felder['status'] = b['status']
            conn.execute('INSERT INTO pendenz_eintraege (pendenz_id, von, art, text_enc, created_at) VALUES (?, ?, ?, ?, ?)', (pid, 'admin', 'status', _enc('Status: ' + b['status']), _now()))
        if 'prioritaet' in b and str(b['prioritaet']) in ('1', '2', '3'):
            felder['prioritaet'] = int(b['prioritaet'])
        if 'experten' in b and isinstance(b['experten'], list):
            conn.execute('DELETE FROM pendenz_experten WHERE pendenz_id = ?', (pid,))
            for eid in b['experten'][:50]:
                if isinstance(eid, str) and conn.execute('SELECT 1 FROM experten WHERE id = ?', (eid,)).fetchone():
                    conn.execute('INSERT OR IGNORE INTO pendenz_experten (pendenz_id, experte_id) VALUES (?, ?)', (pid, eid))
        if felder:
            felder['updated_at'] = _now()
            conn.execute('UPDATE pendenzen SET ' + ', '.join(k + ' = ?' for k in felder) + ' WHERE id = ?', (*felder.values(), pid))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/admin/pendenzen/<pid>/eintrag', methods=['POST'])
def adm_eintrag(pid):
    if not _admin_ok() or not ID_RE.match(pid):
        return _nf()
    text = str((_json_body() or {}).get('text') or '').strip()[:4000]
    if not text:
        return jsonify({'error': 'BAD_REQUEST'}), 400
    with _db() as conn:
        if not conn.execute('SELECT 1 FROM pendenzen WHERE id = ?', (pid,)).fetchone():
            return _nf()
        conn.execute('INSERT INTO pendenz_eintraege (pendenz_id, von, art, text_enc, created_at) VALUES (?, ?, ?, ?, ?)', (pid, 'admin', 'notiz', _enc(text), _now()))
        conn.execute('UPDATE pendenzen SET updated_at = ? WHERE id = ?', (_now(), pid))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/admin/pendenzen/<pid>/anhang', methods=['POST'])
def adm_anhang_neu(pid):
    if not _admin_ok() or not ID_RE.match(pid):
        return _nf()
    daten = request.get_data(cache=False)
    if not daten or len(daten) > MAX_ANHANG:
        return jsonify({'error': 'TOO_LARGE' if daten else 'BAD_REQUEST'}), 413 if daten else 400
    with _db() as conn:
        if not conn.execute('SELECT 1 FROM pendenzen WHERE id = ?', (pid,)).fetchone():
            return _nf()
    from urllib.parse import unquote
    name = unquote(request.headers.get('X-Dateiname', 'anhang'))
    return jsonify({'id': anhang_speichern(pid, name, request.headers.get('Content-Type', 'application/octet-stream'), daten)})


@v2.route('/v2/api/admin/anhang/<aid>', methods=['GET', 'DELETE'])
def adm_anhang(aid):
    if not _admin_ok() or not ID_RE.match(aid):
        return _nf()
    with _db() as conn:
        a = conn.execute('SELECT * FROM pendenz_anhaenge WHERE id = ?', (aid,)).fetchone()
        if not a:
            return _nf()
        if request.method == 'DELETE':
            conn.execute('DELETE FROM pendenz_anhaenge WHERE id = ?', (aid,))
            return jsonify({'status': 'deleted'})
    return _download(a)


@v2.route('/v2/api/admin/experten', methods=['POST'])
def adm_experte_neu():
    if not _admin_ok():
        return _nf()
    b = _json_body() or {}
    name = str(b.get('name') or '').strip()[:120]
    email = str(b.get('email') or '').strip()
    if not name or (email and not M.email_ok(email)):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    eid = _id(); token = secrets.token_urlsafe(32)
    with _db() as conn:
        conn.execute('INSERT INTO experten (id, name_enc, email_enc, notiz_enc, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                     (eid, _enc(name), _enc(M.email_norm(email)) if email else None, _enc(str(b.get('notiz') or '')[:500]), _sha(token), _now()))
    return jsonify({'id': eid, 'token': token})


@v2.route('/v2/api/admin/experten/<eid>', methods=['POST', 'DELETE'])
def adm_experte(eid):
    """POST {aktion: 'link'} = neuen Link erzeugen (alter wird ungültig); 'sperren'; DELETE = entfernen."""
    if not _admin_ok() or not ID_RE.match(eid):
        return _nf()
    with _db() as conn:
        if not conn.execute('SELECT 1 FROM experten WHERE id = ?', (eid,)).fetchone():
            return _nf()
        if request.method == 'DELETE':
            conn.execute('DELETE FROM experten WHERE id = ?', (eid,))
            return jsonify({'status': 'deleted'})
        aktion = (_json_body() or {}).get('aktion')
        if aktion == 'link':
            token = secrets.token_urlsafe(32)
            conn.execute('UPDATE experten SET token_hash = ?, gesperrt = 0 WHERE id = ?', (_sha(token), eid))
            return jsonify({'token': token})
        if aktion == 'sperren':
            conn.execute('UPDATE experten SET token_hash = NULL, gesperrt = 1 WHERE id = ?', (eid,))
            return jsonify({'status': 'gesperrt'})
    return jsonify({'error': 'BAD_REQUEST'}), 400


# --- Experten ------------------------------------------------------------------------
def _experte():
    t = request.headers.get('X-Experte', '')
    if not TOKEN_RE.match(t):
        _rate_hit('experte_fail', limit=30, window=900)
        return None
    with _db() as conn:
        r = conn.execute('SELECT * FROM experten WHERE token_hash = ? AND gesperrt = 0', (_sha(t),)).fetchone()
        if r:
            conn.execute('UPDATE experten SET last_seen = ? WHERE id = ?', (_now(), r['id']))
    if not r:
        _rate_hit('experte_fail', limit=30, window=900)
    return r


def _zugeteilt(conn, pid, eid):
    return conn.execute('SELECT 1 FROM pendenz_experten WHERE pendenz_id = ? AND experte_id = ?', (pid, eid)).fetchone() is not None


@v2.route('/v2/experte')
def experte_seite():
    return render_template('v2/experte.html')


@v2.route('/v2/api/experte/pendenzen')
def ex_pendenzen():
    _rate_hit('experte', limit=120, window=600)
    e = _experte()
    if not e:
        return _nf()
    with _db() as conn:
        namen = _namen(conn)
        p = [_pendenz_json(conn, r, namen, mit_zuteilung=False) for r in conn.execute(
            "SELECT p.* FROM pendenzen p JOIN pendenz_experten z ON z.pendenz_id = p.id WHERE z.experte_id = ? ORDER BY p.status = 'erledigt', p.prioritaet, p.created_at", (e['id'],))]
    return jsonify({'name': _dec(e['name_enc']), 'pendenzen': p})


@v2.route('/v2/api/experte/pendenzen/<pid>', methods=['POST'])
def ex_aktion(pid):
    _rate_hit('experte_post', limit=60, window=600)
    e = _experte()
    if not e or not ID_RE.match(pid):
        return _nf()
    b = _json_body() or {}
    aktion = b.get('aktion'); text = str(b.get('text') or '').strip()[:4000]
    if aktion not in ('erledigt', 'offen', 'korrektur', 'notiz') or (aktion in ('korrektur', 'notiz') and not text):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    with _db() as conn:
        if not _zugeteilt(conn, pid, e['id']):
            return _nf()
        conn.execute('INSERT INTO pendenz_eintraege (pendenz_id, von, art, text_enc, created_at) VALUES (?, ?, ?, ?, ?)', (pid, e['id'], aktion, _enc(text) if text else None, _now()))
        neu = {'erledigt': 'erledigt', 'offen': 'offen', 'korrektur': 'korrektur'}.get(aktion)
        conn.execute('UPDATE pendenzen SET updated_at = ?' + (', status = ?' if neu else '') + ' WHERE id = ?', (_now(), neu, pid) if neu else (_now(), pid))
    if aktion in ('korrektur', 'erledigt') and M.admin_adresse():
        M.senden(M.admin_adresse(), 'Pendenz: ' + ('Korrektur gemeldet' if aktion == 'korrektur' else 'erledigt'),
                 (_dec(e['name_enc']) or 'Ein Experte') + (' meldet eine Korrektur.' if aktion == 'korrektur' else ' hat eine Pendenz abgehakt.') +
                 '\n\nDetails in der Administration: https://apps.graswachstum.ch/futter/v2/admin\n')
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/experte/anhang/<aid>')
def ex_anhang(aid):
    _rate_hit('experte', limit=120, window=600)
    e = _experte()
    if not e or not ID_RE.match(aid):
        return _nf()
    with _db() as conn:
        a = conn.execute('SELECT * FROM pendenz_anhaenge WHERE id = ?', (aid,)).fetchone()
        if not a or not _zugeteilt(conn, a['pendenz_id'], e['id']):
            return _nf()
    return _download(a)
