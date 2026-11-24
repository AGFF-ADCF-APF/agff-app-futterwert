#!/bin/bash
# Datenumzug Futter v2: Flask/SQLite → PHP/MySQL (Tabellen futter_*), mit neuem Server-Schlüssel.
#
#   allinkl/skripte/umzug.sh --lokal          Testdaten (Flask-Referenz des Prüfstands) → PHP des Prüfstands (allinkl/test/start.sh vorher)
#   allinkl/skripte/umzug.sh --dev            Testdaten → dev-app.graswachstum.ch (ohne Einzelfrage erlaubt)
#   allinkl/skripte/umzug.sh --live           Betrieb (apps.graswachstum.ch/futter, Container agff-futterrechner) → app.graswachstum.ch
#   Zusatz: --ersetzen   Zieltabellen vorher leeren (sonst Abbruch, wenn dort schon Daten liegen)
#
# Ablauf: umzug_export.py läuft im Flask-Container (entschlüsselt mit dem alten Schlüssel) und fliesst per Pipe (bei dev/live
# durch SSH) in skripte/umzug.php auf dem Ziel (verschlüsselt mit dem neuen Schlüssel). Keine Zwischendatei, keine Ausgabe
# von Inhalten – nur Anzahlen. Vorher sichert server.php die Zieltabellen (dev/live).
#
# Regeln (~/git/CLAUDE.md): dev bekommt keine Personendaten → dev und lokal nur mit den Testdaten des Prüfstands.
# --live liest die echten Daten aus dem Betrieb auf dem Home-Server (/opt/stacks, nur lesend über docker exec) und schreibt
# auf live: NUR nach Martins ausdrücklichem Ja, das Skript verlangt die Eingabe «live» im Terminal. Claude führt --live nie aus.
set -euo pipefail
ZIEL=ssh-w01573d0@w01573d0.kasserver.com
W=/www/htdocs/w01573d0
PHP=php84
REPO=$(cd "$(dirname "$0")/../.." && pwd)
EXPORT="$REPO/allinkl/skripte/umzug_export.py"
IMPORT="$REPO/allinkl/skripte/umzug.php"

case "${1:-}" in
  --lokal) UMGEBUNG=lokal; QUELLE=futter-port-ref ;;
  --dev) UMGEBUNG=dev; QUELLE=futter-port-ref; APP=$W/apps/futter-dev ;;
  --live) UMGEBUNG=live; QUELLE=agff-futterrechner; APP=$W/apps/futter ;;
  *) echo "Aufruf: $0 --lokal|--dev|--live [--ersetzen]"; exit 1 ;;
esac
shift
ERSETZEN=
for a in "$@"; do
  case "$a" in --ersetzen) ERSETZEN=--ersetzen ;; *) echo "Unbekannt: $a"; exit 1 ;; esac
done

docker inspect -f '{{.State.Running}}' "$QUELLE" 2>/dev/null | grep -q true || { echo "Quelle $QUELLE läuft nicht${UMGEBUNG:+ (Prüfstand: allinkl/test/start.sh)}."; exit 1; }

if [ "$UMGEBUNG" = live ]; then
  [ -t 0 ] || { echo "Abgebrochen: Umzug auf live nur nach ausdrücklichem Ja, die Bestätigung braucht ein Terminal."; exit 1; }
  read -r -p "UMZUG der echten Daten von apps.graswachstum.ch nach LIVE (https://app.graswachstum.ch/futter${ERSETZEN:+, Zieltabellen werden geleert}). Zur Bestätigung «live» eintippen: " antwort
  [ "$antwort" = live ] || { echo "Abgebrochen."; exit 1; }
fi

export_strom() { docker exec -i "$QUELLE" python3 -I - < "$EXPORT"; }

if [ "$UMGEBUNG" = lokal ]; then
  cd "$REPO/allinkl/test"
  docker compose -p futter-port-test cp "$IMPORT" php:/tmp/umzug.php
  export_strom | docker compose -p futter-port-test exec -T -u www-data php php /tmp/umzug.php einspielen $ERSETZEN
  exit
fi

# dev/live: Importskript hochladen (Deploy bringt es auch mit), Zieltabellen sichern, dann einspielen
STEMPEL=$(date +%Y%m%d-%H%M%S)
scp -q "$IMPORT" "$ZIEL:$APP/skripte/umzug.php"
ssh "$ZIEL" "set -e; cd $APP; mkdir -p -m 700 $APP-sicherungen/umzug-$STEMPEL; $PHP skripte/server.php sichern $APP-sicherungen/umzug-$STEMPEL/datenbank.sql.gz"
export_strom | ssh "$ZIEL" "cd $APP && $PHP skripte/umzug.php einspielen $ERSETZEN"
echo "Umzug $UMGEBUNG fertig ($(date)). Sicherung vorher: $APP-sicherungen/umzug-$STEMPEL"
