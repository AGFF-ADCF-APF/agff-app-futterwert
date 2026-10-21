"""Futter v2 – zentrale Anmeldung über graswachstum.ch (Passkey, E-Mail-Code oder Authenticator-App).

Ablauf:
  1. GET  /v2/anmelden            -> Nonce im Cookie, Weiterleitung zu graswachstum.ch
     (<ZENTRAL_URL>/eagff-mitwirken/zugang/apps?app=futter&zurueck=…&nonce=…)
  2. graswachstum.ch meldet an und schickt per POST einen kurz gültigen Ausweis (JWT HS256)
  3. POST /v2/anmelden/rueckweg   -> Signatur, Empfänger, Ablauf, Nonce und Einmaligkeit prüfen;
     mit Recht «admin» oder «apps_admin» entsteht eine Admin-Sitzung (Cookie, 8 h)
  4. POST /v2/abmelden            -> Sitzung beenden

Umgebung: ZENTRAL_URL (Standard https://graswachstum.ch), ZENTRAL_GEHEIMNIS (wie
zugang.apps.futter.geheimnis auf graswachstum.ch), ZENTRAL_APP (Standard futter).
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
NONCE_COOKIE = 'agff_v2_anmeldung'
SITZUNG_DAUER = 8 * 3600


def _zentral_url():
    return (os.environ.get('ZENTRAL_URL') or 'https://graswachstum.ch').rstrip('/')


def _geheimnis():
    return os.environ.get('ZENTRAL_GEHEIMNIS') or ''


def _app_id():
    return os.environ.get('ZENTRAL_APP') or 'futter'


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def _unb64(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def _tabellen(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS zentral_sitzungen (token_hash TEXT PRIMARY KEY, sub TEXT, name TEXT, methode TEXT, '
                 'created_at INTEGER, expires_at INTEGER)')
    conn.execute('CREATE TABLE IF NOT EXISTS zentral_ausweise (jti TEXT PRIMARY KEY, expires_at INTEGER)')


def _basis():
    """Öffentliche Adresse der App (Traefik schneidet /futter bzw. /wiese ab und meldet es in X-Forwarded-Prefix)."""
    proto = request.headers.get('X-Forwarded-Proto') or request.scheme
    host = request.headers.get('X-Forwarded-Host') or request.host
    return f"{proto}://{host}{request.headers.get('X-Forwarded-Prefix', '').rstrip('/')}"


def _cookie_pfad():
    return (request.headers.get('X-Forwarded-Prefix', '').rstrip('/') or '') + '/'


def _sicher():
    return (request.headers.get('X-Forwarded-Proto') or request.scheme) == 'https'


def ausweis_pruefen(token, nonce):
    """Gibt die Angaben des Ausweises zurück oder wirft ValueError."""
    geheimnis = _geheimnis()
    if len(geheimnis) < 32:
        raise ValueError('Zentrale Anmeldung ist nicht eingerichtet (ZENTRAL_GEHEIMNIS fehlt).')
    try:
        kopf, rumpf, sig = token.split('.')
        k = json.loads(_unb64(kopf))
        d = json.loads(_unb64(rumpf))
    except Exception:
        raise ValueError('Ausweis unlesbar.')
    erwartet = _b64(hmac.new(geheimnis.encode(), (kopf + '.' + rumpf).encode(), hashlib.sha256).digest())
    if k.get('alg') != 'HS256' or not hmac.compare_digest(erwartet, sig):
        raise ValueError('Ausweis nicht gültig signiert.')
    jetzt = int(time.time())
    if d.get('aud') != _app_id() or d.get('iss', '').rstrip('/') != _zentral_url():
        raise ValueError('Ausweis für eine andere App oder von einem anderen Aussteller.')
    if not isinstance(d.get('exp'), int) or d['exp'] < jetzt or d.get('iat', 0) > jetzt + 60:
        raise ValueError('Ausweis abgelaufen. Bitte nochmals anmelden.')
    if not nonce or not hmac.compare_digest(str(d.get('nonce', '')), nonce):
        raise ValueError('Ausweis gehört nicht zu dieser Anmeldung. Bitte nochmals anmelden.')
    with _db() as conn:
        _tabellen(conn)
        conn.execute('DELETE FROM zentral_ausweise WHERE expires_at < ?', (jetzt,))
        if conn.execute('SELECT 1 FROM zentral_ausweise WHERE jti = ?', (str(d.get('jti', '')),)).fetchone():
            raise ValueError('Ausweis wurde schon verwendet.')
        conn.execute('INSERT INTO zentral_ausweise (jti, expires_at) VALUES (?, ?)', (str(d.get('jti', '')), d['exp']))
    return d


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
<meta name="robots" content="noindex"><title>Anmeldung – Futterbeurteilung v2</title><link rel="stylesheet" href="{{ basis }}/v2/assets/app.css"></head>
<body><div class="doc"><h1>Anmeldung</h1><p class="alert warn">{{ text }}</p><p><a class="btn" href="{{ basis }}/v2/admin">Zur Administration</a></p></div></body></html>"""


@v2.route('/v2/anmelden')
def zentral_anmelden():
    from urllib.parse import quote
    nonce = secrets.token_urlsafe(24)
    ziel = (_zentral_url() + '/eagff-mitwirken/zugang/apps?app=' + quote(_app_id())
            + '&zurueck=' + quote(_basis() + '/v2/anmelden/rueckweg', safe='') + '&nonce=' + quote(nonce))
    r = redirect(ziel)
    # SameSite=None: der Rückweg ist ein POST von graswachstum.ch (andere Website)
    r.set_cookie(NONCE_COOKIE, nonce, max_age=900, httponly=True, secure=_sicher(), samesite='None' if _sicher() else 'Lax', path=_cookie_pfad())
    return r


@v2.route('/v2/anmelden/rueckweg', methods=['POST'])
def zentral_rueckweg():
    basis = _basis()
    try:
        d = ausweis_pruefen(request.form.get('ausweis', ''), request.cookies.get(NONCE_COOKIE, ''))
    except ValueError as e:
        return render_template_string(SEITE, basis=basis, text=str(e)), 400
    rechte = d.get('rechte') or {}
    if not (rechte.get('admin') or rechte.get('apps_admin')):
        return render_template_string(SEITE, basis=basis, text='Ihr Konto hat keinen Zugang zur Administration von Futter v2. '
                                      'Freigabe über graswachstum.ch/admin (Recht «Apps verwalten»).'), 403
    token = secrets.token_urlsafe(32)
    jetzt = int(time.time())
    with _db() as conn:
        _tabellen(conn)
        conn.execute('DELETE FROM zentral_sitzungen WHERE expires_at < ?', (jetzt,))
        conn.execute('INSERT INTO zentral_sitzungen (token_hash, sub, name, methode, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
                     (hashlib.sha256(token.encode()).hexdigest(), d.get('sub'), d.get('name'), d.get('methode'), jetzt, jetzt + SITZUNG_DAUER))
    r = make_response(redirect(basis + '/v2/admin'), 303)
    r.set_cookie(SITZUNG_COOKIE, token, max_age=SITZUNG_DAUER, httponly=True, secure=_sicher(), samesite='Lax', path=_cookie_pfad())
    r.delete_cookie(NONCE_COOKIE, path=_cookie_pfad())
    return r


@v2.route('/v2/api/admin/ich')
def zentral_ich():
    s = sitzung()
    return jsonify({'angemeldet': bool(s), 'name': s['name'] if s else None, 'methode': s['methode'] if s else None,
                    'zentral': len(_geheimnis()) >= 32})


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
