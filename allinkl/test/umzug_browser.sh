#!/bin/bash
# Browser-Test der Umzugsseite: Flask als alte Adresse (Port 5099, V2_UMZUG_ZIEL), PHP als neue (5097, UMZUG_QUELLE), Playwright.
# Voraussetzung: allinkl/test/start.sh. Danach läuft PHP wieder ohne Umzugsquelle.
set -euo pipefail
cd "$(dirname "$0")"
REPO=$(cd ../.. && pwd)
REF=$(cat /tmp/futter-port-ref.pfad)
trap 'docker rm -f futter-umzug-alt >/dev/null 2>&1 || true; docker compose -p futter-port-test up -d --wait php >/dev/null 2>&1 || true' EXIT
TEST_UMZUG_QUELLE=http://127.0.0.1:5099 docker compose -p futter-port-test up -d --wait php >/dev/null 2>&1
docker rm -f futter-umzug-alt >/dev/null 2>&1 || true
docker run -d --name futter-umzug-alt -p 127.0.0.1:5099:5000 -v "$REPO:/app:ro" -v "$REF:/work" -e PYTHONPATH=/app -e PYTHONDONTWRITEBYTECODE=1 \
  -e V2_SERVER_KEY=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8= -e ADMIN_PASSWORD=x -e V2_DB_PATH=/work/data/v2-umzug.db \
  -e V2_UMZUG_ZIEL=http://127.0.0.1:5097 -w /work futter-futterrechner gunicorn -w 1 -b 0.0.0.0:5000 app:app >/dev/null
for i in $(seq 1 20); do curl -sf http://127.0.0.1:5099/v2/api/umzug >/dev/null && break; sleep 1; done
docker run --rm --network host -v "$PWD:/t:ro" mcr.microsoft.com/playwright/python:v1.49.0-noble \
  sh -c 'pip install -q playwright==1.49.0 2>/dev/null; python3 -I /t/umzug_browser.py'
