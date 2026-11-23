"""Prüfstand: dieselben Anfragen an Flask (Referenz) und PHP (Port), Antworten vergleichen.

    python3 -I allinkl/test/vertrag.py [--flask http://127.0.0.1:5098/v2/] [--php http://127.0.0.1:5097/futter/] [--nur statistik,...]

Verglichen werden Statuscode, Sicherheits-Header und der JSON-Inhalt. Zufällige oder zeitabhängige Werte (IDs, Zeitstempel,
Tokens) werden vorher durch Platzhalter ersetzt. Jeder Fall läuft gegen beide Server mit denselben (vom Client gewählten) IDs.
Beide Server müssen frisch gestartet sein (allinkl/test/start.sh), sonst stören Altdaten und Ratenbegrenzungen.
"""
import argparse
import json
import re
import secrets
import sys
import urllib.error
import urllib.request

ADMIN = 'test-admin-passwort'
ISO = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(\+00:00|Z)?$')
TAG = re.compile(r'^\d{4}-\d{2}-\d{2}$')
SICHER = ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Cross-Origin-Opener-Policy',
          'Cross-Origin-Resource-Policy', 'Permissions-Policy', 'Strict-Transport-Security', 'Cache-Control']


class Antwort:
    def __init__(self, status, kopf, roh):
        self.status, self.kopf, self.roh = status, kopf, roh
        try:
            self.json = json.loads(roh.decode('utf-8-sig'))
        except Exception:  # noqa: BLE001
            self.json = None


