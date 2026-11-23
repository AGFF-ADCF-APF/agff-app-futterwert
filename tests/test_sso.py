"""Prüfung der Admin-Anmeldung mit dem AGFF-Konto (v2_zentral). Lauf im Container:
docker run --rm --user 1000:1000 -v "$PWD":/app -w /app futter-futterrechner python tests/test_sso.py
Das Schlüsselpaar entsteht nur für den Test."""
import base64, json, os, sys, tempfile, time, secrets
sys.path.insert(0, os.getcwd())
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

tmp = tempfile.mkdtemp()
os.environ['V2_DB_PATH'] = os.path.join(tmp, 'v2.db')
os.environ['DATA_DIR'] = tmp
privat = Ed25519PrivateKey.generate()
roh = privat.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
os.environ['SSO_PUBLIC_KEY'] = base64.b64encode(roh).decode()
os.environ['SSO_URL'] = 'https://graswachstum.ch'

import app as flaskapp  # registriert den Blueprint
import v2_zentral as Z
A = flaskapp.app
A.testing = True

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def token(**aend):
    jetzt = int(time.time())
    d = {'iss': 'https://graswachstum.ch', 'aud': 'futter', 'sub': 'test', 'name': 'Test Person', 'roles': ['futter.admin'],
         'state': 'S' * 32, 'iat': jetzt, 'exp': jetzt + 60, 'jti': secrets.token_hex(16), 'amr': ['hwk'], 'stark_bis': jetzt + 3600}
    d.update(aend)
    d = {k: v for k, v in d.items() if v is not None}
    schluessel = aend.pop('_schluessel', None) or privat
    d.pop('_schluessel', None)
    k = b64(json.dumps({'alg': 'EdDSA', 'typ': 'JWT'}).encode()); r = b64(json.dumps(d).encode())
    return k + '.' + r + '.' + b64(schluessel.sign((k + '.' + r).encode()))

fehler = 0
def pruefe(name, ok):
    global fehler
    print(('OK     ' if ok else 'FEHLER ') + name); fehler += 0 if ok else 1

def zurueck(t, state='S' * 32, cookie='S' * 32, **q):
    c = A.test_client()
    if cookie: c.set_cookie(Z.STATE_COOKIE, cookie, domain='localhost')
    params = {'state': state, **q}
    if t is not None: params['token'] = t
    return c, c.get('/v2/anmelden/zurueck', query_string=params)

with A.test_request_context():
    pass

c = A.test_client()
r = c.get('/v2/anmelden')
loc = r.headers.get('Location', '')
pruefe('Start leitet zu /_konto/sso/extern mit client=futter und stark=1', r.status_code == 302 and loc.startswith('https://graswachstum.ch/_konto/sso/extern?') and 'client=futter' in loc and 'stark=1' in loc)
pruefe('Start setzt state-Cookie (HttpOnly, Lax)', any(Z.STATE_COOKIE in h and 'HttpOnly' in h and 'SameSite=Lax' in h for h in r.headers.getlist('Set-Cookie')))

c, r = zurueck(token())
pruefe('gültiges Token -> 303 zur Administration', r.status_code == 303 and r.headers['Location'].endswith('/v2/admin'))
ich = c.get('/v2/api/admin/ich').get_json()
pruefe('danach /api/admin/ich angemeldet mit Methode', ich['angemeldet'] is True and ich['name'] == 'Test Person' and ich['methode'] == 'Passkey' and ich['zentral'] is True)
pruefe('Abmelden beendet die Sitzung', c.post('/v2/abmelden').status_code == 200 and c.get('/v2/api/admin/ich').get_json()['angemeldet'] is False)

t = token(); zurueck(t); _, r = zurueck(t)
pruefe('dasselbe Token zweimal -> abgelehnt', r.status_code == 400 and 'schon verwendet' in r.get_data(as_text=True))
_, r = zurueck(token(_schluessel=Ed25519PrivateKey.generate()))
pruefe('fremde Signatur -> abgelehnt', r.status_code == 400 and 'signiert' in r.get_data(as_text=True))
t = token(); kopf, rumpf, sig = t.split('.'); d = json.loads(base64.urlsafe_b64decode(rumpf + '==')); d['roles'] = ['futter.admin', 'x']
_, r = zurueck(kopf + '.' + b64(json.dumps(d).encode()) + '.' + sig)
pruefe('veränderter Inhalt -> abgelehnt', r.status_code == 400)
jetzt = int(time.time())
_, r = zurueck(token(iat=jetzt - 400, exp=jetzt - 340))
pruefe('abgelaufen -> abgelehnt', r.status_code == 400 and 'abgelaufen' in r.get_data(as_text=True))
_, r = zurueck(token(aud='herbar'))
pruefe('falsches aud -> abgelehnt', r.status_code == 400)
_, r = zurueck(token(iss='https://boese.example'))
pruefe('falscher Aussteller -> abgelehnt', r.status_code == 400)
_, r = zurueck(token(state='T' * 32))
pruefe('state im Token passt nicht -> abgelehnt', r.status_code == 400)
_, r = zurueck(token(), cookie='U' * 32)
pruefe('state-Cookie fehlt/anders -> abgelehnt', r.status_code == 400)
_, r = zurueck(token(), cookie=None)
pruefe('ohne state-Cookie -> abgelehnt', r.status_code == 400)
c, r = zurueck(token(roles=['futter.teacher']))
pruefe('ohne futter.admin -> 403, keine Sitzung', r.status_code == 403 and c.get('/v2/api/admin/ich').get_json()['angemeldet'] is False)
_, r = zurueck(token(stark_bis=0, amr=['pwd']))
pruefe('ohne starke Anmeldung -> 403', r.status_code == 403 and 'starke' in r.get_data(as_text=True))
_, r = zurueck(None, error='access_denied')
pruefe('error=access_denied -> 403 mit Meldung', r.status_code == 403)
k = b64(json.dumps({'alg': 'none'}).encode()); r_ = b64(json.dumps({'aud': 'futter'}).encode())
_, r = zurueck(k + '.' + r_ + '.')
pruefe('alg none -> abgelehnt', r.status_code == 400)
os.environ['SSO_PUBLIC_KEY'] = ''
pruefe('ohne Schlüssel: Start 503, ich.zentral false', A.test_client().get('/v2/anmelden').status_code == 503 and A.test_client().get('/v2/api/admin/ich').get_json()['zentral'] is False)

print('Alle Prüfungen bestanden' if not fehler else f'{fehler} Prüfung(en) fehlgeschlagen')
sys.exit(1 if fehler else 0)
