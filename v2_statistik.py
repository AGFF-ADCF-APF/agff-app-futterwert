"""Futter v2 – anonyme Beiträge für Auswertungen/Publikationen und regionaler Vergleich.

Beiträge sind freiwillig (Einwilligung, jederzeit widerrufbar) und enthalten keine Namen, Betriebe,
Parzellen, Notizen oder Fotos – nur PLZ, auf 100 m gerundete Höhe, Monat/Jahr, Futterart, Bestand,
Stadium, Antworten der Beurteilung, geschätzte Werte und ggf. Laborwerte.
Ein Beitrag ist nur über eine zufällige ID plus geheimes Token (Hash auf dem Server) änderbar/löschbar.
Vergleiche werden erst ab 5 Beiträgen je Gruppe ausgegeben (k-Anonymität).
"""
import csv
import hmac
import io
import json
import re
import statistics

from flask import Response, jsonify, request

from v2_api import v2, _db, _now, _sha, _rate_hit, _json_body, ID_RE, TOKEN_RE

BEITRAG_CONSENT_VERSION = '2026-10-s1'
K_MIN = 5
_SHORT = re.compile(r'^[A-Za-z0-9_.-]{0,16}$')
WERTE = ('nel', 'nev', 'apde', 'apdn', 'rp', 'rf', 'ndf', 'zucker', 'staerke')
LABOR = ('nel', 'nev', 'apde', 'apdn', 'rp', 'ts', 'rf', 'ndf', 'adf', 'zucker', 'ra', 'ph', 'milchsaeure', 'essigsaeure', 'buttersaeure')


