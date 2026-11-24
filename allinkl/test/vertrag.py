"""Prüfstand: dieselben Anfragen an Flask (Referenz) und PHP (Port), Antworten vergleichen.

    python3 -I allinkl/test/vertrag.py [--flask http://127.0.0.1:5098/v2/] [--php http://127.0.0.1:5097/futter/] [--nur statistik,...]

Verglichen werden Statuscode, Sicherheits-Header und der JSON-Inhalt. Zufällige oder zeitabhängige Werte (IDs, Zeitstempel,
Tokens) werden vorher durch Platzhalter ersetzt. Jeder Fall läuft gegen beide Server mit denselben (vom Client gewählten) IDs.
Beide Server müssen frisch gestartet sein (allinkl/test/start.sh), sonst stören Altdaten und Ratenbegrenzungen.
"""
import argparse
import base64
import hashlib
import hmac
import os
import subprocess
import time
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
        if schluessel in ('id', 'sid') and re.match(r'^[A-Za-z0-9_-]{8,}$', v):
            return '<id>'
        if schluessel in ('session',):
            return '<token>'
        if schluessel in ('ownerId', 'teilnehmerId', 'ichId', 'kursId') and re.match(r'^[A-Za-z0-9_-]{8,}$', v):
            return '<id>'
        if schluessel in ('secret',) and re.match(r'^[A-Za-z0-9_-]{43}$', v):
            return '<geheim>'
    if schluessel in ('expiresAt',) and isinstance(v, (int, float)):
        return '<ablauf>'
    if isinstance(v, float) and v == int(v):
        return int(v)  # 88.0 (Python) vs 88 (PHP ohne Nachkommastellen) gilt als gleich
    return v


class Pruefung:
    def __init__(self, flask, php):
        self.flask, self.php = flask, php
        self.fehler, self.ok = [], 0

    def vergleich(self, name, methode, pfad, body=None, kopf=None, roh=None, nur_status=False, header=True, erwartet=None, ctx=None, sortiere=None):
        def w(x, seite):
            return x(ctx[seite]) if callable(x) else x
        ctx = ctx or {'flask': {}, 'php': {}}
        a = anfrage(self.flask, methode, w(pfad, 'flask'), w(body, 'flask'), w(kopf, 'flask'), w(roh, 'flask'))
        b = anfrage(self.php, methode, w(pfad, 'php'), w(body, 'php'), w(kopf, 'php'), w(roh, 'php'))
        if sortiere:
            for x in (a, b):
                sortiere(x.json)
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


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def hkdf(secret, info):
    """Wie crypto.js: HKDF-SHA256(secret, salt «agff-futter-v2», info) → 32 Byte base64url."""
    ikm = base64.urlsafe_b64decode(secret + '=' * (-len(secret) % 4))
    prk = hmac.new(b'agff-futter-v2', ikm, hashlib.sha256).digest()
    return b64u(hmac.new(prk, info.encode() + b'\x01', hashlib.sha256).digest())


def schluessel():
    secret = b64u(secrets.token_bytes(32))
    rt, wt = hkdf(secret, 'auth-read'), hkdf(secret, 'auth-write')
    return {'secret': secret, 'rt': rt, 'wt': wt, 'rh': hashlib.sha256(rt.encode()).hexdigest(), 'wh': hashlib.sha256(wt.encode()).hexdigest()}


def mails(seite):
    """Testpostfach (JSON-Zeilen) der Flask- bzw. PHP-Instanz."""
    if seite == 'flask':
        pfad = open('/tmp/futter-port-ref.pfad').read().strip() + '/data/mail.jsonl'
        text = open(pfad).read() if os.path.exists(pfad) else ''
    else:
        text = subprocess.run(['docker', 'compose', '-p', 'futter-port-test', 'exec', '-T', 'php', 'sh', '-c', 'cat /daten/mail.jsonl 2>/dev/null || true'],
                              capture_output=True, text=True, cwd=os.path.dirname(os.path.abspath(__file__))).stdout
    return [json.loads(z) for z in text.splitlines() if z.strip()]


def letzte_mail(seite, an):
    for m in reversed(mails(seite)):
        if m['to'] == an:
            return m
    return {}


def letzter_code(seite, an):
    for m in reversed(mails(seite)):
        if m['to'] == an and m.get('code'):
            return m['code']
    return None


# --- Fälle ------------------------------------------------------------------------------------
def fall_grundlagen(P):
    print('Grundlagen')
    P.vergleich('config', 'GET', 'api/config')
    P.vergleich('umzug/config', 'GET', 'api/umzug')
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
        P.vergleich(f'beitrag gültig {bid}', 'PUT', f'api/statistik/{bid}', body={'token': t, 'consent': C, 'daten': d}, erwartet=200)
    P.vergleich('beitrag ändern mit falschem token', 'PUT', 'api/statistik/beitragOK00', body={'token': tok(), 'consent': C, 'daten': beitrag()})
    P.vergleich('beitrag ändern richtig', 'PUT', 'api/statistik/beitragOK00', body={'token': tokens['beitragOK00'], 'consent': C, 'daten': beitrag(nel=5.15)}, erwartet=200)
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


