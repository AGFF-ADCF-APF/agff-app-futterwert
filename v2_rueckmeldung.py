"""Futter v2 – Rückmeldung zur Beta («Diese App gefällt mir»: Daumen hoch/runter, freiwilliger Text).

Datenschutz: anonym. Gespeichert werden nur Daumen, Text (verschlüsselt mit dem Serverschlüssel),
App (futter/wiese), Build und Datum – keine IP-Adresse, keine Kennung, keine Cookies.
Einträge werden nach RETENTION_DAYS gelöscht; die Administration kann sie früher löschen.
"""
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

from flask import jsonify

import v2_mail as M
from v2_api import v2, _db, _rate_hit, _json_body, RETENTION_DAYS
from v2_admin import _admin_ok

AAD = b'agff-rueckmeldung'
MAX_TEXT = 2000
_BUILD_RE = re.compile(r'^[A-Za-z0-9.-]{1,16}$')


def init_rueckmeldung_db():
    with _db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS rueckmeldungen (
                id TEXT PRIMARY KEY,
                datum TEXT NOT NULL,             -- nur Tag (YYYY-MM-DD)
                app TEXT NOT NULL,               -- futter | wiese
                daumen TEXT NOT NULL,            -- hoch | runter
                text_enc TEXT,
                build TEXT
            );
        ''')


def _aufraeumen(conn):
    grenze = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).strftime('%Y-%m-%d')
    conn.execute('DELETE FROM rueckmeldungen WHERE datum < ?', (grenze,))


@v2.route('/v2/api/rueckmeldung', methods=['POST'])
def rueckmeldung():
    _rate_hit('rueckmeldung', limit=10, window=3600)
    b = _json_body()
    if not isinstance(b, dict):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    daumen = b.get('daumen')
    app_ = b.get('app') if b.get('app') in ('futter', 'wiese') else 'futter'
    text = b.get('text') or ''
    build = b.get('build') if isinstance(b.get('build'), str) and _BUILD_RE.match(b.get('build')) else None
    if daumen not in ('hoch', 'runter') or not isinstance(text, str) or len(text) > MAX_TEXT:
        return jsonify({'error': 'BAD_REQUEST'}), 400
    text = text.strip()
    with _db() as conn:
        _aufraeumen(conn)
        conn.execute('INSERT INTO rueckmeldungen (id, datum, app, daumen, text_enc, build) VALUES (?, ?, ?, ?, ?, ?)',
                     (secrets.token_urlsafe(9), time.strftime('%Y-%m-%d', time.gmtime()), app_, daumen,
                      M.text_enc(text, AAD) if text else None, build))
    return jsonify({'ok': True})


@v2.route('/v2/api/admin/rueckmeldungen')
def admin_rueckmeldungen():
    if not _admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    with _db() as conn:
        _aufraeumen(conn)
        rows = conn.execute('SELECT * FROM rueckmeldungen ORDER BY datum DESC, rowid DESC LIMIT 1000').fetchall()
    return jsonify({'eintraege': [{'id': r['id'], 'datum': r['datum'], 'app': r['app'], 'daumen': r['daumen'], 'build': r['build'],
                                   'text': M.text_dec(r['text_enc'], AAD) if r['text_enc'] else None} for r in rows]})


@v2.route('/v2/api/admin/rueckmeldungen/<rid>', methods=['DELETE'])
def admin_rueckmeldung_loeschen(rid):
    if not _admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    with _db() as conn:
        conn.execute('DELETE FROM rueckmeldungen WHERE id = ?', (rid,))
    return jsonify({'ok': True})


init_rueckmeldung_db()
