"""Datenumzug Futter v2: Flask/SQLite (Home-Server) → PHP/MySQL (all-inkl), Teil 1: Export.

Läuft IM Flask-Container (dort liegen V2_SERVER_KEY, data/v2.db und data/v2_fotos) und schreibt einen Strom aus
JSON-Zeilen auf stdout, der direkt per SSH in `skripte/umzug.php einspielen` auf all-inkl fliesst – nie in eine Datei:

    docker exec -i agff-futterrechner python3 -I - < allinkl/skripte/umzug_export.py | ssh … 'php84 skripte/umzug.php einspielen'

(Aufruf über allinkl/skripte/umzug.sh, nicht von Hand.)

Live hat einen NEUEN Server-Schlüssel. Darum werden alle mit dem alten Schlüssel verschlüsselten Felder hier
entschlüsselt und als {"klar": …} übergeben; umzug.php verschlüsselt sie mit dem neuen Schlüssel. HMAC-Felder
(E-Mail, Gruppen-Code) werden als {"email": …} bzw. {"code": …} übergeben und dort neu berechnet. Der Strom enthält
damit Klartext (E-Mail-Adressen, Namen, Rückmeldungen): er läuft nur durch die verschlüsselte SSH-Verbindung.

Auf stderr steht nur eine Zusammenfassung (Anzahl Zeilen je Tabelle, Fotos, nicht entschlüsselbare Felder) – nie Inhalte.
Ende-zu-Ende-verschlüsselte Daten (Freigaben, Kurse) und Fotos werden unverändert übernommen.
Nicht übernommen: email_codes (Bestätigungscodes, kurzlebig), zentral_* (Admin-Sitzungen), Ratenbegrenzung.
"""
import base64
import hashlib  # noqa: F401 – nur für Klarheit: Hashes ohne Schlüssel (sha256) bleiben gültig und werden kopiert
import json
import os
import sqlite3
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DB = os.environ.get('V2_DB_PATH', 'data/v2.db')
FOTOS = os.environ.get('V2_FOTO_DIR', 'data/v2_fotos')
FORMAT = 'futter-umzug-1'

# Tabelle → (Reihenfolge wie die Fremdschlüssel in MySQL, Sortierung)
TABELLEN = [
    ('e2e_spaces', 'id'), ('e2e_fotos', 'space_id, id'), ('e2e_records', 'space_id, id'),
    ('kursleitende', 'created_at'), ('einladungen', 'created_at'),
    ('kurse', 'created_at'), ('kurs_teilnehmende', 'created_at'), ('kurs_sessions', 'expires_at'),
    ('kurs_proben', 'kurs_id, nr'), ('kurs_beurteilungen', 'kurs_id, probe_id'), ('kurs_fotos', 'kurs_id, id'),
    ('pool_proben', 'created_at'), ('pool_fotos', 'pool_id, id'),
    ('beitraege', 'created_at'),
    ('konten', 'created_at'), ('konto_links', 'created_at'), ('konto_sessions', 'created_at'),
    ('konto_daten', 'konto_id, app, id'), ('konto_fotos', 'konto_id, id'),
    ('foto_quota', 'email_hmac'), ('quota_antraege', 'created_at'),
    ('rueckmeldungen', 'rowid'),
]
# Mit dem Server-Schlüssel verschlüsselte Felder: (Tabelle, Spalte) → AAD
VERSCHLUESSELT = {
    ('e2e_spaces', 'owner_email_enc'): b'agff-email', ('e2e_spaces', 'beitritt_enc'): b'gruppe-beitritt',
    ('kursleitende', 'email_enc'): b'agff-email', ('kursleitende', 'name_enc'): b'kl',
    ('kursleitende', 'org_enc'): b'kl', ('kursleitende', 'text_enc'): b'kl',
    ('kurse', 'link_enc'): b'kurs-link',
    ('kurs_teilnehmende', 'email_enc'): b'agff-email',
    ('pool_proben', 'daten_enc'): b'pool',
    ('konten', 'email_enc'): b'agff-email', ('konto_links', 'email_enc'): b'agff-email',
    ('quota_antraege', 'email_enc'): b'agff-email', ('quota_antraege', 'text_enc'): b'quota',
    ('rueckmeldungen', 'text_enc'): b'agff-rueckmeldung',
}
# HMAC der E-Mail mit dem Server-Schlüssel: (Tabelle, Spalte) → Spalte mit der verschlüsselten Adresse derselben Zeile
# (None = keine in der Zeile, über die Zuordnung alter HMAC → Adresse aus allen Tabellen)
EMAIL_HMAC = {
    ('e2e_spaces', 'owner_email_hmac'): 'owner_email_enc', ('kursleitende', 'email_hmac'): 'email_enc',
    ('kurs_teilnehmende', 'email_hmac'): 'email_enc', ('konten', 'email_hmac'): 'email_enc',
    ('konto_links', 'email_hmac'): 'email_enc', ('quota_antraege', 'email_hmac'): 'email_enc',
    ('kurse', 'pending_email_hmac'): None, ('pool_proben', 'creator_hmac'): None, ('foto_quota', 'email_hmac'): None,
}


