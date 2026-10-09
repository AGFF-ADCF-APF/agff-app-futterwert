"""Laborbericht lesen: Text aus PDF (pdftotext) oder Foto (Tesseract-OCR) → Futterwerte.

Ohne Flask-Abhängigkeit, damit es separat getestet werden kann. Alles läuft im Arbeitsspeicher bzw.
in einem temporären Verzeichnis, das sofort gelöscht wird.

Werte werden pro kg TS zurückgegeben (wie in Schweizer Laborberichten «g/kg TS», «MJ/kg TS»),
TS als Prozent. Bei OCR-typischen Fehlern (fehlender Dezimalpunkt) wird anhand plausibler
Bereiche korrigiert; unplausible Werte werden verworfen statt geraten.
"""
import io
import os
import re
import shutil
import subprocess
import tempfile

from collections import Counter

import numpy as np
from PIL import Image, ImageFilter, ImageOps

# Parameter: (Schlüssel, Regex für den Zeilenanfang, plausibler Bereich, Dezimalstellen erwartet)
PARAMETER = [
    ('ts', r'trocken\s*substanz|^\s*ts\b', (80, 1000), 0),          # g/kg Frischsubstanz → % (/10)
    ('ra', r'roh\s*asche', (20, 250), 0),
    ('rp', r'roh\s*protein', (30, 400), 0),
    ('rf', r'roh\s*faser', (50, 500), 0),
    ('rfe', r'roh\s*fett', (5, 120), 0),
    ('zucker', r'zucker', (0, 350), 0),
    ('ndf', r'\b(a?ndf\s*om|ndf)\b', (150, 800), 0),
    ('adf', r'\b(adf\s*om|adf)\b', (80, 600), 0),
    ('adl', r'\badl\b', (5, 150), 0),
    ('vos', r'\bvos\b', (300, 900), 0),
    ('apde', r'apd\s*e\b', (30, 160), 0),
    ('apdn', r'apd\s*n\b', (20, 300), 0),
    ('nel', r'^\s*nel\b|nettoenergie\s*laktation', (2.5, 9.0), 1),
    ('nev', r'^\s*nev\b|nettoenergie\s*(mast|wachstum)', (2.5, 9.5), 1),
    ('ph', r'p\s*h[\s-]*wert|^\s*ph\b', (3.0, 8.0), 1),
    ('milchsaeure', r'milchs[äa]ure', (0, 200), 0),
    ('essigsaeure', r'essigs[äa]ure', (0, 120), 0),
    ('buttersaeure', r'butters[äa]ure', (0, 80), 1),
    ('nh3', r'^\s*nh\s*3', (0, 60), 1),
]
_ZAHL = re.compile(r'(?<![\w.,])(\d{1,4}(?:[.,]\d{1,3})?)(?![\w.,]*\d)')
_ZAHL_ALLE = re.compile(r'\d{1,4}(?:[.,]\d{1,3})?')
_AUSSCHLUSS = re.compile(r'verdaul|l[öo]slich|anteil|abbaubar|in\s*%\s*des|kg\s*pro\s*ha|ertr', re.I)


def _plausibel(key, rohtext, wert):
    lo, hi = next((p[2] for p in PARAMETER if p[0] == key))
    if lo <= wert <= hi:
        return wert
    # OCR verliert oft den Dezimalpunkt: 46 statt 4.6, 573 statt 57.3
    if '.' not in rohtext and ',' not in rohtext:
        for teiler in (10, 100):
            if lo <= wert / teiler <= hi:
                return round(wert / teiler, 2)
    return None


