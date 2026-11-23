"""Futter v2 – Admin-Anmeldung über das AGFF-Konto (SSO der Anmelde-Website graswachstum.ch, Plugin agff-familie).

Ablauf (Beschreibung des Anbieters: ~/git/lernherbar/docs/sso-agff.md, Code: grav-plugin-agff-familie/classes/SsoExtern.php):
  1. GET  /v2/anmelden           -> state im Cookie, Weiterleitung zu
     <SSO_URL>/_konto/sso/extern?client=futter&state=…&sprache=de&stark=1
  2. graswachstum.ch meldet an (Passkey, Passwort + Code, Microsoft 365; stark=1: zweiter Faktor bzw. Passkey) und
     leitet auf die beim Anbieter fest eingetragene Rückkehradresse um:
     https://apps.graswachstum.ch/futter/v2/anmelden/zurueck?token=…&state=…  (bzw. ?error=access_denied|cancelled&state=…)
  3. GET  /v2/anmelden/zurueck   -> Token prüfen: Signatur Ed25519 (öffentlicher Schlüssel SSO_PUBLIC_KEY), aud, iss,
     exp/iat, state, jti einmalig; Recht «futter.admin» und starke Anmeldung -> Admin-Sitzung (Cookie, 8 h)
  4. POST /v2/abmelden           -> Sitzung beenden

Umgebung: SSO_URL (Standard https://graswachstum.ch), SSO_PUBLIC_KEY (base64, 32 Byte; ohne Schlüssel ist die
Anmeldung aus), SSO_CLIENT (Standard futter), SSO_ISSUER (Standard = SSO_URL).
Das Admin-Passwort (ADMIN_PASSWORD) bleibt als Rückfallebene gültig.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from flask import jsonify, make_response, redirect, render_template_string, request

from v2_api import v2, _db

SITZUNG_COOKIE = 'agff_v2_admin'
STATE_COOKIE = 'agff_v2_anmeldung'
SITZUNG_DAUER = 8 * 3600
TOLERANZ = 30          # Sekunden Uhrabweichung
HOECHSTALTER = 300     # Token höchstens 5 Minuten nach Ausstellung annehmen
RECHT_ADMIN = 'admin'  # im Token als «<client>.admin»


def _zentral_url():
    return (os.environ.get('SSO_URL') or os.environ.get('ZENTRAL_URL') or 'https://graswachstum.ch').rstrip('/')


def _issuer():
    return (os.environ.get('SSO_ISSUER') or _zentral_url()).rstrip('/')


def _app_id():
    return os.environ.get('SSO_CLIENT') or 'futter'


def _oeffentlicher_schluessel():
    """Öffentlicher Ed25519-Schlüssel (32 Byte) oder None, wenn die Anmeldung nicht eingerichtet ist."""
    roh = (os.environ.get('SSO_PUBLIC_KEY') or '').strip()
    if not roh:
        return None
    try:
        b = base64.b64decode(roh, validate=True)
    except Exception:
        return None
    return b if len(b) == 32 else None


def eingerichtet():
    return _oeffentlicher_schluessel() is not None


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def _unb64(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def _tabellen(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS zentral_sitzungen (token_hash TEXT PRIMARY KEY, sub TEXT, name TEXT, methode TEXT, '
                 'created_at INTEGER, expires_at INTEGER)')
    conn.execute('CREATE TABLE IF NOT EXISTS zentral_ausweise (jti TEXT PRIMARY KEY, expires_at INTEGER)')


def _url(rest):
    """Öffentliche Adresse eines v2-Pfads (rest beginnt mit /): /futter/v2/… (Traefik schneidet /futter ab
    und meldet es in X-Forwarded-Prefix) bzw. /wiese/… (Traefik bildet /wiese/x auf /v2/x ab, Kopfzeile X-AGFF-Modus)."""
    proto = request.headers.get('X-Forwarded-Proto') or request.scheme
    host = request.headers.get('X-Forwarded-Host') or request.host
    if request.headers.get('X-AGFF-Modus') == 'wiese':
        return f"{proto}://{host}/wiese{rest}"
    return f"{proto}://{host}{request.headers.get('X-Forwarded-Prefix', '').rstrip('/')}/v2{rest}"


def _cookie_pfad():
    return '/'


def _sicher():
    return (request.headers.get('X-Forwarded-Proto') or request.scheme) == 'https'


def token_pruefen(token, state, jetzt=None):
    """Prüft das Token des Anbieters und gibt seine Angaben zurück oder wirft ValueError (Text für die Person)."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    schluessel = _oeffentlicher_schluessel()
    if schluessel is None:
        raise ValueError('Die Anmeldung mit dem AGFF-Konto ist nicht eingerichtet (SSO_PUBLIC_KEY fehlt).')
    try:
        kopf, rumpf, sig = token.split('.')
        k = json.loads(_unb64(kopf))
        d = json.loads(_unb64(rumpf))
        signatur = _unb64(sig)
    except Exception:
        raise ValueError('Anmeldung unlesbar. Bitte nochmals anmelden.')
    if not isinstance(k, dict) or not isinstance(d, dict) or k.get('alg') != 'EdDSA':
        raise ValueError('Anmeldung nicht gültig signiert.')
    try:
        Ed25519PublicKey.from_public_bytes(schluessel).verify(signatur, (kopf + '.' + rumpf).encode())
    except InvalidSignature:
        raise ValueError('Anmeldung nicht gültig signiert.')
    jetzt = int(time.time()) if jetzt is None else jetzt
    if d.get('aud') != _app_id() or str(d.get('iss', '')).rstrip('/') != _issuer():
        raise ValueError('Anmeldung für eine andere App oder von einem anderen Aussteller.')
    exp, iat = d.get('exp'), d.get('iat')
    if not isinstance(exp, int) or not isinstance(iat, int) or exp + TOLERANZ < jetzt or iat > jetzt + TOLERANZ or iat + HOECHSTALTER < jetzt:
        raise ValueError('Anmeldung abgelaufen. Bitte nochmals anmelden.')
    if not state or not hmac.compare_digest(str(d.get('state', '')), state):
        raise ValueError('Anmeldung gehört nicht zu diesem Browser. Bitte nochmals anmelden.')
    jti = str(d.get('jti', ''))
    if len(jti) < 16:
        raise ValueError('Anmeldung unvollständig. Bitte nochmals anmelden.')
    with _db() as conn:
        _tabellen(conn)
        conn.execute('DELETE FROM zentral_ausweise WHERE expires_at < ?', (jetzt - HOECHSTALTER,))
        if conn.execute('SELECT 1 FROM zentral_ausweise WHERE jti = ?', (jti,)).fetchone():
            raise ValueError('Anmeldung wurde schon verwendet. Bitte nochmals anmelden.')
        conn.execute('INSERT INTO zentral_ausweise (jti, expires_at) VALUES (?, ?)', (jti, exp))
    return d


