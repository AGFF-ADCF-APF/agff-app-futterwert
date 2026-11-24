"""Laborbericht mit mehreren Proben lesen (z. B. UFAG-Prüfbericht) → je Probe Messwerte, Zielbereiche und Angaben.

Gedacht für die Funktion «Laboranalyse auswerten». Ohne Flask-Abhängigkeit (separat testbar).

Datenschutz: Zurückgegeben werden nur Probenangaben (Bezeichnung, Schnitt, Datum, Höhenstufe, Bestand,
Bemerkung), Messwerte und Labor-Kommentare. Kunden-Nr., Auftraggeber, Adressen, Rechnungsangaben und
der Standortcode («Stat.code») werden bewusst nicht übernommen. Nichts wird gespeichert.
"""
import os
import re
import shutil
import subprocess
import tempfile

MAX_SEITEN = 40
ZAHL = r'[<>]?\s*\d+(?:[.,]\d+)?'

# (Schlüssel, Regex für die Bezeichnung am Zeilenanfang, Einheit-Hinweis)
PARAMETER = [
    ('ts', r'trocken\s*substanz', 'g/kg'),
    ('ra', r'roh\s*asche', 'g/kg TS'),
    ('ph', r'ph[\s-]*wert', ''),
    ('milchsaeure', r'milchs[äa]ure', 'g/kg TS'),
    ('essigsaeure', r'essigs[äa]ure', 'g/kg TS'),
    ('nh3', r'nh3(?:[\s-]*n)?|ammoniak', '%'),
    ('rp', r'roh\s*protein(?:\s*nx6[.,]25)?', 'g/kg TS'),
    ('lprot', r'l[öo]sliches\s*protein', '%'),
    ('rf', r'roh\s*faser', 'g/kg TS'),
    ('rfe', r'roh\s*fett', 'g/kg TS'),
    ('vcos', r'vcos', '%'),
    ('zucker', r'zucker', 'g/kg TS'),
    ('dndf', r'verdaul\.?\s*ndf', '%'),
    ('ndf', r'a?ndf(?:\s*om)?', 'g/kg TS'),
    ('adf', r'adf(?:\s*om)?', 'g/kg TS'),
    ('adl', r'adl', 'g/kg TS'),
    ('vos', r'vos', 'g/kg TS'),
    ('apde', r'apd\s*e(?:\s*\(rindvieh\))?', 'g/kg TS'),
    ('apdn', r'apd\s*n(?:\s*\(rindvieh\))?', 'g/kg TS'),
    ('nel', r'nel(?:\s*\(rindvieh\))?', 'MJ/kg TS'),
    ('nev', r'nev(?:\s*\(rindvieh\))?', 'MJ/kg TS'),
    ('pme', r'pme', 'g/kg TS'),
    ('pmn', r'pmn', 'g/kg TS'),
    ('lys', r'lysin(?:\s*lys)?', 'g/kg TS'),
    ('met', r'methionin(?:\s*met)?', 'g/kg TS'),
    ('ca', r'calcium(?:\s*ca)?', 'g/kg TS'),
    ('p', r'phosphor(?:\s*p)?', 'g/kg TS'),
    ('mg', r'magnesium(?:\s*mg)?', 'g/kg TS'),
    ('k', r'kalium(?:\s*k)?', 'g/kg TS'),
    ('na', r'natrium(?:\s*na)?', 'g/kg TS'),
    ('cl', r'chlorid(?:\s*cl)?', 'g/kg TS'),
    ('bs', r'butters[äa]ure(?:\s*c4:0)?', 'g/kg TS'),
    ('kindex', r'konservierungsindex', ''),
    ('nerisk', r'nacherw[äa]rmungsrisiko', ''),
    ('nindex', r'n[\s-]*index', ''),
]
# Plausible Bereiche (Ausreisser durch Lesefehler verwerfen)
BEREICH = {
    'ts': (50, 1000), 'ra': (10, 300), 'ph': (3.0, 8.5), 'milchsaeure': (0, 200), 'essigsaeure': (0, 150), 'nh3': (0, 60), 'rp': (20, 450),
    'lprot': (0, 100), 'rf': (50, 500), 'rfe': (0, 120), 'vcos': (30, 95), 'zucker': (0, 400), 'dndf': (20, 100), 'ndf': (100, 850),
    'adf': (50, 600), 'adl': (0, 200), 'vos': (200, 950), 'apde': (20, 200), 'apdn': (10, 300), 'nel': (2.0, 9.5), 'nev': (2.0, 10.0),
    'pme': (10, 200), 'pmn': (10, 300), 'lys': (0, 20), 'met': (0, 10), 'ca': (0, 40), 'p': (0, 15), 'mg': (0, 10), 'k': (0, 60),
    'na': (0, 15), 'cl': (0, 40), 'bs': (0, 100), 'kindex': (0, 120), 'nerisk': (0, 100), 'nindex': (0, 200),
}
META = [
    ('name', r'probename'), ('bezeichnung', r'bezeichnung'), ('belueftung', r'bel[üu]ftung'), ('bestand', r"bot\.?\s*z'?\s*setzung"),
    ('schnitt', r'schnitt(?!datum)'), ('schnittdatum', r'schnittdatum'), ('hoehe', r'h[öo]he\s*[üu]\.?\s*m\.?'), ('bemerkung', r'bemerkung'),
]