def fall_freigaben(P):
    print('Freigaben')
    C = {'flask': {}, 'php': {}}
    for seite in C:
        C[seite].update(schluessel())
    em = 'test.freigabe@example.org'
    P.vergleich('code ungültige Adresse', 'POST', 'api/spaces/code', body={'email': 'kein'})
    P.vergleich('code ohne body', 'POST', 'api/spaces/code', roh=b'')
    P.vergleich('code senden', 'POST', 'api/spaces/code', body={'email': em}, erwartet=200)
    time.sleep(0.5)
    for seite in C:
        C[seite]['code'] = letzter_code(seite, em)
    if not (C['flask']['code'] and C['php']['code']):
        P.fehler.append(('Mail-Code', [f"Code fehlt: Flask {C['flask']['code']}, PHP {C['php']['code']}"]))
        return
    ok = {'accepted': True, 'version': '2026-10-c'}
    neu = lambda c, **x: dict({'consent': ok, 'readHash': c['rh'], 'writeHash': c['wh'], 'email': em, 'code': c['code']}, **x)
    P.vergleich('anlegen ohne consent', 'POST', 'api/spaces', body=lambda c: neu(c, consent={}), ctx=C)
    P.vergleich('anlegen alte version', 'POST', 'api/spaces', body=lambda c: neu(c, consent={'accepted': True, 'version': 'alt'}), ctx=C)
    P.vergleich('anlegen accepted 1', 'POST', 'api/spaces', body=lambda c: neu(c, consent={'accepted': 1, 'version': '2026-10-c'}), ctx=C)
    P.vergleich('anlegen schlechte hashes', 'POST', 'api/spaces', body=lambda c: neu(c, readHash='x'), ctx=C)
    P.vergleich('anlegen gleiche hashes', 'POST', 'api/spaces', body=lambda c: neu(c, writeHash=c['rh']), ctx=C)
    P.vergleich('anlegen ohne email', 'POST', 'api/spaces', body=lambda c: neu(c, email=''), ctx=C)
    P.vergleich('anlegen falscher code', 'POST', 'api/spaces', body=lambda c: neu(c, code='000000' if c['code'] != '000000' else '111111'), ctx=C)
    a, b = P.vergleich('anlegen', 'POST', 'api/spaces', body=lambda c: neu(c), ctx=C, erwartet=201)
    if a.status != 201 or b.status != 201:
        return
    C['flask']['id'], C['php']['id'] = a.json['id'], b.json['id']
    P.vergleich('code zweimal', 'POST', 'api/spaces', body=lambda c: neu(c), ctx=C)
    sp = lambda rest='': (lambda c: f"api/spaces/{c['id']}{rest}")
    R = lambda c: {'X-Read-Token': c['rt']}
    W = lambda c: {'X-Write-Token': c['wt']}
    P.vergleich('lesen ohne token', 'GET', sp(), ctx=C)
    P.vergleich('lesen falsches token', 'GET', sp(), kopf={'X-Read-Token': tok()}, ctx=C)
    P.vergleich('lesen leer', 'GET', sp(), kopf=R, ctx=C)
    probe = lambda pid, **x: {'data': {'analyse': dict({'id': pid, 'typ': 'heu', 'createdAt': '2026-11-01T10:00:00.000Z', 'updatedAt': '2026-11-02T10:00:00Z',
                                                         'kopf': {'schnitt': '2026-06-01'}, 'antworten': {'bestand': 'AR', 'n': 3, 'w': 1.5, 'b': True},
                                                         'rad': {'geruch': 'g2'}}, **x),
                                      'privat': {'name': 'Probe «Ost» ä', 'notiz': 'Zeile 1\nZeile 2', 'liste': [1, 'zwei', None, {'x': 1.0}]}},
                             'updatedAt': '2026-11-02T10:00:00Z'}
    P.vergleich('record ohne schreibrecht', 'PUT', sp('/records/probe0001'), body=probe('probe0001'), kopf=R, ctx=C)
    P.vergleich('record falsche id', 'PUT', sp('/records/p'), body=probe('p'), kopf=W, ctx=C)
    P.vergleich('record zu gross', 'PUT', sp('/records/probe0001'), roh=b'{"data":"' + b'x' * 70000 + b'"}', kopf=W, ctx=C)
    P.vergleich('record kein json', 'PUT', sp('/records/probe0001'), roh=b'{kaputt', kopf=W, ctx=C)
    schlecht = [
        {'data': None}, {'data': {'analyse': {}, 'fremd': 1}}, {'data': {'analyse': {'id': 'andere1', 'typ': 'heu'}}},
        probe('probe0001', typ='kuh'), probe('probe0001', createdAt='gestern'), probe('probe0001', quelle='v3'), probe('probe0001', fremd=1),
        probe('probe0001', kopf={'schnitt': 'Juni'}), probe('probe0001', kopf={'ort': 'x'}), probe('probe0001', antworten={'k': 'zu langer text hier'}),
        probe('probe0001', antworten={'k': 1e7}), probe('probe0001', antworten={'k': [1]}), probe('probe0001', rad=[1]),
        {'data': {'analyse': {'id': 'probe0001', 'typ': 'heu'}, 'privat': {'ungültiger schlüssel': 1}}},
        {'data': {'analyse': {'id': 'probe0001', 'typ': 'heu'}, 'privat': {'a': {'b': {'c': {'d': {'e': 1}}}}}}},
        {'data': {'analyse': {'id': 'probe0001', 'typ': 'heu'}, 'privat': {'t': 'x\u0001'}}},
        {'data': {'analyse': {'id': 'probe0001', 'typ': 'heu'}, 'privat': {'t': 'x' * 5001}}},
        {'data': {'analyse': {'id': 'probe0001', 'typ': 'heu'}, 'privat': [1]}},
        {'data': {'analyse': {'id': 'probe0001', 'typ': 'heu'}, 'privat': {'l': list(range(61))}}},
    ]
    for i, body in enumerate(schlecht):
        P.vergleich(f'record ungültig #{i}', 'PUT', sp('/records/probe0001'), body=body, kopf=W, ctx=C)
    P.vergleich('record body liste', 'PUT', sp('/records/probe0001'), roh=b'[1]', kopf=W, ctx=C, nur_status=True)
    P.vergleich('record ok', 'PUT', sp('/records/probe0001'), body=probe('probe0001'), kopf=W, ctx=C, erwartet=200)
    P.vergleich('record zweite', 'PUT', sp('/records/probe0002'), body=probe('probe0002', typ='gras', quelle='v1'), kopf=W, ctx=C, erwartet=200)
    P.vergleich('record ohne analyse', 'PUT', sp('/records/probe0003'), body={'data': {}}, kopf=W, ctx=C)
    P.vergleich('anlassmeta ok', 'PUT', sp('/records/anlassmeta'), body={'data': {'analyse': {'id': 'x', 'datum': '2026-06-01'}}}, kopf=W, ctx=C, erwartet=200)
    P.vergleich('anlassmeta datum falsch', 'PUT', sp('/records/anlassmeta'), body={'data': {'analyse': {'datum': 20260601}}}, kopf=W, ctx=C)
    alt = probe('probe0001'); alt['updatedAt'] = '2026-01-01T00:00:00Z'
    P.vergleich('record veraltet', 'PUT', sp('/records/probe0001'), body=alt, kopf=W, ctx=C, erwartet=409)
    neuer = probe('probe0001', antworten={'bestand': 'G'}); neuer['updatedAt'] = '2026-12-01T00:00:00Z'
    P.vergleich('record neuer', 'PUT', sp('/records/probe0001'), body=neuer, kopf=W, ctx=C, erwartet=200)
    num = probe('probe0002'); num['updatedAt'] = 5.0; num['data']['analyse']['typ'] = 'gras'
    P.vergleich('record updatedAt als Zahl', 'PUT', sp('/records/probe0002'), body=num, kopf=W, ctx=C)
    srt = lambda j: j and j.get('records') is not None and j['records'].sort(key=lambda r: r['id'])
    P.vergleich('lesen mit daten', 'GET', sp(), kopf=R, ctx=C, sortiere=srt, erwartet=200)
    P.vergleich('record löschen', 'DELETE', sp('/records/probe0003'), kopf=W, ctx=C)
    P.vergleich('record löschen nur lesen', 'DELETE', sp('/records/probe0002'), kopf=R, ctx=C)
    # Fotos
    jpg = b'\xff\xd8\xff\xe0' + b'J' * 300
    webp = b'RIFF\x00\x00\x00\x00WEBPVP8 ' + b'W' * 300
    P.vergleich('foto falsche id', 'PUT', sp('/fotos/kurz'), roh=jpg, kopf=W, ctx=C)
    P.vergleich('foto zu klein', 'PUT', sp('/fotos/foto000000000001'), roh=jpg[:50], kopf=W, ctx=C)
    P.vergleich('foto kein bild', 'PUT', sp('/fotos/foto000000000001'), roh=b'%PDF' + b'x' * 300, kopf=W, ctx=C)
    P.vergleich('foto ohne recht', 'PUT', sp('/fotos/foto000000000001'), roh=jpg, kopf=R, ctx=C)
    P.vergleich('foto jpeg', 'PUT', sp('/fotos/foto000000000001'), roh=jpg, kopf=W, ctx=C, erwartet=200)
    P.vergleich('foto webp', 'PUT', sp('/fotos/foto000000000002'), roh=webp, kopf=W, ctx=C, erwartet=200)
    for fid, inhalt, typ in (('foto000000000001', jpg, 'image/jpeg'), ('foto000000000002', webp, 'image/webp')):
        a = anfrage(P.flask, 'GET', sp(f'/fotos/{fid}')(C['flask']), kopf=R(C['flask']))
        b = anfrage(P.php, 'GET', sp(f'/fotos/{fid}')(C['php']), kopf=R(C['php']))
        if (a.status, a.roh, a.kopf.get('Content-Type')) != (b.status, b.roh, b.kopf.get('Content-Type')) or b.roh != inhalt or b.kopf.get('Content-Type') != typ:
            P.fehler.append(('foto lesen ' + fid, [f"Flask {a.status} {a.kopf.get('Content-Type')} {len(a.roh)} / PHP {b.status} {b.kopf.get('Content-Type')} {len(b.roh)}"]))
            print('  ✗ foto lesen ' + fid)
        else:
            P.ok += 1
    P.vergleich('foto lesen unbekannt', 'GET', sp('/fotos/foto000000000009'), kopf=R, ctx=C)
    P.vergleich('foto löschen', 'DELETE', sp('/fotos/foto000000000002'), kopf=W, ctx=C)
    P.vergleich('foto nach löschen', 'GET', sp('/fotos/foto000000000002'), kopf=R, ctx=C)
    # Gruppen-Beitritt
    P.vergleich('beitritt ohne code', 'GET', sp('/beitritt'), kopf=W, ctx=C)
    P.vergleich('beitritt nur lesen', 'GET', sp('/beitritt'), kopf=R, ctx=C)
    P.vergleich('beitritt falsches secret', 'POST', sp('/beitritt'), body={'secret': b64u(secrets.token_bytes(32))}, kopf=W, ctx=C)
    P.vergleich('beitritt secret kein text', 'POST', sp('/beitritt'), body={'secret': 5}, kopf=W, ctx=C)
    code = lambda j: j and isinstance(j.get('code'), str) and j.update(code='<code>' if re.match(r'^[23456789A-HJ-NP-Z]{8}$', j['code']) else j['code'])
    roh_codes = []

    def merk_code(j):
        roh_codes.append(j.get('code') if j else None)
        code(j)
    P.vergleich('beitritt erstellen', 'POST', sp('/beitritt'), body=lambda c: {'secret': c['secret']}, kopf=W, ctx=C, sortiere=merk_code)
    C['flask']['bcode'], C['php']['bcode'] = roh_codes
    a, b = P.vergleich('beitritt gleich', 'POST', sp('/beitritt'), body=lambda c: {'secret': c['secret']}, kopf=W, ctx=C, sortiere=code)
    a2 = anfrage(P.php, 'GET', sp('/beitritt')(C['php']), kopf=W(C['php']))
    if not a2.json or a2.json.get('code') != C['php']['bcode']:
        P.fehler.append(('beitritt GET liefert Code', [str(a2.json)]))
    P.vergleich('beitreten falscher code', 'POST', 'api/gruppen/beitreten', body={'code': 'AAAA-AAAA'})
    P.vergleich('beitreten kein code', 'POST', 'api/gruppen/beitreten', body={'code': 12345678})
    idn = lambda j: j and j.update({k: '<x>' for k in ('id', 'secret') if k in j})
    a, b = P.vergleich('beitreten mit code', 'POST', 'api/gruppen/beitreten', body=lambda c: {'code': c['bcode'][:4].lower() + '-' + c['bcode'][4:]}, ctx=C, sortiere=idn, erwartet=200)
    a, b = P.vergleich('beitritt neu', 'POST', sp('/beitritt'), body=lambda c: {'secret': c['secret'], 'neu': True}, kopf=W, ctx=C, sortiere=code, erwartet=200)
    P.vergleich('beitreten alter code', 'POST', 'api/gruppen/beitreten', body=lambda c: {'code': c['bcode']}, ctx=C, erwartet=404)
    P.vergleich('beitritt abschalten', 'DELETE', sp('/beitritt'), kopf=W, ctx=C)
    # Links erneuern
    for seite in C:
        C[seite]['neu'] = schluessel()
    rot = lambda c, **x: dict({'readHash': c['neu']['rh'], 'writeHash': c['neu']['wh'], 'records': [dict(probe('probe0001'), id='probe0001')]}, **x)
    P.vergleich('rotate schlecht', 'POST', sp('/rotate'), body=lambda c: rot(c, records='x'), kopf=W, ctx=C)
    P.vergleich('rotate record ungültig', 'POST', sp('/rotate'), body=lambda c: rot(c, records=[{'id': 'probe0009', 'data': {'analyse': {'id': 'probe0009', 'typ': 'kuh'}}}]), kopf=W, ctx=C)
    P.vergleich('rotate record ohne id', 'POST', sp('/rotate'), body=lambda c: rot(c, records=[5]), kopf=W, ctx=C)
    P.vergleich('rotate ohne recht', 'POST', sp('/rotate'), body=rot, kopf=R, ctx=C)
    P.vergleich('rotate', 'POST', sp('/rotate'), body=rot, kopf=W, ctx=C, erwartet=200)
    P.vergleich('alter link ungültig', 'GET', sp(), kopf=R, ctx=C)
    P.vergleich('neuer link', 'GET', sp(), kopf=lambda c: {'X-Read-Token': c['neu']['rt']}, ctx=C, sortiere=srt, erwartet=200)
    P.vergleich('löschen mit altem link', 'DELETE', sp(), kopf=W, ctx=C)
    P.vergleich('löschen', 'DELETE', sp(), kopf=lambda c: {'X-Write-Token': c['neu']['wt']}, ctx=C, erwartet=200)
    P.vergleich('nach löschen', 'GET', sp(), kopf=lambda c: {'X-Read-Token': c['neu']['rt']}, ctx=C, erwartet=404)