def ist_admin(d, jetzt=None):
    """Recht «futter.admin» und starke Anmeldung (Passkey oder zweiter Faktor)."""
    jetzt = int(time.time()) if jetzt is None else jetzt
    rollen = d.get('roles') if isinstance(d.get('roles'), list) else []
    stark = isinstance(d.get('stark_bis'), int) and d['stark_bis'] > jetzt
    return (_app_id() + '.' + RECHT_ADMIN) in rollen, stark


def _methode(d):
    amr = d.get('amr') if isinstance(d.get('amr'), list) else []
    namen = {'hwk': 'Passkey', 'pwd': 'Passwort', 'otp': 'E-Mail-Code', 'fed': 'Microsoft 365', 'mfa': 'zweiter Faktor'}
    return ' + '.join(namen.get(a, str(a)) for a in amr)[:60] or None


def sitzung():
    """Gültige Admin-Sitzung aus dem Cookie (dict) oder None."""
    t = request.cookies.get(SITZUNG_COOKIE, '')
    if len(t) < 20:
        return None
    with _db() as conn:
        _tabellen(conn)
        r = conn.execute('SELECT sub, name, methode, expires_at FROM zentral_sitzungen WHERE token_hash = ?',
                         (hashlib.sha256(t.encode()).hexdigest(),)).fetchone()
    if not r or r['expires_at'] < int(time.time()):
        return None
    return {'sub': r['sub'], 'name': r['name'], 'methode': r['methode']}


