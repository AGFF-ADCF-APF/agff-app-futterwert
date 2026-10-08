"""Futter v2 – E-Mail: Einmal-Codes, Versand, Verschlüsselung von Adressen.

Gemeinsam genutzt von Kursen, Team-Freigaben und Anträgen für die Kursleitung.
Adressen liegen nie im Klartext in der Datenbank: AES-GCM mit Serverschlüssel (Anzeige
für Berechtigte) und HMAC (Suche).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import ssl
import sys
import threading
import time
from email.message import EmailMessage

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from v2_api import _db, _sha, _rate_hit

EMAIL_RE = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$')
CODE_TTL = 15 * 60
CODE_ATTEMPTS = 5
_DRYRUN_OUTBOX = []


def init_mail_db():
    with _db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS email_codes (
                zweck TEXT NOT NULL, email_hmac TEXT NOT NULL,
                code_hash TEXT NOT NULL, expires_at REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (zweck, email_hmac)
            );
        ''')
        conn.execute('DELETE FROM email_codes WHERE expires_at < ?', (time.time(),))


# --- Server-Schlüssel ----------------------------------------------------------------
def _server_key():
    raw = os.environ.get('V2_SERVER_KEY', '')
    try:
        key = base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4))
    except ValueError:
        key = b''
    if len(key) != 32:
        raise RuntimeError('V2_SERVER_KEY fehlt oder ist ungültig (32 Byte base64url erwartet)')
    return key


def email_norm(email):
    return (email or '').strip().lower()


def email_ok(email):
    return bool(EMAIL_RE.match(email_norm(email)))


def email_hmac(email):
    return hmac.new(_server_key(), b'email|' + email_norm(email).encode(), hashlib.sha256).hexdigest()


def text_enc(text, aad=b'agff-email'):
    nonce = secrets.token_bytes(12)
    return base64.urlsafe_b64encode(nonce + AESGCM(_server_key()).encrypt(nonce, (text or '').encode(), aad)).decode()


def text_dec(blob, aad=b'agff-email'):
    try:
        raw = base64.urlsafe_b64decode(blob)
        return AESGCM(_server_key()).decrypt(raw[:12], raw[12:], aad).decode()
    except Exception:  # noqa: BLE001
        return None


def email_enc(email):
    return text_enc(email_norm(email))


def email_dec(blob):
    return text_dec(blob)


def email_mask(email):
    if not email or '@' not in email:
        return '…'
    local, domain = email.split('@', 1)
    head = local[:2] if len(local) > 3 else local[:1]
    if '.' not in domain:
        return f'{head}…@…'
    name, tld = domain.rsplit('.', 1)
    return f'{head}…@…{name[-2:]}.{tld}'


# --- Codes ---------------------------------------------------------------------------
def code_erzeugen(zweck, email):
    """Neuen 6-stelligen Code für (Zweck, Adresse) ablegen und zurückgeben. Ratenbegrenzt je Adresse."""
    _rate_hit('code_mail:' + email_hmac(email), limit=5, window=3600)
    code = f'{secrets.randbelow(1_000_000):06d}'
    with _db() as conn:
        conn.execute('INSERT INTO email_codes (zweck, email_hmac, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0) '
                     'ON CONFLICT(zweck, email_hmac) DO UPDATE SET code_hash = excluded.code_hash, '
                     'expires_at = excluded.expires_at, attempts = 0',
                     (zweck, email_hmac(email), _sha(zweck + '|' + code), time.time() + CODE_TTL))
    return code


def code_pruefen(zweck, email, code):
    """True bei korrektem Code (dann verbraucht). Nach 5 Fehlversuchen wird der Code gelöscht."""
    code = str(code or '').strip()
    if not re.match(r'^\d{6}$', code):
        return False
    eh = email_hmac(email)
    with _db() as conn:
        c = conn.execute('SELECT * FROM email_codes WHERE zweck = ? AND email_hmac = ?', (zweck, eh)).fetchone()
        if not c or c['expires_at'] < time.time():
            return False
        if not hmac.compare_digest(c['code_hash'], _sha(zweck + '|' + code)):
            if c['attempts'] + 1 >= CODE_ATTEMPTS:
                conn.execute('DELETE FROM email_codes WHERE zweck = ? AND email_hmac = ?', (zweck, eh))
            else:
                conn.execute('UPDATE email_codes SET attempts = attempts + 1 WHERE zweck = ? AND email_hmac = ?', (zweck, eh))
            return False
        conn.execute('DELETE FROM email_codes WHERE zweck = ? AND email_hmac = ?', (zweck, eh))
    return True


# --- Versand -------------------------------------------------------------------------
def senden(to_addr, betreff, text):
    if os.environ.get('V2_MAIL_DRYRUN') == '1':  # nur für automatische Tests
        _DRYRUN_OUTBOX.append((to_addr, betreff, text))
        if os.environ.get('V2_MAIL_DRYRUN_FILE'):
            m = re.search(r'\b(\d{6})\b', text)
            with open(os.environ['V2_MAIL_DRYRUN_FILE'], 'a') as fh:
                fh.write(json.dumps({'to': to_addr, 'betreff': betreff, 'code': m.group(1) if m else None}) + '\n')
        return
    host, user, pw = os.environ.get('SMTP_HOST'), os.environ.get('SMTP_USER'), os.environ.get('SMTP_PASS')
    sender = os.environ.get('SMTP_FROM') or user
    if not (host and user and pw):
        print('MAIL: SMTP nicht konfiguriert – nicht versendet', file=sys.stderr)
        return
    msg = EmailMessage()
    msg['Subject'] = betreff
    msg['From'] = f'Futterbeurteilung <{sender}>'
    msg['To'] = to_addr
    msg['Auto-Submitted'] = 'auto-generated'
    msg.set_content(text + '\n-- \nAGFF Futterbeurteilung v2 · apps.graswachstum.ch\n'
                    'Diese Nachricht wurde automatisch versendet. Bitte nicht antworten.\n')

    def run():
        try:
            with smtplib.SMTP_SSL(host, 465, timeout=20, context=ssl.create_default_context()) as s:
                s.login(user, pw)
                s.send_message(msg)
        except Exception as e:  # noqa: BLE001
            print(f'MAIL: Versand fehlgeschlagen: {type(e).__name__}', file=sys.stderr)
    threading.Thread(target=run, daemon=True).start()


def code_senden(zweck, email, wozu):
    code = code_erzeugen(zweck, email)
    senden(email_norm(email), f'Ihr Bestätigungscode: {code}',
           f'Ihr Code für die Futterbeurteilung ({wozu}) lautet:\n\n    {code}\n\n'
           'Der Code ist 15 Minuten gültig. Geben Sie ihn in der App ein.\n\n'
           'Falls Sie keinen Code angefordert haben, können Sie diese E-Mail ignorieren.\n')


def admin_adresse():
    return os.environ.get('V2_ADMIN_MAIL') or os.environ.get('SMTP_FROM')