def fall_konto(P):
    print('Konto')
    C = {'flask': {'url': P.flask}, 'php': {'url': P.php}}
    em = 'konto.test@example.org'
    P.vergleich('code ungültig', 'POST', 'api/konto/code', body={'email': 'x'})
    P.vergleich('code', 'POST', 'api/konto/code', body=lambda c: {'email': em, 'appUrl': c['url']}, ctx=C, erwartet=200)
    time.sleep(0.3)
    for seite in C:
        m = letzte_mail(seite, em)
        C[seite]['code'], C[seite]['link'] = m.get('code'), m.get('login')
        if m.get('loginBase') != C[seite]['url']:
            P.fehler.append((f'Anmelde-Link {seite}', [f"Basis {m.get('loginBase')} statt {C[seite]['url']}"]))
    P.vergleich('login falscher code', 'POST', 'api/konto/login', body=lambda c: {'email': em, 'code': '000000' if c['code'] != '000000' else '111111'}, ctx=C)
    P.vergleich('login ohne alles', 'POST', 'api/konto/login', body={})
    P.vergleich('login schlechter link', 'POST', 'api/konto/login', body={'link': 'abcdefgh.' + 'x' * 43})
    P.vergleich('login unlesbarer link', 'POST', 'api/konto/login', body={'link': 'kaputt'})
    merk = []
    P.vergleich('login code', 'POST', 'api/konto/login', body=lambda c: {'email': em.upper(), 'code': c['code']}, ctx=C, erwartet=200,
                sortiere=lambda j: merk.append(j and j.get('session')))
    C['flask']['s1'], C['php']['s1'] = merk
    merk.clear()
    P.vergleich('login link', 'POST', 'api/konto/login', body=lambda c: {'link': c['link']}, ctx=C, erwartet=200, sortiere=lambda j: merk.append(j and j.get('session')))
    C['flask']['s2'], C['php']['s2'] = merk
    K = lambda c: {'X-Konto': c['s1']}
    K2 = lambda c: {'X-Konto': c['s2']}
    P.vergleich('info ohne sitzung', 'GET', 'api/konto')
    P.vergleich('info falsche sitzung', 'GET', 'api/konto', kopf={'X-Konto': tok()})
    srt = lambda j: j and isinstance(j.get('geraete'), list) and j['geraete'].sort(key=lambda g: (g['via'], g['ich']))
    P.vergleich('info', 'GET', 'api/konto', kopf=K, ctx=C, erwartet=200, sortiere=srt)
    # Cloud
    P.vergleich('cloud schlecht', 'PUT', 'api/konto/cloud', body={'app': 'x', 'an': True}, kopf=K, ctx=C)
    P.vergleich('cloud an ohne consent', 'PUT', 'api/konto/cloud', body={'app': 'futter', 'an': True}, kopf=K, ctx=C)
    P.vergleich('cloud an 1', 'PUT', 'api/konto/cloud', body={'app': 'futter', 'an': 1}, kopf=K, ctx=C)
    P.vergleich('cloud an', 'PUT', 'api/konto/cloud', body={'app': 'futter', 'an': True, 'consent': {'accepted': True, 'version': '2026-10-konto1'}}, kopf=K, ctx=C, erwartet=200)
    P.vergleich('daten wiese aus', 'GET', 'api/konto/daten/wiese', kopf=K, ctx=C)
    P.vergleich('daten unbekannte app', 'GET', 'api/konto/daten/foo', kopf=K, ctx=C)
    P.vergleich('daten leer', 'GET', 'api/konto/daten/futter', kopf=K, ctx=C)
    D = 'api/konto/daten/futter'
    P.vergleich('schreiben kein json', 'PUT', D, roh=b'{x', kopf=K, ctx=C)
    P.vergleich('schreiben liste', 'PUT', D, roh=b'[1]', kopf=K, ctx=C)
    P.vergleich('schreiben ohne records', 'PUT', D, body={'x': 1}, kopf=K, ctx=C)
    P.vergleich('schreiben zu viele', 'PUT', D, body={'records': [{'id': f'r{i}', 'data': {}} for i in range(301)]}, kopf=K, ctx=C)
    P.vergleich('schreiben wiese aus', 'PUT', 'api/konto/daten/wiese', body={'records': []}, kopf=K, ctx=C)
    recs = [{'id': 'anlass:a1', 'data': {'titel': 'Ernte «Süd»', 'n': 3, 'x': 1.5, 'tief': {'a': [1, 2, {'b': None}]}, 'e': 1e-7}, 'updatedAt': '2026-11-01T10:00:00Z'},
            {'id': 'probe:p1', 'data': [1, 'zwei', True], 'updatedAt': '2026-11-02T10:00:00Z'},
            {'id': 'probe:p2', 'data': None, 'updatedAt': '2026-11-03T10:00:00Z'}]
    stand = []
    P.vergleich('schreiben ok', 'PUT', D, body={'records': recs}, kopf=K, ctx=C, erwartet=200, sortiere=lambda j: stand.append(j and j.get('stand')))
    C['flask']['stand'], C['php']['stand'] = stand
    alt = dict(recs[0], updatedAt='2026-01-01T00:00:00Z', data={'titel': 'alt'})
    P.vergleich('schreiben veraltet', 'PUT', D, body={'records': [alt, dict(recs[1], updatedAt='2026-12-01T00:00:00Z', data={'neu': True})]}, kopf=K, ctx=C, erwartet=200)
    P.vergleich('schreiben schlechte id mitten drin', 'PUT', D, body={'records': [{'id': 'probe:p3', 'data': {'a': 1}}, {'id': 'böse id', 'data': {}}]}, kopf=K, ctx=C)
    P.vergleich('schreiben text statt objekt', 'PUT', D, body={'records': [{'id': 'probe:p4', 'data': 'text'}]}, kopf=K, ctx=C)
    P.vergleich('schreiben zu tief', 'PUT', D, body={'records': [{'id': 'probe:p5', 'data': {'a': [[[[[[[[[[[1]]]]]]]]]]]}}]}, kopf=K, ctx=C)
    P.vergleich('schreiben langer schlüssel', 'PUT', D, body={'records': [{'id': 'probe:p6', 'data': {'k' * 101: 1}}]}, kopf=K, ctx=C)
    srt2 = lambda j: j and isinstance(j.get('records'), list) and j['records'].sort(key=lambda r: str(r['id']))
    P.vergleich('daten lesen', 'GET', D, kopf=K, ctx=C, erwartet=200, sortiere=srt2)
    P.vergleich('daten seit', 'GET', lambda c: D + '?seit=' + urllib.request.quote(c['stand']), kopf=K, ctx=C, erwartet=200, sortiere=srt2)
    P.vergleich('info nach daten', 'GET', 'api/konto', kopf=K, ctx=C, sortiere=srt)
    # Fotos
    jpg = b'\xff\xd8\xff\xe0' + b'K' * 400
    P.vergleich('foto falsche app', 'PUT', 'api/konto/fotos/kfoto00000000001?app=x', roh=jpg, kopf=K, ctx=C)
    P.vergleich('foto wiese aus', 'PUT', 'api/konto/fotos/kfoto00000000001?app=wiese', roh=jpg, kopf=K, ctx=C)
    P.vergleich('foto ok', 'PUT', 'api/konto/fotos/kfoto00000000001?app=futter', roh=jpg, kopf=K, ctx=C, erwartet=200)
    P.vergleich('foto liste', 'GET', 'api/konto/fotos', kopf=K, ctx=C)
    a = anfrage(P.flask, 'GET', 'api/konto/fotos/kfoto00000000001', kopf=K(C['flask']))
    b = anfrage(P.php, 'GET', 'api/konto/fotos/kfoto00000000001', kopf=K(C['php']))
    if (a.status, a.roh) != (b.status, b.roh) or b.roh != jpg:
        P.fehler.append(('konto foto lesen', [f'{a.status}/{b.status} {len(a.roh)}/{len(b.roh)}'])); print('  ✗ konto foto lesen')
    else:
        P.ok += 1
    P.vergleich('foto fremde sitzung', 'GET', 'api/konto/fotos/kfoto00000000001', kopf={'X-Konto': tok()})
    # Antrag Foto-Speicher
    P.vergleich('antrag schlecht', 'POST', 'api/quota-antrag', body={'wunschMb': 'viel'}, kopf=K, ctx=C)
    P.vergleich('antrag', 'POST', 'api/quota-antrag', body={'wunschMb': '250', 'begruendung': '  Kurs mit vielen Fotos  ', 'bereich': 'kurs'}, kopf=K, ctx=C, erwartet=200)
    em2 = 'antrag.ohne.konto@example.org'
    P.vergleich('antrag code', 'POST', 'api/quota-antrag/code', body={'email': em2}, erwartet=200)
    time.sleep(0.3)
    for seite in C:
        C[seite]['qcode'] = letzter_code(seite, em2)
    P.vergleich('antrag ohne konto falscher code', 'POST', 'api/quota-antrag', body={'email': em2, 'code': '999999', 'wunschMb': 50.9})
    P.vergleich('antrag ohne konto', 'POST', 'api/quota-antrag', body=lambda c: {'email': em2, 'code': c['qcode'], 'wunschMb': 50.9}, ctx=C, erwartet=200)
    asrt = lambda j: j and isinstance(j.get('antraege'), list) and j['antraege'].sort(key=lambda a: a['email'])
    liste = []
    P.vergleich('admin quota', 'GET', 'api/admin/quota', kopf={'X-Admin-Pass': ADMIN}, erwartet=200, sortiere=lambda j: (liste.append(j), asrt(j)))
    P.vergleich('admin quota ohne', 'GET', 'api/admin/quota')
    if liste[0] and liste[1]:
        C['flask']['aid'] = [a['id'] for a in liste[0]['antraege'] if a['email'] == em][0]
        C['php']['aid'] = [a['id'] for a in liste[1]['antraege'] if a['email'] == em][0]
        P.vergleich('admin entscheid schlecht', 'POST', lambda c: 'api/admin/quota/' + c['aid'], body={'status': 'vielleicht'}, kopf={'X-Admin-Pass': ADMIN}, ctx=C)
        P.vergleich('admin entscheid ok', 'POST', lambda c: 'api/admin/quota/' + c['aid'], body={'status': 'ok', 'mb': '300'}, kopf={'X-Admin-Pass': ADMIN}, ctx=C, erwartet=200)
        P.vergleich('admin entscheid unbekannt', 'POST', 'api/admin/quota/gibtsnicht', body={'status': 'ok'}, kopf={'X-Admin-Pass': ADMIN})
    P.vergleich('info mit zusatz', 'GET', 'api/konto', kopf=K, ctx=C, sortiere=srt)
    # Geräte, Links, Abmelden, Löschen
    P.vergleich('foto löschen', 'DELETE', 'api/konto/fotos/kfoto00000000001', kopf=K, ctx=C)
    P.vergleich('cloud aus löschen', 'PUT', 'api/konto/cloud', body={'app': 'futter', 'an': False, 'loeschen': True}, kopf=K, ctx=C)
    P.vergleich('logout zweites gerät', 'POST', 'api/konto/logout', kopf=K2, ctx=C)
    P.vergleich('zweites gerät weg', 'GET', 'api/konto', kopf=K2, ctx=C)
    P.vergleich('links alle weg', 'DELETE', 'api/konto/links', kopf=K, ctx=C)
    P.vergleich('link danach ungültig', 'POST', 'api/konto/login', body=lambda c: {'link': c['link']}, ctx=C)
    P.vergleich('info am schluss', 'GET', 'api/konto', kopf=K, ctx=C, sortiere=srt)
    P.vergleich('konto löschen', 'DELETE', 'api/konto', kopf=K, ctx=C, erwartet=200)
    P.vergleich('nach löschen', 'GET', 'api/konto', kopf=K, ctx=C, erwartet=404)