def init_statistik_db():
    with _db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS beitraege (
                id TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL,
                typ TEXT NOT NULL, plz TEXT NOT NULL, region TEXT NOT NULL,
                jahr INTEGER, aufwuchs TEXT,
                daten TEXT NOT NULL,
                consent_version TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS beitraege_vergleich ON beitraege (typ, region);
        ''')


def _zahl(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


def pruefen(d):
    """Strikte Whitelist. Gibt bereinigte Daten oder None zurück."""
    erlaubt = {'typ', 'plz', 'hoehe', 'jahr', 'monat', 'aufwuchs', 'bestand', 'stadium', 'klasse', 'punkte', 'antworten', 'rad', 'werte', 'labor'}
    if not isinstance(d, dict) or d.get('typ') not in ('heu', 'gras', 'mais') or set(d) - erlaubt:
        return None
    plz = str(d.get('plz') or '')
    if not re.match(r'^[1-9]\d{3}$', plz):
        return None
    out = {'typ': d['typ'], 'plz': plz}
    if d.get('hoehe') is not None:
        if not _zahl(d['hoehe'], 0, 4000):
            return None
        out['hoehe'] = int(round(d['hoehe'] / 100.0) * 100)
    if not (_zahl(d.get('jahr'), 2000, 2100) and _zahl(d.get('monat'), 1, 12)):
        return None
    out['jahr'], out['monat'] = int(d['jahr']), int(d['monat'])
    for k in ('aufwuchs', 'bestand', 'stadium', 'klasse'):
        if d.get(k) is not None:
            if not isinstance(d[k], str) or not _SHORT.match(d[k]):
                return None
            out[k] = d[k]
    if d.get('punkte') is not None:
        if not _zahl(d['punkte'], 0, 60):
            return None
        out['punkte'] = d['punkte']
    for teil, erlaubt in (('antworten', None), ('rad', None)):
        x = d.get(teil) or {}
        if not isinstance(x, dict) or len(x) > 30:
            return None
        clean = {}
        for k, v in x.items():
            if not _SHORT.match(str(k)):
                return None
            if isinstance(v, bool) or v is None or (_zahl(v, -1e5, 1e5)) or (isinstance(v, str) and _SHORT.match(v)):
                clean[k] = v
            else:
                return None
        out[teil] = clean
    for teil, keys in (('werte', WERTE), ('labor', LABOR)):
        x = d.get(teil) or {}
        if not isinstance(x, dict) or not set(x) <= set(keys) or not all(_zahl(v, 0, 2000) for v in x.values()):
            return None
        if x:
            out[teil] = x
    return out


@v2.route('/v2/api/statistik/<bid>', methods=['PUT'])
def beitrag_speichern(bid):
    _rate_hit('beitrag', limit=200, window=3600)
    body = _json_body() or {}
    tok = body.get('token', '')
    if not ID_RE.match(bid) or not TOKEN_RE.match(tok):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    if (body.get('consent') or {}).get('version') != BEITRAG_CONSENT_VERSION:
        return jsonify({'error': 'CONSENT_REQUIRED', 'consentVersion': BEITRAG_CONSENT_VERSION}), 400
    d = pruefen(body.get('daten'))
    if d is None:
        return jsonify({'error': 'REJECTED_CONTENT'}), 422
    with _db() as conn:
        alt = conn.execute('SELECT token_hash FROM beitraege WHERE id = ?', (bid,)).fetchone()
        if alt and not hmac.compare_digest(alt['token_hash'], _sha(tok)):
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.execute('INSERT INTO beitraege (id, token_hash, typ, plz, region, jahr, aufwuchs, daten, consent_version, created_at, updated_at) '
                     'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET typ = excluded.typ, plz = excluded.plz, '
                     'region = excluded.region, jahr = excluded.jahr, aufwuchs = excluded.aufwuchs, daten = excluded.daten, '
                     'consent_version = excluded.consent_version, updated_at = excluded.updated_at',
                     (bid, _sha(tok), d['typ'], d['plz'], d['plz'][:2], d['jahr'], d.get('aufwuchs'), json.dumps(d), BEITRAG_CONSENT_VERSION, _now(), _now()))
    return jsonify({'status': 'ok'})


@v2.route('/v2/api/statistik/<bid>', methods=['DELETE'])
def beitrag_loeschen(bid):
    tok = request.headers.get('X-Beitrag-Token', '')
    with _db() as conn:
        alt = conn.execute('SELECT token_hash FROM beitraege WHERE id = ?', (bid,)).fetchone()
        if alt and TOKEN_RE.match(tok) and hmac.compare_digest(alt['token_hash'], _sha(tok)):
            conn.execute('DELETE FROM beitraege WHERE id = ?', (bid,))
    return jsonify({'status': 'deleted'})  # gleiche Antwort, ob vorhanden oder nicht


def _verteilung(werte):
    if len(werte) < K_MIN:
        return None
    s = sorted(werte)
    q = statistics.quantiles(s, n=10, method='inclusive')
    return {'n': len(s), 'p10': round(q[0], 2), 'p25': round(statistics.quantiles(s, n=4, method='inclusive')[0], 2),
            'p50': round(statistics.median(s), 2), 'p75': round(statistics.quantiles(s, n=4, method='inclusive')[2], 2), 'p90': round(q[8], 2),
            'mittel': round(statistics.fmean(s), 2)}


def _gruppe(rows):
    daten = [json.loads(r['daten']) for r in rows]
    if len(daten) < K_MIN:
        return {'n': len(daten)} if daten else {'n': 0}
    out = {'n': len(daten)}
    for k in ('nel', 'apde', 'rp'):
        v = _verteilung([d['werte'][k] for d in daten if k in d.get('werte', {})])
        if v:
            out[k] = v
    lab = _verteilung([d['labor']['nel'] for d in daten if 'nel' in d.get('labor', {})])
    if lab:
        out['laborNel'] = lab
    klassen = {}
    for d in daten:
        if d.get('klasse'):
            klassen[d['klasse']] = klassen.get(d['klasse'], 0) + 1
    out['klassen'] = klassen
    return out


@v2.route('/v2/api/statistik/vergleich')
def vergleich():
    _rate_hit('vergleich', limit=300, window=3600)
    typ, plz, aufwuchs = request.args.get('typ', ''), request.args.get('plz', ''), request.args.get('aufwuchs', '')
    if typ not in ('heu', 'gras', 'mais') or not re.match(r'^[1-9]\d{3}$', plz):
        return jsonify({'error': 'BAD_REQUEST'}), 400
    jahr_min = int(request.args.get('seit', '0') or 0)
    with _db() as conn:
        basis = 'SELECT daten FROM beitraege WHERE typ = ? AND (jahr >= ? OR ? = 0)'
        par = [typ, jahr_min, jahr_min]
        if aufwuchs in ('1', 'f'):
            basis += ' AND aufwuchs = ?'
            par.append(aufwuchs)
        region = conn.execute(basis + ' AND region = ?', par + [plz[:2]]).fetchall()
        schweiz = conn.execute(basis, par).fetchall()
    resp = jsonify({'region': dict(_gruppe(region), plz2=plz[:2]), 'schweiz': _gruppe(schweiz), 'kMin': K_MIN})
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@v2.route('/v2/api/statistik/config')
def statistik_config():
    return jsonify({'consentVersion': BEITRAG_CONSENT_VERSION, 'kMin': K_MIN})


@v2.route('/v2/api/admin/statistik.csv')
def admin_export():
    """Export für Auswertungen/Publikationen (nur Betreiber)."""
    import v2_admin as ADM
    if not ADM._admin_ok():
        return jsonify({'error': 'NOT_FOUND'}), 404
    with _db() as conn:
        rows = conn.execute('SELECT daten, created_at FROM beitraege ORDER BY created_at').fetchall()
    spalten = ['typ', 'plz', 'hoehe', 'jahr', 'monat', 'aufwuchs', 'bestand', 'stadium', 'klasse', 'punkte'] + \
              ['schaetzung_' + k for k in WERTE] + ['labor_' + k for k in LABOR] + ['antworten', 'rad']
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=';')
    w.writerow(spalten)
    for r in rows:
        d = json.loads(r['daten'])
        w.writerow([d.get(k, '') for k in spalten[:10]] + [d.get('werte', {}).get(k, '') for k in WERTE] +
                   [d.get('labor', {}).get(k, '') for k in LABOR] + [json.dumps(d.get('antworten', {})), json.dumps(d.get('rad', {}))])
    return Response('﻿' + buf.getvalue(), mimetype='text/csv; charset=utf-8',
                    headers={'Content-Disposition': 'attachment; filename="futter_beitraege.csv"', 'Cache-Control': 'no-store'})
