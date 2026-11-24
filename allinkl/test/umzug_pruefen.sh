#!/bin/bash
# Prüft den Datenumzug lokal: Testdaten in die Flask-Referenz, PHP mit NEUEM Schlüssel, Umzug, gleiche Antworten?
# Voraussetzung: allinkl/test/start.sh (danach ist der PHP-Prüfstand wieder auf dem gemeinsamen Schlüssel).
set -euo pipefail
cd "$(dirname "$0")"
TOK=$(mktemp)
trap 'rm -f "$TOK"; docker compose -p futter-port-test up -d --wait php >/dev/null 2>&1 || true' EXIT
docker exec -i futter-port-ref python3 -I - fuellen < umzug_testdaten.py > "$TOK"
echo "Testdaten in der Flask-Referenz angelegt"
TEST_SERVER_KEY=$(python3 -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())') \
  docker compose -p futter-port-test up -d --wait php >/dev/null 2>&1
echo "PHP läuft mit neuem Schlüssel"
../skripte/umzug.sh --lokal --ersetzen
echo "--- zweiter Lauf ohne --ersetzen muss abbrechen:"
if ../skripte/umzug.sh --lokal 2>&1; then echo "FEHLER: hätte abbrechen müssen"; exit 1; fi
python3 -I umzug_testdaten.py vergleichen "$TOK"