KC = {'accepted': True, 'version': '2026-10-k5'}
JPG = b'\xff\xd8\xff\xe0' + b'P' * 500
WEBP = b'RIFF\x00\x00\x00\x00WEBPVP8 ' + b'Q' * 400


def kurs_schluessel():
    secret = b64u(secrets.token_bytes(32))
    jt = hkdf(secret, 'kurs-join')
    return {'ksecret': secret, 'jt': jt, 'jh': hashlib.sha256(jt.encode()).hexdigest()}


def merke(liste, schluessel='session'):
    return lambda j: liste.append(j.get(schluessel) if isinstance(j, dict) else None)


def kurs_neu(P, em, name, einladung=None, secret=True):
    """Kurs anlegen und aktivieren (beide Seiten); gibt den Zustand je Seite zurück oder None."""
    C = {'flask': kurs_schluessel(), 'php': kurs_schluessel()}
    body = lambda c: dict({'consent': KC, 'email': em, 'joinHash': c['jh']}, **({'secret': c['ksecret']} if secret else {}), **({'einladung': einladung} if einladung else {}))
    ids = []
    P.vergleich(f'{name}: anlegen', 'POST', 'api/kurse', body=body, ctx=C, erwartet=201, sortiere=merke(ids, 'id'))
    if not all(ids):
        return None
    C['flask']['kid'], C['php']['kid'] = ids
    time.sleep(0.3)
    for seite in C:
        C[seite]['code'] = letzter_code(seite, em)
    tok = []
    P.vergleich(f'{name}: aktivieren', 'POST', lambda c: f"api/kurse/{c['kid']}/aktivieren", body=lambda c: {'email': em, 'code': c['code']}, ctx=C, erwartet=200, sortiere=merke(tok))
    if not all(tok):
        return None
    C['flask']['L'], C['php']['L'] = tok
    return C


def kp(rest=''):
    return lambda c: f"api/kurse/{c['kid']}{rest}"


def S(wer):
    return lambda c: {'X-Kurs-Session': c[wer]}


def tn_sort(j):
    """Teilnehmende mit gleicher Erstellungszeit haben keine feste Reihenfolge (SQLite rowid / InnoDB Primärschlüssel)."""
    if isinstance(j, dict) and isinstance(j.get('teilnehmende'), list):
        j['teilnehmende'].sort(key=lambda t: (t['rolle'] != 'leitung', json.dumps({k: v for k, v in t.items() if k != 'id'}, sort_keys=True)))


def bild_vergleich(P, name, pfad, kopf, C, inhalt, erwartet=200):
    a = anfrage(P.flask, 'GET', pfad(C['flask']), kopf=kopf(C['flask']))
    b = anfrage(P.php, 'GET', pfad(C['php']), kopf=kopf(C['php']))
    gleich = (a.status, a.kopf.get('Content-Type'), a.roh) == (b.status, b.kopf.get('Content-Type'), b.roh)
    if not gleich or a.status != erwartet or (erwartet == 200 and b.roh != inhalt):
        P.fehler.append((name, [f"Flask {a.status} {a.kopf.get('Content-Type')} {len(a.roh)} / PHP {b.status} {b.kopf.get('Content-Type')} {len(b.roh)}"]))
        print('  ✗ ' + name)
    else:
        P.ok += 1


def beurteilung(bid, typ='heu', **x):
    return {'data': {'analyse': dict({'id': bid, 'typ': typ, 'createdAt': '2026-11-05T09:00:00.000Z', 'kopf': {'schnitt': '2026-06-01'},
                                      'antworten': {'bestand': 'AR', 'n': 3, 'w': 1.5, 'b': True}, 'rad': {'geruch': 'g1'}}, **x),
                     'privat': {'notiz': 'riecht «gut» ä'}}}


