#!/bin/bash
# Baut das Paket, startet PHP+MariaDB (Port 5097) und die Flask-Referenz (Port 5098) mit gleichen Testwerten.
set -euo pipefail
cd "$(dirname "$0")"
REPO=$(cd ../.. && pwd)
CSV=${FUTTERWERTE_CSV:-/opt/stacks/agff-apps/futter/data/futterwerte.csv}
docker run --rm -u "$(id -u):$(id -g)" -v "$REPO:/src" -v "$CSV:/csv/futterwerte.csv:ro" -w /src futter-futterrechner \
  python3 -I allinkl/werkzeuge/bauen.py /src allinkl/_bau /csv/futterwerte.csv
docker compose -p futter-port-test down -v >/dev/null 2>&1 || true
docker compose -p futter-port-test up -d --build --wait
docker compose -p futter-port-test exec -T db sh -c 'mariadb -ufutter -pfutter-test futter' < ../schema.sql
# Flask-Referenz: derselbe Code aus dem Arbeitsordner, Daten in einem Wegwerf-Ordner
REF=$(mktemp -d); mkdir -p "$REF/data"; cp "$CSV" "$REF/data/"; chmod -R 777 "$REF"
docker rm -f futter-port-ref >/dev/null 2>&1 || true
docker run -d --name futter-port-ref -p 127.0.0.1:5098:5000 -v "$REPO:/app:ro" -v "$REF:/work" -e PYTHONPATH=/app -e PYTHONDONTWRITEBYTECODE=1 \
  -e V2_SERVER_KEY=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8= -e ADMIN_PASSWORD=test-admin-passwort \
  -e V2_MAIL_DRYRUN=1 -e V2_MAIL_DRYRUN_FILE=/work/data/mail.jsonl -e V2_DB_PATH=/work/data/v2.db -e AGFF_TEMPLATE_AUTO_RELOAD=0 \
  -w /work futter-futterrechner gunicorn -w 1 -b 0.0.0.0:5000 app:app >/dev/null
echo "$REF" > /tmp/futter-port-ref.pfad
echo "PHP:   http://127.0.0.1:5097/futter/   Flask: http://127.0.0.1:5098/v2/   (Referenzdaten $REF)"