def text_aus_pdf(daten):
    tmp = tempfile.mkdtemp(prefix='agff-bericht-')
    try:
        pfad = os.path.join(tmp, 'b.pdf')
        with open(pfad, 'wb') as fh:
            fh.write(daten)
        r = subprocess.run(['pdftotext', '-layout', '-l', str(MAX_SEITEN), pfad, '-'], capture_output=True, timeout=60, check=False)
        return r.stdout.decode('utf-8', 'replace')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _zahl(s):
    s = (s or '').replace(',', '.').replace(' ', '')
    kleiner = s.startswith('<')
    try:
        v = float(s.lstrip('<>'))
    except ValueError:
        return None, False
    return v, kleiner


def _wertzeile(zeile):
    """'  Rohasche  122 g/kg TS  101  60-120' → (key, wert, kleiner, mittel, ziel)"""
    z = zeile.strip()
    for key, rx, _ in PARAMETER:
        m = re.match(r'(?i)(?:' + rx + r')(?![A-Za-zäöü])\s*(?:[A-Z][A-Za-z0-9:]{0,5}\s+)?(' + ZAHL + r')\s*(?:g/kg(?:\s*TS)?|mg/kg(?:\s*TS)?|MJ/kg(?:\s*TS)?|%)?(.*)$', z)
        if not m:
            continue
        wert, kleiner = _zahl(m.group(1))
        if wert is None:
            return None
        rest = m.group(2).strip()
        mittel, ziel = None, None
        teile = re.findall(r'\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?', rest)
        for t in teile:
            if '-' in t:
                a, b = [_zahl(x)[0] for x in t.split('-')]
                if a is not None and b is not None:
                    ziel = [min(a, b), max(a, b)]
            elif mittel is None:
                mittel = _zahl(t)[0]
            elif ziel is None:
                ziel = [None, _zahl(t)[0]]  # einzelner Zielwert = Obergrenze (z. B. Buttersäure 3.0, NH3 8.0)
        lo, hi = BEREICH[key]
        if not (lo <= wert <= hi):
            return None
        return key, wert, kleiner, mittel, ziel
    return None


def proben_aus_text(text):
    """Text eines Prüfberichts → Liste von Proben. Seiten derselben Proben-Nr. werden zusammengeführt."""
    proben = {}
    reihenfolge = []
    aktuell = None
    in_kommentar = False
    for zeile in text.splitlines():
        s = zeile.strip()
        m = re.match(r'(?i)proben[\s-]*nr\.?:\s*([\w.-]+)', s)
        if m:
            nr = m.group(1)
            if nr not in proben:
                proben[nr] = {'nr': nr, 'meta': {}, 'werte': {}, 'kommentare': []}
                reihenfolge.append(nr)
            aktuell = proben[nr]
            in_kommentar = False
            continue
        if aktuell is None or not s:
            if not s:
                in_kommentar = in_kommentar and False
            continue
        if re.match(r'(?i)^(legende|report-id|prüfbericht|auftraggeber|seite\s+\d)', s):
            in_kommentar = False
            continue
        if re.match(r'(?i)^kommentare?$', s):
            in_kommentar = True
            continue
        hit = False
        for key, rx in META:
            mm = re.match(r'(?i)^' + rx + r'\s*:\s*(.+)$', s)
            if mm:
                aktuell['meta'].setdefault(key, mm.group(1).strip()[:200])
                hit = True
                break
        if hit:
            in_kommentar = False
            continue
        w = _wertzeile(zeile)
        if w:
            key, wert, kleiner, mittel, ziel = w
            if key not in aktuell['werte']:
                if key == 'ts' and wert > 100:
                    wert, mittel = wert / 10, (mittel / 10 if mittel else None)
                    ziel = [z / 10 if z is not None else None for z in ziel] if ziel else None
                aktuell['werte'][key] = {'v': wert, 'kleiner': kleiner, 'mittel': mittel, 'ziel': ziel}
            in_kommentar = False
            continue
        if in_kommentar and len(aktuell['kommentare']) < 12 and not re.search(r'(?i)regressionsgleichungen|grünen buches|agroscope, 07', s):
            if aktuell['kommentare'] and not re.search(r'[.!?]$', aktuell['kommentare'][-1]):
                aktuell['kommentare'][-1] = (aktuell['kommentare'][-1] + ' ' + s)[:600]
            else:
                aktuell['kommentare'].append(s[:600])
    out = [proben[nr] for nr in reihenfolge if proben[nr]['werte']]
    for p in out:
        p['meta'].pop('stat', None)
    return out


def labor_erkennen(text):
    t = text.lower()
    if 'ufag' in t:
        return 'UFAG'
    if 'eurofins' in t:
        return 'Eurofins'
    if 'agroscope' in t and 'prüfbericht' not in t:
        return 'Agroscope'
    return None


def lesen(daten):
    text = text_aus_pdf(daten)
    return {'labor': labor_erkennen(text), 'proben': proben_aus_text(text)}


if __name__ == '__main__':
    import json
    import sys
    with open(sys.argv[1], 'rb') as fh:
        r = lesen(fh.read())
    print(r['labor'], len(r['proben']))
    for p in r['proben']:
        print(json.dumps({'nr': p['nr'], 'meta': p['meta'], 'n': len(p['werte']), 'werte': {k: v['v'] for k, v in p['werte'].items()}, 'kom': p['kommentare']}, ensure_ascii=False))