def fall_kurse(P):
    print('Kurse')
    em = 'leitung@schule.example.org'
    P.vergleich('kurs-config', 'GET', 'api/kurs-config')
    jh = hashlib.sha256(b'x').hexdigest()
    P.vergleich('anlegen ohne consent', 'POST', 'api/kurse', body={'email': em, 'joinHash': jh})
    P.vergleich('anlegen alte version', 'POST', 'api/kurse', body={'consent': {'accepted': True, 'version': 'alt'}, 'email': em, 'joinHash': jh})
    P.vergleich('anlegen schlechter hash', 'POST', 'api/kurse', body={'consent': KC, 'email': em, 'joinHash': 'abc'})
    P.vergleich('anlegen nicht freigeschaltet', 'POST', 'api/kurse', body={'consent': KC, 'email': 'lehrer@andere.example.org', 'joinHash': jh})
    C = kurs_neu(P, em, 'kurs')
    if not C:
        return
    P.vergleich('aktivieren nochmals', 'POST', kp('/aktivieren'), body=lambda c: {'email': em, 'code': c['code']}, ctx=C)
    P.vergleich('aktivieren ungültige adresse', 'POST', kp('/aktivieren'), body={'email': 'x'}, ctx=C)
    P.vergleich('lesen leitung leer', 'GET', kp(), kopf=S('L'), ctx=C, erwartet=200)
    P.vergleich('lesen ohne sitzung', 'GET', kp(), ctx=C)
    # Beitreten
    P.vergleich('beitreten ohne consent', 'POST', kp('/beitreten'), body=lambda c: {'joinToken': c['jt']}, ctx=C)
    P.vergleich('beitreten falsches token', 'POST', kp('/beitreten'), body={'consent': KC, 'joinToken': tok()[:43]}, ctx=C)
    for wer in ('A', 'B', 'X'):
        t = []
        P.vergleich(f'beitreten {wer}', 'POST', kp('/beitreten'), body=lambda c: {'consent': KC, 'joinToken': c['jt']}, ctx=C, erwartet=200, sortiere=merke(t))
        C['flask'][wer], C['php'][wer] = t
        time.sleep(1.05)  # unterschiedliche Erstellungszeit → feste Reihenfolge der Teilnehmenden
    # Etiketten
    for i, n in enumerate([0, 106, 'drei', 3.0, None]):
        P.vergleich(f'etiketten ungültig #{i}', 'POST', kp('/etiketten'), body={'anzahl': n}, kopf=S('L'), ctx=C)
    P.vergleich('etiketten als teilnahme', 'POST', kp('/etiketten'), body={'anzahl': 2}, kopf=S('A'), ctx=C)
    et = []
    P.vergleich('etiketten 3', 'POST', kp('/etiketten'), body={'anzahl': 3}, kopf=S('L'), ctx=C, erwartet=200, sortiere=lambda j: et.append(j))
    P.vergleich('etiketten true', 'POST', kp('/etiketten'), body={'anzahl': True}, kopf=S('L'), ctx=C, erwartet=200)
    if not all(et):
        return
    for seite, j in zip(C, et):
        C[seite]['p1'], C[seite]['p2'], C[seite]['p3'] = [p['id'] for p in j['proben']]
    # Meta
    meta = {'analyse': {'datum': '2026-06-15', 'hinweise': {'foto': True, 'labor': False}, 'beitragen': True}, 'privat': {'titel': 'Kurs «Heu» 2026'}}
    for i, body in enumerate([
        {'analyse': {'fremd': 1}}, {'analyse': {'beitragen': 1}}, {'analyse': {'datum': '15.6.2026'}}, {'analyse': {'hinweise': {'foto': 1}}},
        {'analyse': {'hinweise': {'unbekannt': True}}}, {'analyse': {'hinweise': []}}, {'analyse': [1]}, {'privat': {'böse': 1}},
    ]):
        P.vergleich(f'meta ungültig #{i}', 'PUT', kp('/meta'), body=body, kopf=S('L'), ctx=C)
    P.vergleich('meta als teilnahme', 'PUT', kp('/meta'), body=meta, kopf=S('A'), ctx=C)
    P.vergleich('meta ok', 'PUT', kp('/meta'), body=meta, kopf=S('L'), ctx=C, erwartet=200)
    # Ersterfassung
    pr = lambda n, rest='': (lambda c: f"api/kurse/{c['kid']}/proben/{c[n]}{rest}")
    P.vergleich('status leer', 'GET', pr('p1', '/status'), kopf=S('A'), ctx=C, erwartet=200)
    P.vergleich('status unbekannt', 'GET', kp('/proben/gibtsnicht/status'), kopf=S('A'), ctx=C)
    erf = {'analyse': {'typ': 'heu'}, 'privat': {'bezeichnung': 'Wiese Ost', 'standort': {'plz': '3052'}}, 'labor': {'nel': 5.5, 'rp': 140}}
    for i, body in enumerate([{'analyse': {'typ': 'kuh'}}, {'analyse': {'typ': 'heu', 'x': 1}}, {'analyse': 'heu'}, {'analyse': {'typ': 'heu'}, 'labor': [1]},
                              {'analyse': {'typ': 'heu'}, 'privat': {'t': 'x' * 5001}}]):
        P.vergleich(f'erfassen ungültig #{i}', 'PUT', pr('p1'), body=body, kopf=S('A'), ctx=C)
    P.vergleich('erfassen pool unbekannt', 'PUT', pr('p1'), body=dict(erf, poolId='gibtsnicht1'), kopf=S('A'), ctx=C)
    P.vergleich('erfassen ohne sitzung', 'PUT', pr('p1'), body=erf, ctx=C)
    P.vergleich('erfassen A', 'PUT', pr('p1'), body=erf, kopf=S('A'), ctx=C, erwartet=200)
    P.vergleich('erfassen B fremde probe', 'PUT', pr('p1'), body=erf, kopf=S('B'), ctx=C, erwartet=409)
    P.vergleich('erfassen A ändert', 'PUT', pr('p1'), body=dict(erf, privat={'bezeichnung': 'Wiese West'}), kopf=S('A'), ctx=C, erwartet=200)
    P.vergleich('erfassen teilnahme ohne etikett', 'PUT', kp('/proben/eigeneprobe1'), body=erf, kopf=S('A'), ctx=C, erwartet=404)
    P.vergleich('erfassen leitung ohne etikett', 'PUT', kp('/proben/leitungprobe1'), body={'analyse': {'typ': 'gras'}}, kopf=S('L'), ctx=C, erwartet=200)
    P.vergleich('erfassen B zweites etikett', 'PUT', pr('p2'), body={'analyse': {'typ': 'mais'}, 'privat': None, 'labor': {}}, kopf=S('B'), ctx=C, erwartet=200)
    P.vergleich('status erfasst', 'GET', pr('p1', '/status'), kopf=S('B'), ctx=C, erwartet=200)
    # Namen
    for i, body in enumerate([{'name': {'name': ''}}, {'name': {'name': '  　 '}}, {'name': {'name': 'x' * 81}}, {'name': {'name': 'a', 'x': 1}},
                              {'name': 'Anna'}, {'name': {'name': 5}}, {'name': {'name': 'a\u0001'}}]):
        P.vergleich(f'name ungültig #{i}', 'PUT', kp('/ich'), body=body, kopf=S('A'), ctx=C)
    for wer, name in (('A', 'Anna «A» ä'), ('B', ' Beat '), ('X', 'Xaver')):
        P.vergleich(f'name {wer}', 'PUT', kp('/ich'), body={'name': {'name': name}}, kopf=S(wer), ctx=C, erwartet=200)
    for wer in ('L', 'A', 'B'):
        P.vergleich(f'lesen {wer}', 'GET', kp(), kopf=S(wer), ctx=C, erwartet=200, sortiere=tn_sort)
    # Beurteilungen
    bu = lambda n: pr(n, '/beurteilung')
    vg = lambda n: pr(n, '/beurteilungen')
    P.vergleich('abgeben zu gross', 'PUT', bu('p1'), roh=b'{"data":"' + b'x' * 70000 + b'"}', kopf=S('A'), ctx=C)
    P.vergleich('abgeben kein json', 'PUT', bu('p1'), roh=b'{kaputt', kopf=S('A'), ctx=C)
    P.vergleich('abgeben liste', 'PUT', bu('p1'), roh=b'[1]', kopf=S('A'), ctx=C)
    for i, body in enumerate([{'data': None}, {'data': {'analyse': {'id': 'k', 'typ': 'heu'}}}, beurteilung('beurtA001', antworten={'k': [1]}),
                              beurteilung('beurtA001', fremd=1), {'data': {'analyse': {'id': 'beurtA001', 'typ': 'heu'}, 'x': 1}}]):
        P.vergleich(f'abgeben ungültig #{i}', 'PUT', bu('p1'), body=body, kopf=S('A'), ctx=C)
    P.vergleich('abgeben falscher typ', 'PUT', bu('p1'), body=beurteilung('beurtA001', typ='gras'), kopf=S('A'), ctx=C, erwartet=422)
    P.vergleich('abgeben leeres etikett', 'PUT', bu('p3'), body=beurteilung('beurtA001'), kopf=S('A'), ctx=C, erwartet=404)
    P.vergleich('vergleich vor abgabe', 'GET', vg('p1'), kopf=S('B'), ctx=C, erwartet=403)
    P.vergleich('abgeben A', 'PUT', bu('p1'), body=beurteilung('beurtA001'), kopf=S('A'), ctx=C, erwartet=200)
    P.vergleich('abgeben A zweimal', 'PUT', bu('p1'), body=beurteilung('beurtA001'), kopf=S('A'), ctx=C, erwartet=409)
    P.vergleich('abgeben B', 'PUT', bu('p1'), body=beurteilung('beurtB001', rad={'geruch': 'g3'}), kopf=S('B'), ctx=C, erwartet=200)
    bsrt = lambda j: isinstance(j, dict) and isinstance(j.get('beurteilungen'), list) and j['beurteilungen'].sort(key=lambda b: b['analyse']['id'])
    P.vergleich('vergleich B', 'GET', vg('p1'), kopf=S('B'), ctx=C, erwartet=200, sortiere=bsrt)
    P.vergleich('vergleich leitung', 'GET', vg('p1'), kopf=S('L'), ctx=C, erwartet=200, sortiere=bsrt)
    P.vergleich('typ nach abgaben fest', 'PUT', pr('p1'), body=dict(erf, analyse={'typ': 'gras'}), kopf=S('A'), ctx=C, erwartet=409)
    # Fotos
    fo = lambda fid, q='': (lambda c: f"api/kurse/{c['kid']}/fotos/{fid}?probe={c['p1']}{q}")
    P.vergleich('foto falsche art', 'PUT', fo('kursfoto00000001', '&art=bild'), roh=JPG, kopf=S('A'), ctx=C)
    P.vergleich('foto falsche id', 'PUT', fo('kurz', '&art=futter'), roh=JPG, kopf=S('A'), ctx=C)
    P.vergleich('foto zu klein', 'PUT', fo('kursfoto00000001', '&art=futter'), roh=JPG[:60], kopf=S('A'), ctx=C)
    P.vergleich('foto kein bild', 'PUT', fo('kursfoto00000001', '&art=futter'), roh=b'%PDF' + b'x' * 300, kopf=S('A'), ctx=C)
    P.vergleich('foto B zur fremden probe', 'PUT', fo('kursfoto00000009', '&art=futter'), roh=JPG, kopf=S('B'), ctx=C, erwartet=404)
    P.vergleich('foto A futter', 'PUT', fo('kursfoto00000001', '&art=futter'), roh=JPG, kopf=S('A'), ctx=C, erwartet=200)
    P.vergleich('foto A labor', 'PUT', fo('kursfoto00000002', '&art=labor'), roh=WEBP, kopf=S('A'), ctx=C, erwartet=200)
    P.vergleich('foto B zur beurteilung', 'PUT', fo('kursfoto00000003', '&art=futter&zu=beurteilung'), roh=JPG, kopf=S('B'), ctx=C, erwartet=200)
    P.vergleich('foto B überschreibt fremdes', 'PUT', fo('kursfoto00000001', '&art=futter'), roh=JPG, kopf=S('L'), ctx=C, erwartet=404)
    fg = lambda fid: (lambda c: f"api/kurse/{c['kid']}/fotos/{fid}")
    bild_vergleich(P, 'foto futter für X (Hilfestellung)', fg('kursfoto00000001'), S('X'), C, JPG)
    bild_vergleich(P, 'foto labor für B (nach Abgabe)', fg('kursfoto00000002'), S('B'), C, WEBP)
    bild_vergleich(P, 'foto labor für leitung', fg('kursfoto00000002'), S('L'), C, WEBP)
    P.vergleich('foto labor für X (ohne Abgabe)', 'GET', fg('kursfoto00000002'), kopf=S('X'), ctx=C, erwartet=403)
    P.vergleich('foto beurteilung für X', 'GET', fg('kursfoto00000003'), kopf=S('X'), ctx=C, erwartet=403)
    P.vergleich('foto unbekannt', 'GET', fg('kursfoto00000008'), kopf=S('A'), ctx=C, erwartet=404)
    P.vergleich('foto falsche id lesen', 'GET', fg('kurz'), kopf=S('A'), ctx=C, erwartet=400)
    P.vergleich('foto löschen fremd', 'DELETE', fg('kursfoto00000001'), kopf=S('B'), ctx=C, erwartet=404)
    P.vergleich('foto löschen', 'DELETE', fg('kursfoto00000003'), kopf=S('B'), ctx=C, erwartet=200)
    P.vergleich('lesen A mit fotos', 'GET', kp(), kopf=S('A'), ctx=C, erwartet=200, sortiere=tn_sort)
    # E-Mail verknüpfen und auf neuem Gerät anmelden
    ea = 'anna@example.org'
    P.vergleich('email code ungültig', 'POST', kp('/email/code'), body={'email': 'x'}, kopf=S('A'), ctx=C)
    P.vergleich('email code ohne alles', 'POST', kp('/email/code'), body={'email': ea}, ctx=C, erwartet=404)
    P.vergleich('email code A', 'POST', kp('/email/code'), body={'email': ea}, kopf=S('A'), ctx=C, erwartet=200)
    time.sleep(0.3)
    for seite in C:
        C[seite]['ca'] = letzter_code(seite, ea)
    P.vergleich('email verify falsch', 'POST', kp('/email/verify'), body=lambda c: {'email': ea, 'code': '000000' if c['ca'] != '000000' else '111111'}, kopf=S('A'), ctx=C)
    P.vergleich('email verify A', 'POST', kp('/email/verify'), body=lambda c: {'email': ea, 'code': c['ca']}, kopf=S('A'), ctx=C, erwartet=200)
    P.vergleich('email code B dieselbe', 'POST', kp('/email/code'), body={'email': ea}, kopf=S('B'), ctx=C, erwartet=200)
    time.sleep(0.3)
    for seite in C:
        C[seite]['cb'] = letzter_code(seite, ea)
    P.vergleich('email verify B vergeben', 'POST', kp('/email/verify'), body=lambda c: {'email': ea, 'code': c['cb']}, kopf=S('B'), ctx=C, erwartet=409)
    P.vergleich('email code neues gerät', 'POST', kp('/email/code'), body=lambda c: {'email': ea, 'joinToken': c['jt']}, ctx=C, erwartet=200)
    time.sleep(0.3)
    for seite in C:
        C[seite]['cn'] = letzter_code(seite, ea)
    t = []
    P.vergleich('email verify neues gerät', 'POST', kp('/email/verify'), body=lambda c: {'email': ea, 'code': c['cn'], 'joinToken': c['jt']}, ctx=C, erwartet=200, sortiere=merke(t))
    C['flask']['A2'], C['php']['A2'] = t
    en = 'niemand@example.org'
    P.vergleich('email code unbekannt', 'POST', kp('/email/code'), body=lambda c: {'email': en, 'joinToken': c['jt']}, ctx=C, erwartet=200)
    time.sleep(0.3)
    for seite in C:
        C[seite]['cu'] = letzter_code(seite, en)
    P.vergleich('email verify unbekannt', 'POST', kp('/email/verify'), body=lambda c: {'email': en, 'code': c['cu'], 'joinToken': c['jt']}, ctx=C, erwartet=404)
    P.vergleich('lesen A2 (zweites gerät)', 'GET', kp(), kopf=S('A2'), ctx=C, erwartet=200, sortiere=tn_sort)
    P.vergleich('lesen B nach verknüpfen', 'GET', kp(), kopf=S('B'), ctx=C, erwartet=200, sortiere=tn_sort)
    # Link-Geheimnis, Zustimmung
    P.vergleich('link falsch', 'PUT', kp('/link'), body={'secret': b64u(secrets.token_bytes(32))}, kopf=S('B'), ctx=C, erwartet=422)
    P.vergleich('link kein text', 'PUT', kp('/link'), body={'secret': 5}, kopf=S('B'), ctx=C, erwartet=422)
    P.vergleich('link ok', 'PUT', kp('/link'), body=lambda c: {'secret': c['ksecret']}, kopf=S('B'), ctx=C, erwartet=200)
    P.vergleich('zustimmung ohne', 'PUT', kp('/zustimmung'), body={}, kopf=S('B'), ctx=C, erwartet=400)
    P.vergleich('zustimmung', 'PUT', kp('/zustimmung'), body={'consent': KC}, kopf=S('B'), ctx=C, erwartet=200)
    # Meine Kurse
    P.vergleich('meine code ungültig', 'POST', 'api/meine-kurse/code', body={'email': 'x'})
    P.vergleich('meine code unbekannt', 'POST', 'api/meine-kurse/code', body={'email': 'fremd@example.org'}, erwartet=200)
    P.vergleich('meine code', 'POST', 'api/meine-kurse/code', body={'email': ea}, erwartet=200)
    time.sleep(0.3)
    for seite in C:
        C[seite]['cm'] = letzter_code(seite, ea)
    P.vergleich('meine falscher code', 'POST', 'api/meine-kurse', body=lambda c: {'email': ea, 'code': '000000' if c['cm'] != '000000' else '111111'}, ctx=C, erwartet=400)
    P.vergleich('meine kurse', 'POST', 'api/meine-kurse', body=lambda c: {'email': ea, 'code': c['cm']}, ctx=C, erwartet=200)
    # Fremde Personen
    P.vergleich('fremd: falsche sitzung', 'GET', kp(), kopf={'X-Kurs-Session': tok()[:43]}, ctx=C, erwartet=404)
    P.vergleich('fremd: sitzung anderer kurs-id', 'GET', 'api/kurse/fremderkurs1', kopf=S('A'), ctx=C, erwartet=404)
    P.vergleich('fremd: teilnahme löscht kurs', 'DELETE', kp(), kopf=S('A'), ctx=C, erwartet=404)
    P.vergleich('fremd: teilnahme löscht probe', 'DELETE', pr('p1'), kopf=S('A'), ctx=C, erwartet=404)
    P.vergleich('fremd: A entfernt B', 'DELETE', lambda c: f"api/kurse/{c['kid']}/teilnehmende/unbekannt1", kopf=S('A'), ctx=C, erwartet=404)
    # Entfernen, Austreten, Löschen
    ids = []
    P.vergleich('lesen leitung vor entfernen', 'GET', kp(), kopf=S('L'), ctx=C, erwartet=200, sortiere=lambda j: (ids.append(j), tn_sort(j)))
    if all(ids):
        for seite, j in zip(C, ids):
            namen = {(t['name'] or {}).get('name'): t['id'] for t in j['teilnehmende']}
            C[seite]['idX'], C[seite]['idB'], C[seite]['idL'] = namen['Xaver'], namen[' Beat '], namen[None]
        tp = lambda n: (lambda c: f"api/kurse/{c['kid']}/teilnehmende/{c[n]}")
        P.vergleich('leitung entfernt sich', 'DELETE', tp('idL'), kopf=S('L'), ctx=C, erwartet=409)
        P.vergleich('leitung entfernt X', 'DELETE', tp('idX'), kopf=S('L'), ctx=C, erwartet=200)
        P.vergleich('B tritt aus', 'DELETE', tp('idB'), kopf=S('B'), ctx=C, erwartet=200)
        P.vergleich('B nach austritt', 'GET', kp(), kopf=S('B'), ctx=C, erwartet=404)
    P.vergleich('probe löschen', 'DELETE', kp('/proben/leitungprobe1'), kopf=S('L'), ctx=C, erwartet=200)
    P.vergleich('lesen leitung danach', 'GET', kp(), kopf=S('L'), ctx=C, erwartet=200, sortiere=tn_sort)
    P.vergleich('vergleich nach austritt', 'GET', vg('p1'), kopf=S('A'), ctx=C, erwartet=200, sortiere=bsrt)
    P.vergleich('logout A', 'POST', kp('/logout'), kopf=S('A'), ctx=C, erwartet=200)
    P.vergleich('lesen nach logout', 'GET', kp(), kopf=S('A'), ctx=C, erwartet=404)
    P.vergleich('kurs löschen', 'DELETE', kp(), kopf=S('L'), ctx=C, erwartet=200)
    P.vergleich('lesen nach löschen', 'GET', kp(), kopf=S('A2'), ctx=C, erwartet=404)