def anfrage(basis, methode, pfad, body=None, kopf=None, roh=None):
    daten = roh if roh is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'Content-Type': 'application/json'} if body is not None else {}
    h.update(kopf or {})
    req = urllib.request.Request(basis + pfad, data=daten, method=methode, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return Antwort(r.status, dict(r.headers), r.read())
    except urllib.error.HTTPError as e:
        return Antwort(e.code, dict(e.headers), e.read())


def norm(v, schluessel=''):
    """Zufälliges und Zeitabhängiges durch Platzhalter ersetzen."""
    if isinstance(v, dict):
        return {k: norm(x, k) for k, x in sorted(v.items())}
    if isinstance(v, list):
        return [norm(x, schluessel) for x in v]
    if isinstance(v, str):
        if ISO.match(v):
            return '<zeit>'
        if TAG.match(v) and schluessel in ('datum',):
            return '<tag>'
        if schluessel in ('id',) and re.match(r'^[A-Za-z0-9_-]{8,}$', v):
            return '<id>'
    if isinstance(v, float) and v == int(v):
        return int(v)  # 88.0 (Python) vs 88 (PHP ohne Nachkommastellen) gilt als gleich
    return v


class Pruefung:
    def __init__(self, flask, php):
        self.flask, self.php = flask, php
        self.fehler, self.ok = [], 0

    def vergleich(self, name, methode, pfad, body=None, kopf=None, roh=None, nur_status=False, header=True, erwartet=None):
        a = anfrage(self.flask, methode, pfad, body, kopf, roh)
        b = anfrage(self.php, methode, pfad, body, kopf, roh)
        probleme = []
        if a.status != b.status:
            probleme.append(f'Status Flask {a.status} ≠ PHP {b.status}')
        if erwartet is not None and a.status != erwartet:
            probleme.append(f'Flask-Status {a.status}, erwartet {erwartet} (Testfall prüfen)')
        if header:
            for h in SICHER:
                if (a.kopf.get(h) or '') != (b.kopf.get(h) or ''):
                    probleme.append(f'Kopfzeile {h}: Flask «{a.kopf.get(h)}» ≠ PHP «{b.kopf.get(h)}»')
        if not nur_status:
            if a.json is not None or b.json is not None:
                if norm(a.json) != norm(b.json):
                    probleme.append('JSON verschieden:\n      Flask ' + json.dumps(norm(a.json), ensure_ascii=False)[:900] +
                                    '\n      PHP   ' + json.dumps(norm(b.json), ensure_ascii=False)[:900])
        if probleme:
            self.fehler.append((name, probleme))
            print(f'  ✗ {name}')
            for p in probleme:
                print('      ' + p)
        else:
            self.ok += 1
        return a, b


def tok():
    return secrets.token_urlsafe(32)


# --- Fälle ------------------------------------------------------------------------------------
def fall_grundlagen(P):
    print('Grundlagen')
    P.vergleich('config', 'GET', 'api/config')
    P.vergleich('statistik/config', 'GET', 'api/statistik/config')
    a, b = P.vergleich('basis', 'GET', 'api/basis')
    P.vergleich('admin/ich ohne Sitzung', 'GET', 'api/admin/ich')
    P.vergleich('admin csv ohne Passwort', 'GET', 'api/admin/statistik.csv')
    P.vergleich('admin csv falsches Passwort', 'GET', 'api/admin/statistik.csv', kopf={'X-Admin-Pass': 'falsch'})


def fall_rueckmeldung(P):
    print('Rückmeldung')
    for i, body in enumerate([
        {'daumen': 'hoch'}, {'daumen': 'runter', 'text': 'Test ' + 'ä' * 10, 'app': 'wiese', 'build': 'b1-92'},
        {'daumen': 'hoch', 'text': '  mit Leerraum  ', 'app': 'unbekannt', 'build': 'x' * 40},
        {'daumen': 'vielleicht'}, {'daumen': 'hoch', 'text': 'x' * 2001}, {'daumen': 'hoch', 'text': 5}, {'daumen': 'hoch', 'text': 0},
        [], 'text', None,
    ]):
        P.vergleich(f'rueckmeldung #{i}', 'POST', 'api/rueckmeldung', body=body)
    P.vergleich('rueckmeldung kein JSON', 'POST', 'api/rueckmeldung', roh=b'{kaputt', kopf={'Content-Type': 'application/json'})
    a, b = P.vergleich('admin rueckmeldungen', 'GET', 'api/admin/rueckmeldungen', kopf={'X-Admin-Pass': ADMIN})
    P.vergleich('admin rueckmeldungen ohne', 'GET', 'api/admin/rueckmeldungen')
    if a.json and b.json and a.json.get('eintraege') and b.json.get('eintraege'):
        for basis, ant in ((P.flask, a), (P.php, b)):
            anfrage(basis, 'DELETE', 'api/admin/rueckmeldungen/' + ant.json['eintraege'][0]['id'], kopf={'X-Admin-Pass': ADMIN})
        P.vergleich('admin rueckmeldungen nach Löschen', 'GET', 'api/admin/rueckmeldungen', kopf={'X-Admin-Pass': ADMIN})


def beitrag(typ='heu', plz='3052', hoehe=550, jahr=2026, monat=6, nel=5.4, **extra):
    d = {'typ': typ, 'plz': plz, 'hoehe': hoehe, 'jahr': jahr, 'monat': monat, 'aufwuchs': '1', 'bestand': 'AR', 'stadium': '3',
         'klasse': 'gut', 'punkte': 12, 'antworten': {'a': 1, 'b': 'x', 'c': True}, 'rad': {'geruch': 'g1'}, 'werte': {'nel': nel, 'apde': 80, 'rp': 140}}
    d.update(extra)
    return d


def fall_statistik(P):
    print('Statistik')
    C = {'version': '2026-10-s1'}
    P.vergleich('beitrag ohne consent', 'PUT', 'api/statistik/beitragA1', body={'token': tok(), 'daten': beitrag()})
    P.vergleich('beitrag falsche id', 'PUT', 'api/statistik/a', body={'token': tok(), 'consent': C, 'daten': beitrag()})
    P.vergleich('beitrag falsches token', 'PUT', 'api/statistik/beitragA1', body={'token': 'kurz', 'consent': C, 'daten': beitrag()})
    schlecht = [
        beitrag(typ='kuh'), beitrag(plz='0123'), beitrag(plz=3052), beitrag(plz=3052.0), beitrag(hoehe=5000), beitrag(hoehe='550'),
        beitrag(jahr=1999), beitrag(monat=13), beitrag(monat=6.5), beitrag(bestand='zu lang ' * 3), beitrag(punkte=61),
        beitrag(werte={'nel': 3000}), beitrag(werte={'fremd': 1}), beitrag(labor={'nel': -1}), beitrag(antworten={'k': [1]}),
        beitrag(antworten={'k' * 17: 1}), beitrag(rad=[]), beitrag(quelle='fremd'), beitrag(n=5.0), beitrag(n=True), beitrag(fremd=1),
        beitrag(hoehe=True), beitrag(antworten={str(i): i for i in range(31)}), 'kein objekt', None,
    ]
    for i, d in enumerate(schlecht):
        P.vergleich(f'beitrag ungültig #{i}', 'PUT', f'api/statistik/beitragX{i:02d}', body={'token': tok(), 'consent': C, 'daten': d})
    # Gültige Beiträge: genug für k-Anonymität in Region 30 und Schweiz, verschiedene Höhen und Zahlen
    werte = [5.1, 5.35, 5.8, 6.05, 4.9, 5.55, 6.2, 5.0, 5.75]
    tokens = {}
    for i, nel in enumerate(werte):
        t = tok()
        bid = f'beitragOK{i:02d}'
        tokens[bid] = t
        d = beitrag(nel=nel, plz=('3052' if i < 6 else '8000'), hoehe=[450, 550, 649, 650, 1050, 1449, 1500, 2550, None][i],
                    labor={'nel': nel + 0.1} if i % 2 == 0 else {}, quelle='kurs' if i == 3 else 'eigen', n=4 if i == 3 else None,
                    klasse=['gut', 'mittel', 'gut', 'schlecht', 'gut', 'mittel', 'gut', 'gut', 'mittel'][i], typ='heu' if i != 8 else 'gras')
        d = {k: v for k, v in d.items() if v is not None}
        P.vergleich(f'beitrag gültig {bid}', 'PUT', f'api/statistik/{bid}', body={'token': t, 'consent': C, 'daten': d})
    P.vergleich('beitrag ändern mit falschem token', 'PUT', 'api/statistik/beitragOK00', body={'token': tok(), 'consent': C, 'daten': beitrag()})
    P.vergleich('beitrag ändern richtig', 'PUT', 'api/statistik/beitragOK00', body={'token': tokens['beitragOK00'], 'consent': C, 'daten': beitrag(nel=5.15)})
    for q in ['typ=heu&plz=3052', 'typ=heu&plz=3052&aufwuchs=1', 'typ=heu&plz=8000', 'typ=gras&plz=9000', 'typ=heu&plz=3052&seit=2027',
              'typ=kuh&plz=3052', 'typ=heu&plz=30', 'typ=heu&plz=3052&aufwuchs=x']:
        P.vergleich('vergleich ' + q, 'GET', 'api/statistik/vergleich?' + q)
    for q in ['', 'typ=alle', 'typ=heu', 'typ=gras', 'typ=heu&seit=2026', 'typ=heu&seit=abc', 'typ=kuh']:
        P.vergleich('schweiz ' + q, 'GET', 'api/statistik/schweiz?' + q)
    P.vergleich('beitrag löschen falsches token', 'DELETE', 'api/statistik/beitragOK01', kopf={'X-Beitrag-Token': tok()})
    P.vergleich('beitrag löschen richtig', 'DELETE', 'api/statistik/beitragOK01', kopf={'X-Beitrag-Token': tokens['beitragOK01']})
    P.vergleich('beitrag löschen unbekannt', 'DELETE', 'api/statistik/gibtsnicht1', kopf={'X-Beitrag-Token': tok()})
    P.vergleich('schweiz nach löschen', 'GET', 'api/statistik/schweiz?typ=heu')
    # CSV-Export: Zeilen vergleichen (Reihenfolge bei gleicher Sekunde unbestimmt → sortiert)
    a = anfrage(P.flask, 'GET', 'api/admin/statistik.csv', kopf={'X-Admin-Pass': ADMIN})
    b = anfrage(P.php, 'GET', 'api/admin/statistik.csv', kopf={'X-Admin-Pass': ADMIN})
    za, zb = sorted(a.roh.decode('utf-8-sig').splitlines()), sorted(b.roh.decode('utf-8-sig').splitlines())
    if a.status != b.status or za != zb:
        P.fehler.append(('admin csv', [f'Status {a.status}/{b.status}', *[f'Flask {x}\n      PHP   {y}' for x, y in zip(za, zb) if x != y][:4]]))
        print('  ✗ admin csv')
        for p in P.fehler[-1][1]:
            print('      ' + p)
    else:
        P.ok += 1


def fall_anmeldung(P):
    print('Anmeldung (SSO)')
    P.vergleich('abmelden ohne Sitzung', 'POST', 'abmelden', header=False)
    a = anfrage(P.flask, 'GET', 'anmelden/zurueck?error=cancelled')
    b = anfrage(P.php, 'GET', 'anmelden/zurueck?error=cancelled')
    if a.status != b.status:
        P.fehler.append(('anmelden/zurueck abgebrochen', [f'Status {a.status}/{b.status}']))
    else:
        P.ok += 1
    a = anfrage(P.flask, 'GET', 'anmelden/zurueck?state=x&token=y')
    b = anfrage(P.php, 'GET', 'anmelden/zurueck?state=x&token=y')
    if a.status != b.status:
        P.fehler.append(('anmelden/zurueck ohne state', [f'Status {a.status}/{b.status}']))
    else:
        P.ok += 1


FAELLE = {'grundlagen': fall_grundlagen, 'rueckmeldung': fall_rueckmeldung, 'statistik': fall_statistik, 'anmeldung': fall_anmeldung}

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--flask', default='http://127.0.0.1:5098/v2/')
    ap.add_argument('--php', default='http://127.0.0.1:5097/futter/')
    ap.add_argument('--nur', default='')
    args = ap.parse_args()
    P = Pruefung(args.flask, args.php)
    for name, f in FAELLE.items():
        if not args.nur or name in args.nur.split(','):
            f(P)
    print(f'\n{P.ok} gleich, {len(P.fehler)} verschieden')
    sys.exit(1 if P.fehler else 0)