SEITE = """<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Anmeldung – Futterbeurteilung v2</title><link rel="stylesheet" href="{{ css }}"></head>
<body><div class="doc"><h1>Anmeldung</h1><p class="alert warn">{{ text }}</p><p><a class="btn" href="{{ admin }}">Zur Administration</a></p></div></body></html>"""


@v2.route('/v2/anmelden')
def zentral_anmelden():
    from urllib.parse import urlencode
    if not eingerichtet():
        return _seite('Die Anmeldung mit dem AGFF-Konto ist auf diesem Server nicht eingerichtet. Bitte das Admin-Passwort verwenden.', 503)
    state = secrets.token_urlsafe(24)
    ziel = _zentral_url() + '/_konto/sso/extern?' + urlencode({'client': _app_id(), 'state': state, 'sprache': 'de', 'stark': 1})
    r = redirect(ziel)
    # Lax genügt: der Rückweg ist eine gewöhnliche Weiterleitung (GET) von graswachstum.ch
    r.set_cookie(STATE_COOKIE, state, max_age=900, httponly=True, secure=_sicher(), samesite='Lax', path=_cookie_pfad())
    return r


def _seite(text, status):
    return render_template_string(SEITE, admin=_url('/admin'), css=_url('/assets/app.css'), text=text), status


@v2.route('/v2/anmelden/zurueck')
def zentral_zurueck():
    state = request.cookies.get(STATE_COOKIE, '')
    fehler = request.args.get('error')
    if fehler:
        r = make_response(_seite('Anmeldung abgebrochen.' if fehler == 'cancelled' else
                                 'Ihr AGFF-Konto hat keinen Zugang. Bitte bei der Administration von graswachstum.ch melden.', 403))
        r.delete_cookie(STATE_COOKIE, path=_cookie_pfad())
        return r
    if not state or not hmac.compare_digest(request.args.get('state', ''), state):
        return _seite('Anmeldung gehört nicht zu diesem Browser oder ist abgelaufen. Bitte nochmals anmelden.', 400)
    try:
        d = token_pruefen(request.args.get('token', ''), state)
    except ValueError as e:
        return _seite(str(e), 400)
    admin, stark = ist_admin(d)
    if not admin:
        return _seite('Ihr AGFF-Konto hat keinen Zugang zur Administration von Futter v2 '
                      '(Recht «' + _app_id() + '.' + RECHT_ADMIN + '» auf graswachstum.ch).', 403)
    if not stark:
        return _seite('Für die Administration braucht es eine starke Anmeldung (Passkey oder zweiter Faktor). Bitte nochmals anmelden.', 403)
    token = secrets.token_urlsafe(32)
    jetzt = int(time.time())
    with _db() as conn:
        _tabellen(conn)
        conn.execute('DELETE FROM zentral_sitzungen WHERE expires_at < ?', (jetzt,))
        conn.execute('INSERT INTO zentral_sitzungen (token_hash, sub, name, methode, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
                     (hashlib.sha256(token.encode()).hexdigest(), str(d.get('sub', ''))[:120], str(d.get('name', ''))[:120],
                      _methode(d), jetzt, jetzt + SITZUNG_DAUER))
    r = make_response(redirect(_url('/admin')), 303)
    r.set_cookie(SITZUNG_COOKIE, token, max_age=SITZUNG_DAUER, httponly=True, secure=_sicher(), samesite='Lax', path=_cookie_pfad())
    r.delete_cookie(STATE_COOKIE, path=_cookie_pfad())
    return r


@v2.route('/v2/api/admin/ich')
def zentral_ich():
    s = sitzung()
    return jsonify({'angemeldet': bool(s), 'name': s['name'] if s else None, 'methode': s['methode'] if s else None,
                    'zentral': eingerichtet()})


@v2.route('/v2/abmelden', methods=['POST'])
def zentral_abmelden():
    t = request.cookies.get(SITZUNG_COOKIE, '')
    if t:
        with _db() as conn:
            _tabellen(conn)
            conn.execute('DELETE FROM zentral_sitzungen WHERE token_hash = ?', (hashlib.sha256(t.encode()).hexdigest(),))
    r = jsonify({'ok': True})
    r.delete_cookie(SITZUNG_COOKIE, path=_cookie_pfad())
    return r