AP = {'X-Admin-Pass': ADMIN}


def uebersicht_sort(j):
    if isinstance(j, dict):
        for k, schl in (('kursleitende', 'email'), ('einladungen', 'notiz')):
            if isinstance(j.get(k), list):
                j[k].sort(key=lambda r: str(r.get(schl)))
        for e in j.get('einladungen') or []:
            if re.match(r'^[A-HJ-NP-Z2-9]{3}$', str(e.get('hinweis'))):
                e['hinweis'] = '<hinweis>'  # letzte Zeichen des Zufallscodes


def fall_admin(P):
    print('Kursleitung und Administration')
    ea, ef = 'antrag@andere.example.org', 'frei@schule.example.org'
    P.vergleich('status ungültig', 'POST', 'api/kursleitung/status', body={'email': 'x'})
    P.vergleich('status domain', 'POST', 'api/kursleitung/status', body={'email': 'Jemand@Schule.example.org'}, erwartet=200)
    P.vergleich('status andere', 'POST', 'api/kursleitung/status', body={'email': ea}, erwartet=200)
    P.vergleich('antrag code ungültig', 'POST', 'api/kursleitung/antrag/code', body={'email': 'x'})
    for em in (ea, ef):
        P.vergleich('antrag code ' + em, 'POST', 'api/kursleitung/antrag/code', body={'email': em}, erwartet=200)
    time.sleep(0.3)
    C = {s: {'ca': letzter_code(s, ea), 'cf': letzter_code(s, ef)} for s in ('flask', 'php')}
    antrag = lambda c, **x: dict({'email': ea, 'consent': {'accepted': True}, 'name': '  Erika Muster ', 'org': 'Schule «Wald»', 'text': 'Kurs im Juni', 'code': c['ca']}, **x)
    P.vergleich('antrag ohne consent', 'POST', 'api/kursleitung/antrag', body=lambda c: antrag(c, consent={}), ctx=C)
    P.vergleich('antrag ohne name', 'POST', 'api/kursleitung/antrag', body=lambda c: antrag(c, name='   '), ctx=C)
    P.vergleich('antrag falscher code', 'POST', 'api/kursleitung/antrag', body=lambda c: antrag(c, code='000000' if c['ca'] != '000000' else '111111'), ctx=C)
    P.vergleich('antrag', 'POST', 'api/kursleitung/antrag', body=antrag, ctx=C, erwartet=200)
    P.vergleich('antrag freie domain', 'POST', 'api/kursleitung/antrag', body=lambda c: antrag(c, email=ef, code=c['cf'], org=None, text=5), ctx=C, erwartet=200)
    P.vergleich('übersicht ohne', 'GET', 'api/admin/uebersicht')
    P.vergleich('übersicht', 'GET', 'api/admin/uebersicht', kopf=AP, erwartet=200, sortiere=uebersicht_sort)
    # Entscheid
    eh = hmac.new(base64.urlsafe_b64decode('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='), b'email|' + ea.encode(), hashlib.sha256).hexdigest()
    P.vergleich('entscheid ohne', 'POST', 'api/admin/kursleitung/' + eh, body={'status': 'frei'})
    P.vergleich('entscheid schlecht', 'POST', 'api/admin/kursleitung/' + eh, body={'status': 'vielleicht'}, kopf=AP)
    P.vergleich('entscheid unbekannt', 'POST', 'api/admin/kursleitung/' + '0' * 64, body={'status': 'frei'}, kopf=AP)
    P.vergleich('entscheid abgelehnt', 'POST', 'api/admin/kursleitung/' + eh, body={'status': 'abgelehnt'}, kopf=AP, erwartet=200)
    P.vergleich('status abgelehnt', 'POST', 'api/kursleitung/status', body={'email': ea}, erwartet=200)
    P.vergleich('entscheid frei', 'POST', 'api/admin/kursleitung/' + eh, body={'status': 'frei'}, kopf=AP, erwartet=200)
    P.vergleich('status frei', 'POST', 'api/kursleitung/status', body={'email': ea}, erwartet=200)
    time.sleep(0.3)
    for s in C:
        m = letzte_mail(s, ea)
        if m.get('betreff') != 'Freigeschaltet: Kurse anlegen':
            P.fehler.append((f'Mail Freischaltung {s}', [str(m)]))
    P.vergleich('entscheid löschen', 'POST', 'api/admin/kursleitung/' + eh, body={'status': 'loeschen'}, kopf=AP, erwartet=200)
    P.vergleich('status gelöscht', 'POST', 'api/kursleitung/status', body={'email': ea}, erwartet=200)
    # Einladungen
    codes = []

    def code_merken(j):
        codes.append(j.get('code') if isinstance(j, dict) else None)
        if codes[-1] and re.match(r'^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$', codes[-1]):
            j['code'] = '<code>'
    P.vergleich('einladung ohne', 'POST', 'api/admin/einladungen', body={})
    P.vergleich('einladung', 'POST', 'api/admin/einladungen', body={'max': 2.9, 'tage': '10', 'notiz': 'Kurs Plantahof'}, kopf=AP, erwartet=200, sortiere=code_merken)
    P.vergleich('einladung grenzen', 'POST', 'api/admin/einladungen', body={'max': 9999, 'tage': -5, 'notiz': 'x' * 300}, kopf=AP, erwartet=200, sortiere=code_merken)
    P.vergleich('einladung standard', 'POST', 'api/admin/einladungen', body={}, kopf=AP, erwartet=200, sortiere=code_merken)
    if not all(codes):
        return
    C['flask']['einl'], C['php']['einl'] = codes[0], codes[1]
    C['flask']['einl2'], C['php']['einl2'] = codes[4], codes[5]
    eg = 'gast@andere.example.org'
    P.vergleich('kurs mit falscher einladung', 'POST', 'api/kurse', body={'consent': KC, 'email': eg, 'joinHash': hashlib.sha256(b'y').hexdigest(), 'einladung': 'FALS-CHCO-DE99'})
    K = {'flask': kurs_schluessel(), 'php': kurs_schluessel()}
    for s in K:
        K[s]['einl'] = C[s]['einl']
    ids = []
    P.vergleich('kurs mit einladung', 'POST', 'api/kurse', body=lambda c: {'consent': KC, 'email': eg, 'joinHash': c['jh'], 'einladung': c['einl'].lower().replace('-', ' ')},
                ctx=K, erwartet=201, sortiere=merke(ids, 'id'))
    if all(ids):
        K['flask']['kid'], K['php']['kid'] = ids
        time.sleep(0.3)
        for s in K:
            K[s]['code'] = letzter_code(s, eg)
        t = []
        P.vergleich('kurs mit einladung aktivieren', 'POST', kp('/aktivieren'), body=lambda c: {'email': eg, 'code': c['code']}, ctx=K, erwartet=200, sortiere=merke(t))
        K['flask']['L'], K['php']['L'] = t
        P.vergleich('gast jetzt frei', 'POST', 'api/kursleitung/status', body={'email': eg}, erwartet=200)
        P.vergleich('fremd: gast-sitzung in anderem kurs', 'GET', 'api/kurse/anderer0kurs', kopf=S('L'), ctx=K, erwartet=404)
        P.vergleich('gast-kurs löschen', 'DELETE', kp(), kopf=S('L'), ctx=K, erwartet=200)
    liste = []
    P.vergleich('übersicht mit einladungen', 'GET', 'api/admin/uebersicht', kopf=AP, erwartet=200, sortiere=lambda j: (liste.append(j), uebersicht_sort(j)))
    if all(liste):
        for s, j in zip(C, liste):
            C[s]['eid'] = [e['id'] for e in j['einladungen'] if e['notiz'] == ''][0]
        P.vergleich('einladung sperren ohne', 'DELETE', lambda c: 'api/admin/einladungen/' + c['eid'], ctx=C)
        P.vergleich('einladung sperren', 'DELETE', lambda c: 'api/admin/einladungen/' + c['eid'], kopf=AP, ctx=C, erwartet=200)
        P.vergleich('kurs mit gesperrter einladung', 'POST', 'api/kurse', body=lambda c: {'consent': KC, 'email': 'zwei@andere.example.org', 'joinHash': hashlib.sha256(b'z').hexdigest(),
                                                                                       'einladung': c['einl2']}, ctx=C, erwartet=403)
        P.vergleich('übersicht gesperrt', 'GET', 'api/admin/uebersicht', kopf=AP, erwartet=200, sortiere=uebersicht_sort)


