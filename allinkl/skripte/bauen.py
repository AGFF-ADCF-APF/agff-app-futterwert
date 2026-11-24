"""Baut das Paket für all-inkl aus dem Repository (läuft im Futter-Image, braucht Flask/Jinja2 und v2_api).

    docker run --rm -v <repo>:/src -v <futterwerte.csv>:/csv/futterwerte.csv:ro -w /src futter-futterrechner \
        python3 -I allinkl/skripte/bauen.py /src allinkl/_bau /csv/futterwerte.csv

Ergebnis (Ziel-Ordner, wird vorher geleert):
    lib/        PHP-Code (ausserhalb der Dokumentenwurzel)
    public/     index.php, .htaccess und assets/ (= static/v2)
    seiten/     vorgerenderte Seiten (index, index-wiese, datenschutz, datenschutz-wiese, admin), basis.json, build.txt
    schema.sql
Die Seiten werden mit denselben Vorlagen (templates/v2) und Werten wie in Flask gerendert, damit nichts doppelt gepflegt wird.
"""
import json
import os
import re
import shutil
import sys

src, ziel, csv_pfad = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, src)
os.chdir(src)

import v2_api  # noqa: E402  (Konstanten und load_basis aus derselben Quelle wie Flask)
from jinja2 import Environment, FileSystemLoader, select_autoescape  # noqa: E402

ziel = os.path.abspath(ziel)
if os.path.exists(ziel):
    shutil.rmtree(ziel)
os.makedirs(os.path.join(ziel, 'seiten'))
shutil.copytree(os.path.join(src, 'allinkl', 'lib'), os.path.join(ziel, 'lib'))
shutil.copytree(os.path.join(src, 'allinkl', 'public'), os.path.join(ziel, 'public'))
shutil.copytree(os.path.join(src, 'static', 'v2'), os.path.join(ziel, 'public', 'assets'))
shutil.copy(os.path.join(src, 'allinkl', 'schema.sql'), ziel)

# Build-Nummer: aus v2_api (muss mit ?v= in index.html und sw.js übereinstimmen)
build = v2_api.ASSET_BUILD
idx = open(os.path.join(src, 'templates', 'v2', 'index.html'), encoding='utf-8').read()
sw = open(os.path.join(src, 'static', 'v2', 'sw.js'), encoding='utf-8').read()
falsch = {v for v in re.findall(r'\?v=(b\d+-\d+)', idx + sw) if v != build}
if falsch:
    sys.exit(f'Build-Nummern uneinheitlich: ASSET_BUILD={build}, gefunden {sorted(falsch)}')
open(os.path.join(ziel, 'seiten', 'build.txt'), 'w').write(build + '\n')

env = Environment(loader=FileSystemLoader(os.path.join(src, 'templates')), autoescape=select_autoescape(['html']))
werte = dict(consent_version=v2_api.CONSENT_VERSION, retention_days=v2_api.RETENTION_DAYS, privacy_url=v2_api.PRIVACY_URL,
             # all-inkl: Futter unter /futter/, die Wiese ist in Pratum aufgegangen (/wiese/ leitet dorthin weiter)
             futter_url='/futter/', wiese_url='/pratum/')
for name, vorlage in (('index', 'v2/index.html'), ('datenschutz', 'v2/datenschutz.html')):
    for modus, endung in (('', ''), ('wiese', '-wiese')):
        html = env.get_template(vorlage).render(modus=modus, **werte)
        open(os.path.join(ziel, 'seiten', name + endung + '.html'), 'w', encoding='utf-8').write(html)
open(os.path.join(ziel, 'seiten', 'admin.html'), 'w', encoding='utf-8').write(env.get_template('v2/admin.html').render())

# Nährwert-Basis wie /v2/api/basis
v2_api.CSV_PATH = csv_pfad
basis = {'quelle': 'Agroscope Fütterungsempfehlungen (futterwerte.csv)', 'tabelle': v2_api.load_basis()}
open(os.path.join(ziel, 'seiten', 'basis.json'), 'w', encoding='utf-8').write(json.dumps(basis, sort_keys=True, separators=(',', ':')))

# Lokale Konfiguration nie mitnehmen
for p in ('konfig.php',):
    if os.path.exists(os.path.join(ziel, p)):
        os.remove(os.path.join(ziel, p))
print(f'Gebaut: {ziel} (Build {build})')