def werte_aus_text(text):
    """Durchsucht Zeilen nach bekannten Parametern und nimmt die erste Zahl nach dem Namen (= Resultat,
    nicht Mittelwert/Zielbereich). Liefert {werte, zeilen}."""
    werte, zeilen = {}, {}
    for zeile in text.splitlines():
        z = zeile.replace('|', ' ').replace('—', '-')
        if not z.strip() or _AUSSCHLUSS.search(z):
            continue
        for key, rx, _, _ in PARAMETER:
            if key in werte:
                continue
            m = re.search(rx, z, re.I)
            if not m:
                continue
            rest = z[m.end():]
            # Klammerzusätze wie «(Rindvieh)» und «Nx6.25» überspringen
            rest = re.sub(r'\([^)]*\)', ' ', rest)
            rest = re.sub(r'n\s*x\s*6[.,]25', ' ', rest, flags=re.I)
            rest = re.sub(r'\bc\s*\d+:\d+\b', ' ', rest, flags=re.I)  # «C4:0» bei Buttersäure
            zahl = _ZAHL_ALLE.search(rest)
            if not zahl:
                continue
            roh = zahl.group(0)
            wert = float(roh.replace(',', '.'))
            dezimal = next(p[3] for p in PARAMETER if p[0] == key)
            if dezimal and '.' not in roh and ',' not in roh:
                # Werte mit Nachkommastelle: ganze Zahl nur akzeptieren, wenn direkt «MJ» folgt
                # (verlorener Dezimalpunkt) – sonst ist es Rauschen oder eine andere Spalte.
                if key in ('nel', 'nev') and re.match(r'\s*M\s*[J1lI]', rest[zahl.end():], re.I):
                    pass
                elif key == 'ph' and re.match(r'\s*$', rest[zahl.end():]) and 3 <= wert <= 8:
                    pass
                else:
                    continue
            if key == 'ts':
                # «253 g/kg» → 25.3 %, «38,2 %» bleibt
                if re.search(r'%', rest[zahl.end():zahl.end() + 6]):
                    pass
                elif wert > 100:
                    wert = wert / 10
                wert_p = wert if 8 <= wert <= 100 else None
                if wert_p is not None:
                    werte['ts'] = round(wert_p, 1)
                    zeilen['ts'] = zeile.strip()[:120]
                continue
            w = _plausibel(key, roh, wert)
            if w is not None:
                werte[key] = w
                zeilen[key] = zeile.strip()[:120]
    return {'werte': werte, 'zeilen': zeilen}


def _ausfuehren(args, eingabe=None, timeout=60):
    return subprocess.run(args, input=eingabe, capture_output=True, timeout=timeout, check=False)


def text_aus_pdf(daten):
    tmp = tempfile.mkdtemp(prefix='agff-labor-')
    try:
        pfad = os.path.join(tmp, 'b.pdf')
        with open(pfad, 'wb') as fh:
            fh.write(daten)
        r = _ausfuehren(['pdftotext', '-layout', '-l', '6', pfad, '-'])
        text = r.stdout.decode('utf-8', 'replace')
        if len(re.sub(r'\s', '', text)) > 80:
            return text, 'pdf-text'
        # Gescanntes PDF: Seiten rendern und OCR
        _ausfuehren(['pdftoppm', '-r', '300', '-l', '3', '-gray', '-png', pfad, os.path.join(tmp, 's')])
        teile = []
        for f in sorted(os.listdir(tmp)):
            if f.startswith('s') and f.endswith('.png'):
                with open(os.path.join(tmp, f), 'rb') as fh:
                    teile.append(text_aus_bild(fh.read())[0][0])
        return '\n'.join(teile), 'pdf-ocr'
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _grau(bild, max_kante=3600):
    bild = ImageOps.exif_transpose(bild).convert('L')
    lang = max(bild.size)
    f = max_kante / lang if lang > max_kante else (1800 / lang if lang < 1800 else 1)
    if f != 1:
        bild = bild.resize((int(bild.width * f), int(bild.height * f)), Image.LANCZOS)
    return bild


def _schatten_weg(bild, radius):
    """Beleuchtung schätzen (starke Unschärfe) und herausrechnen – entfernt Schatten und Verläufe."""
    hg = np.asarray(bild.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) + 1
    n = np.clip(np.asarray(bild, dtype=np.float32) / hg * 235, 0, 255).astype(np.uint8)
    return ImageOps.autocontrast(Image.fromarray(n), cutoff=2)