def pool_daten(**x):
    d = {'typ': 'heu', 'titel': '  Heu «Muster» ', 'beschreibung': 'Erster Schnitt', 'quelle': 'Kurs Plantahof', 'schnittNr': ' 1 ', 'bestand': 'AR',
         'sammlung': ' Ernte 2026 ', 'oeffentlich': True, 'schnitt': '2026-06-01', 'region': {'plz': 3052, 'ort': 'Zollikofen', 'hoehe': ''},
         'labor': {'nel': 5.6, 'rp': 140, 'ts': 88.5},
         'fotos': [{'id': 'poolfoto00000001', 'art': 'futter', 'mime': 'image/jpeg', 'w': 800, 'h': 0, 'ger': 'auto', 'fremd': 1, 'key': None}],
         'referenzen': [{'label': ' Referenz A ', 'analyse': {'id': 'refA0001', 'typ': 'heu', 'antworten': {'bestand': 'AR'}, 'rad': {'geruch': 'g1'}}}]}
    d.update(x)
    return {k: v for k, v in d.items() if v is not None}


def fall_pool(P):
    print('Probenpool')
    C = kurs_neu(P, 'pool1@schule.example.org', 'pool-kurs 1')
    D = kurs_neu(P, 'pool2@schule.example.org', 'pool-kurs 2', secret=False)
    if not (C and D):
        return
    for s in C:
        C[s]['L2'], C[s]['kid2'] = D[s]['L'], D[s]['kid']
    et = []
    P.vergleich('pool: etikett', 'POST', kp('/etiketten'), body={'anzahl': 1}, kopf=S('L'), ctx=C, erwartet=200, sortiere=lambda j: et.append(j))
    for s, j in zip(C, et):
        C[s]['p1'] = j['proben'][0]['id']
    H1 = lambda c: {'X-Kurs-Id': c['kid'], 'X-Kurs-Session': c['L']}
    H2 = lambda c: {'X-Kurs-Id': c['kid2'], 'X-Kurs-Session': c['L2']}
    P.vergleich('pool ohne sitzung', 'GET', 'api/pool')
    P.vergleich('pool falsche sitzung', 'GET', 'api/pool', kopf=lambda c: {'X-Kurs-Id': c['kid'], 'X-Kurs-Session': tok()[:43]}, ctx=C)
    P.vergleich('pool sitzung falscher kurs', 'GET', 'api/pool', kopf=lambda c: {'X-Kurs-Id': c['kid2'], 'X-Kurs-Session': c['L']}, ctx=C)
    P.vergleich('pool leer', 'GET', 'api/pool', kopf=H1, ctx=C, erwartet=200)
    schlecht = [pool_daten(typ='kuh'), pool_daten(titel='x' * 121), pool_daten(region={'plz': '0123'}), pool_daten(region={'kanton': 'BE'}),
                pool_daten(region={'hoehe': 550}), pool_daten(labor={'nel': 2001}), pool_daten(labor={'nel': True}), pool_daten(labor={'fremd': 1}),
                pool_daten(fotos=[{'id': 'kurz', 'art': 'futter', 'mime': 'image/jpeg'}]), pool_daten(fotos=[{'id': 'poolfoto00000001', 'art': 'futter', 'mime': 'image/png'}]),
                pool_daten(fotos=[{'id': f'poolfoto0000000{i}', 'art': 'futter', 'mime': 'image/jpeg'} for i in range(9)]),
                pool_daten(referenzen=[{'label': 'x', 'analyse': {'id': 'refA0001', 'typ': 'kuh'}}]), pool_daten(referenzen=[{'label': 'x'}]),
                pool_daten(sammlung='Ernte <2026>'), pool_daten(oeffentlich=1), pool_daten(schnitt='Juni'), pool_daten(bestand='x' * 81), 'text', None]
    for i, d in enumerate(schlecht):
        P.vergleich(f'pool speichern ungültig #{i}', 'PUT', 'api/pool/poolEintrag01', body={'daten': d}, kopf=H1, ctx=C)
    P.vergleich('pool quelle ungültig', 'PUT', 'api/pool/poolEintrag01', body={'daten': pool_daten(), 'quelleKurs': 'x'}, kopf=H1, ctx=C)
    P.vergleich('pool falsche id', 'PUT', 'api/pool/kurz', body={'daten': pool_daten()}, kopf=H1, ctx=C)
    P.vergleich('pool speichern', 'PUT', 'api/pool/poolEintrag01', body=lambda c: {'daten': pool_daten(), 'quelleKurs': c['kid'], 'quelleProbe': c['p1']}, kopf=H1, ctx=C, erwartet=200)
    P.vergleich('pool fremd überschreiben', 'PUT', 'api/pool/poolEintrag01', body={'daten': pool_daten()}, kopf=H2, ctx=C, erwartet=404)
    P.vergleich('pool zweiter eintrag', 'PUT', 'api/pool/poolEintrag02', body={'daten': pool_daten(typ='gras', titel=None, oeffentlich=False, sammlung=None, fotos=[], referenzen=[],
                                                                                                    region={'ort': ''})}, kopf=H2, ctx=C, erwartet=200)
    psrt = lambda j: isinstance(j, dict) and isinstance(j.get('eintraege'), list) and j['eintraege'].sort(key=lambda e: e['id'])
    P.vergleich('pool liste 1', 'GET', 'api/pool', kopf=H1, ctx=C, erwartet=200, sortiere=psrt)
    P.vergleich('pool liste 2', 'GET', 'api/pool', kopf=H2, ctx=C, erwartet=200, sortiere=psrt)
    # Fotos
    P.vergleich('pool foto nicht im eintrag', 'PUT', 'api/pool/poolEintrag01/fotos/poolfoto00000009', roh=JPG, kopf=H1, ctx=C, erwartet=404)
    P.vergleich('pool foto fremd', 'PUT', 'api/pool/poolEintrag01/fotos/poolfoto00000001', roh=JPG, kopf=H2, ctx=C, erwartet=404)
    P.vergleich('pool foto kein bild', 'PUT', 'api/pool/poolEintrag01/fotos/poolfoto00000001', roh=b'x' * 300, kopf=H1, ctx=C, erwartet=422)
    P.vergleich('pool foto', 'PUT', 'api/pool/poolEintrag01/fotos/poolfoto00000001', roh=JPG, kopf=H1, ctx=C, erwartet=200)
    bild_vergleich(P, 'pool foto lesen', lambda c: 'api/pool/poolEintrag01/fotos/poolfoto00000001', H2, C, JPG)
    P.vergleich('pool foto unbekannt', 'GET', 'api/pool/poolEintrag01/fotos/poolfoto00000009', kopf=H2, ctx=C, erwartet=404)
    P.vergleich('pool foto ohne sitzung', 'GET', 'api/pool/poolEintrag01/fotos/poolfoto00000001', erwartet=404)
    # Öffentlich
    P.vergleich('öffentlich pool', 'GET', 'api/oeffentlich/pool', erwartet=200)
    P.vergleich('öffentlich foto', 'GET', 'api/oeffentlich/pool/poolEintrag01/fotos/poolfoto00000001', erwartet=404)
    P.vergleich('öffentlich kursprobe', 'GET', lambda c: f"api/oeffentlich/kursprobe/{c['kid']}/{c['p1']}", ctx=C, erwartet=200)
    P.vergleich('öffentlich kursprobe unbekannt', 'GET', 'api/oeffentlich/kursprobe/kurs00001/probe0001', erwartet=200)
    P.vergleich('öffentlich kursprobe schlecht', 'GET', 'api/oeffentlich/kursprobe/x/y', erwartet=404)
    # Übernahme in einen anderen Kurs
    D2 = {s: dict(kid=C[s]['kid2'], L=C[s]['L2'], kid1=C[s]['kid'], L1=C[s]['L']) for s in C}
    P.vergleich('übernehmen pool unbekannt', 'PUT', kp('/proben/musterprobe1'), body={'analyse': {'typ': 'heu'}, 'poolId': 'poolGibtsNicht'}, kopf=S('L'), ctx=D2, erwartet=404)
    P.vergleich('übernehmen', 'PUT', kp('/proben/musterprobe1'), body={'analyse': {'typ': 'heu'}, 'privat': {'bezeichnung': 'Muster'}, 'poolId': 'poolEintrag01'},
                kopf=S('L'), ctx=D2, erwartet=200)
    P.vergleich('kurs 2 lesen (übernommen)', 'GET', kp(), kopf=S('L'), ctx=D2, erwartet=200, sortiere=tn_sort)
    P.vergleich('kurs 1 lesen (quelle)', 'GET', kp(), kopf=S('L'), ctx=C, erwartet=200, sortiere=tn_sort)
    bild_vergleich(P, 'pool-foto über kurs 2', lambda c: f"api/kurse/{c['kid']}/fotos/poolfoto00000001", S('L'), D2, JPG)
    P.vergleich('vergleich mit referenzen', 'GET', kp('/proben/musterprobe1/beurteilungen'), kopf=S('L'), ctx=D2, erwartet=200)
    # Admin und Löschen
    P.vergleich('admin pool ohne', 'GET', 'api/admin/pool')
    P.vergleich('admin pool', 'GET', 'api/admin/pool', kopf=AP, erwartet=200, sortiere=psrt)
    P.vergleich('pool löschen fremd', 'DELETE', 'api/pool/poolEintrag01', kopf=H2, ctx=C, erwartet=404)
    P.vergleich('pool löschen', 'DELETE', 'api/pool/poolEintrag01', kopf=H1, ctx=C, erwartet=200)
    P.vergleich('admin pool löschen ohne', 'DELETE', 'api/admin/pool/poolEintrag02')
    P.vergleich('admin pool löschen', 'DELETE', 'api/admin/pool/poolEintrag02', kopf=AP, erwartet=200)
    P.vergleich('pool am schluss', 'GET', 'api/pool', kopf=H1, ctx=C, erwartet=200)
    P.vergleich('kurs 2 nach pool-löschen', 'GET', kp(), kopf=S('L'), ctx=D2, erwartet=200, sortiere=tn_sort)
    P.vergleich('übersicht am schluss', 'GET', 'api/admin/uebersicht', kopf=AP, erwartet=200, sortiere=uebersicht_sort)
    P.vergleich('pool-kurs 1 löschen', 'DELETE', kp(), kopf=S('L'), ctx=C, erwartet=200)
    P.vergleich('pool-kurs 2 löschen', 'DELETE', kp(), kopf=S('L'), ctx=D2, erwartet=200)


FAELLE = {'grundlagen': fall_grundlagen, 'rueckmeldung': fall_rueckmeldung, 'statistik': fall_statistik, 'anmeldung': fall_anmeldung, 'freigaben': fall_freigaben, 'konto': fall_konto, 'kurse': fall_kurse, 'admin': fall_admin, 'pool': fall_pool}

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