def schluessel():
    raw = os.environ.get('V2_SERVER_KEY', '')
    key = base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4))
    if len(key) != 32:
        sys.exit('V2_SERVER_KEY fehlt oder ist ungültig')
    return key


def main():
    if not os.path.isfile(DB):
        sys.exit(f'{DB} fehlt')
    aes = AESGCM(schluessel())

    def dec(blob, aad):
        try:
            roh = base64.urlsafe_b64decode(blob)
            return aes.decrypt(roh[:12], roh[12:], aad).decode()
        except Exception:  # noqa: BLE001 – Inhalt nie ausgeben
            return None

    # Nur lesend, als Momentaufnahme (Flask kann weiterlaufen)
    quelle = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    db = sqlite3.connect(':memory:')
    quelle.backup(db)
    quelle.close()
    db.row_factory = sqlite3.Row
    vorhanden = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}

    # Zuordnung alter E-Mail-HMAC → Adresse aus allen verschlüsselten Adressen
    adresse = {}
    for (t, sp), enc in EMAIL_HMAC.items():
        if enc and t in vorhanden:
            for r in db.execute(f'SELECT {sp} AS h, {enc} AS e FROM {t} WHERE {sp} IS NOT NULL AND {enc} IS NOT NULL'):
                e = dec(r['e'], b'agff-email')
                if e:
                    adresse[r['h']] = e

    aus = sys.stdout
    zaehler, fehler = {}, {}

    def schreiben(obj):
        aus.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n')

    schreiben({'format': FORMAT, 'tabellen': [t for t, _ in TABELLEN if t in vorhanden]})
    for t, sortierung in TABELLEN:
        if t not in vorhanden:
            continue
        n = 0
        for r in db.execute(f'SELECT * FROM {t} ORDER BY {sortierung}'):
            zeile = dict(r)
            for sp in list(zeile):
                wert = zeile[sp]
                if wert is None:
                    continue
                if (t, sp) in VERSCHLUESSELT:
                    klar = dec(wert, VERSCHLUESSELT[(t, sp)])
                    if klar is None:
                        fehler[f'{t}.{sp}'] = fehler.get(f'{t}.{sp}', 0) + 1
                    zeile[sp] = {'klar': klar}
                elif (t, sp) in EMAIL_HMAC:
                    e = adresse.get(wert)
                    if e is None:
                        fehler[f'{t}.{sp} (Adresse unbekannt)'] = fehler.get(f'{t}.{sp} (Adresse unbekannt)', 0) + 1
                    zeile[sp] = {'email': e}
                elif t == 'e2e_spaces' and sp == 'beitritt_hmac':
                    zeile[sp] = {'code_aus': 'beitritt_enc'}  # umzug.php berechnet ihn aus dem entschlüsselten Code neu
            schreiben({'t': t, 'r': zeile})
            n += 1
        zaehler[t] = n

    # Fotos (Dateien unter v2_fotos, relativ; nur *.bin)
    fotos = byte = 0
    if os.path.isdir(FOTOS):
        for wurzel, ordner, dateien in os.walk(FOTOS):
            ordner.sort()
            for name in sorted(dateien):
                if not name.endswith('.bin'):
                    continue
                pfad = os.path.join(wurzel, name)
                rel = os.path.relpath(pfad, FOTOS)
                with open(pfad, 'rb') as f:
                    inhalt = f.read()
                schreiben({'t': '_foto', 'p': rel, 'b': base64.b64encode(inhalt).decode('ascii')})
                fotos += 1
                byte += len(inhalt)
    schreiben({'ende': True, 'zeilen': zaehler, 'fotos': fotos})
    aus.flush()

    print('Export: ' + ', '.join(f'{t} {n}' for t, n in zaehler.items() if n) + f'; Fotos {fotos} ({byte // 1024} KB)', file=sys.stderr)
    if fehler:
        print('Achtung, nicht entschlüsselbar bzw. ohne Adresse: ' + ', '.join(f'{k} {v}' for k, v in fehler.items()), file=sys.stderr)


if __name__ == '__main__':
    main()