def _tesseract(bild, psm, sprachen='deu+fra'):
    buf = io.BytesIO()
    bild.save(buf, format='PNG')
    r = _ausfuehren(['tesseract', 'stdin', 'stdout', '-l', sprachen, '--psm', str(psm)], buf.getvalue(), timeout=90)
    return r.stdout.decode('utf-8', 'replace')


def _drehung(bild):
    """Ausrichtung per Tesseract-OSD; None, wenn unsicher."""
    klein = bild.copy()
    klein.thumbnail((2000, 2000))
    buf = io.BytesIO()
    klein.save(buf, format='PNG')
    r = _ausfuehren(['tesseract', 'stdin', 'stdout', '--psm', '0'], buf.getvalue(), timeout=30)
    m = re.search(r'Rotate:\s*(\d+)', r.stdout.decode('utf-8', 'replace'))
    k = re.search(r'Orientation confidence:\s*([\d.]+)', r.stdout.decode('utf-8', 'replace'))
    if m and k and float(k.group(1)) >= 1.5:
        return int(m.group(1))
    return None


def text_aus_bild(daten):
    """OCR robust für Handyfotos: Schatten entfernen, Ausrichtung bestimmen, mehrere Varianten lesen
    und je Wert die Mehrheit nehmen (verhindert, dass versehentlich der Mittelwert-Spalte gelesen wird)."""
    grau = _grau(Image.open(io.BytesIO(daten)))
    basis = _schatten_weg(grau, 20)
    winkel = _drehung(basis)
    kandidaten = [winkel] if winkel is not None else [0, 270, 90, 180]
    bester = (None, -1, '')
    for w in kandidaten:
        b = basis.rotate(-w, expand=True) if w else basis
        t = _tesseract(b, 6)
        n = len(werte_aus_text(t)['werte'])
        if n > bester[1]:
            bester = (w, n, t)
    w = bester[0] or 0
    texte = [bester[2]]
    for radius, psm in ((40, 4), (30, 6)):
        b = _schatten_weg(grau, radius)
        texte.append(_tesseract(b.rotate(-w, expand=True) if w else b, psm))
    return texte, 'ocr'


def _abstimmen(texte):
    """Mehrheitsentscheid je Parameter über mehrere OCR-Durchläufe."""
    laeufe = [werte_aus_text(t) for t in texte]
    werte, zeilen, sicher = {}, {}, {}
    for key in {k for r in laeufe for k in r['werte']}:
        stimmen = Counter(r['werte'][key] for r in laeufe if key in r['werte'])
        wert, n = stimmen.most_common(1)[0]
        if n == 1 and len(stimmen) > 1:
            wert = laeufe[0]['werte'].get(key, wert)  # Gleichstand: erster (Standard-)Durchlauf
        werte[key] = wert
        zeilen[key] = next((r['zeilen'][key] for r in laeufe if r['werte'].get(key) == wert), '')
        sicher[key] = n >= 2
    return {'werte': werte, 'zeilen': zeilen, 'sicher': sicher}


def lesen(daten, dateiname=''):
    """Einstieg: Bytes eines PDFs oder Bildes → {quelle, werte, zeilen}."""
    if daten[:5] == b'%PDF-' or dateiname.lower().endswith('.pdf'):
        text, quelle = text_aus_pdf(daten)
        out = werte_aus_text(text)
        out['sicher'] = {k: quelle == 'pdf-text' for k in out['werte']}
    else:
        texte, quelle = text_aus_bild(daten)
        out = _abstimmen(texte)
    out['quelle'] = quelle
    return out


if __name__ == '__main__':
    import json
    import sys
    import time
    for p in sys.argv[1:]:
        t = time.time()
        with open(p, 'rb') as fh:
            r = lesen(fh.read(), p)
        print(os.path.basename(p)[:40], r['quelle'], f'{time.time() - t:.1f}s', json.dumps(r['werte'], ensure_ascii=False))
