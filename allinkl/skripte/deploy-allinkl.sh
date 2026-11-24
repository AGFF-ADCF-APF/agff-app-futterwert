#!/bin/bash
# Deploy von Futter v2 (PHP/MySQL) nach all-inkl (KAS) über SSH. Muster: ~/git/agff-app-pratum/werkzeuge/deploy-allinkl.sh.
#
# Aufbau auf dem Server: Code ausserhalb der Dokumentenwurzel, in der Dokumentenwurzel nur zwei Symlinks auf public/
# (/futter und /wiese sind dieselbe App, der Modus kommt aus dem Pfad):
#   dev:  https://dev-app.graswachstum.ch/futter und /wiese    Code /www/htdocs/w01573d0/apps/futter-dev
#         Dokumentenwurzel /www/htdocs/w01573d0/dev-app.graswachstum.ch, darin futter und wiese -> ../apps/futter-dev/public
#   live: https://app.graswachstum.ch/futter und /wiese        Code /www/htdocs/w01573d0/apps/futter
#         Dokumentenwurzel /www/htdocs/w01573d0/app.graswachstum.ch (öffentlich, ohne Tor)
#   Im Code-Ordner: lib/ public/ seiten/ skripte/ schema.sql (vom Deploy ersetzt), konfig.php und daten/ (Fotos) bleiben.
#   Sicherungen: apps/futter[-dev]-sicherungen/<zeit>/ (Code, konfig.php, Datenbank; die letzten 10).
#
# konfig.php füllt Martin selbst auf dem Server aus (Vorlage allinkl/konfig.example.php, Rechte 600). Dieses Skript liest sie nie;
# skripte/server.php meldet auf dem Server nur, ob etwas fehlt, und spielt das Schema ein (CREATE TABLE IF NOT EXISTS).
#
# Dev: ohne Einzelfrage erlaubt (~/git/CLAUDE.md), mit Sicherung des Dev-Stands. Jede Anfrage unter /futter/ und /wiese/ läuft dort
#   durch das Tor (allinkl/dev/tor.php + .htaccess: nur mit Admin-Anmeldung über das AGFF-Konto). Der Rest der Subdomain dev-app
#   bleibt gesperrt (Block «dev-app-sperre» in der .htaccess der Dokumentenwurzel, freie App-Pfade in .sperre-frei, gemeinsam mit
#   den anderen Apps). Ohne gültigen Block wird auf dev nie deployt.
# Live: NUR nach Martins ausdrücklichem Ja (im Chat) für genau diesen Deploy. Das Skript verlangt dafür den Zusatz --ja
#   (keine Terminal-Eingabe mehr, Entscheid Martin 24.11.2026); ohne --ja bricht es ab. --trocken braucht kein --ja.
#
# Aufruf:
#   allinkl/skripte/deploy-allinkl.sh --dev einrichten     einmalig: Ordner, Symlinks, konfig.php aus der Vorlage (ohne Geheimnisse)
#   allinkl/skripte/deploy-allinkl.sh --dev [--trocken]    Paket aus dem letzten Commit bauen, sichern, hochladen, Schema, prüfen
#   allinkl/skripte/deploy-allinkl.sh --live --ja [einrichten]   bzw.   --live --trocken
#
# Der Code kommt immer aus dem letzten Commit (git archive), nie aus dem Arbeitsordner. Die Nährwert-Basis (seiten/basis.json)
# wird aus futterwerte.csv gebaut: $FUTTERWERTE_CSV oder data/futterwerte.csv im Repo.
set -euo pipefail
ZIEL=ssh-w01573d0@w01573d0.kasserver.com
W=/www/htdocs/w01573d0
PFADE=(futter wiese)
PHP=php84
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=futter-futterrechner   # Bau mit denselben Vorlagen und Werten wie Flask (allinkl/skripte/bauen.py)

case "${1:-}" in
  --dev) UMGEBUNG=dev; HOST=dev-app.graswachstum.ch; APP=$W/apps/futter-dev; shift ;;
  --live) UMGEBUNG=live; HOST=app.graswachstum.ch; APP=$W/apps/futter; shift ;;
  *) echo "Aufruf: $0 --dev|--live [einrichten|--trocken]"; exit 1 ;;
esac
DOCROOT=$W/$HOST
SICHERUNGEN=$APP-sicherungen
AKTION=deploy
JA=
while [ $# -gt 0 ]; do
  case "$1" in
    einrichten|--trocken) AKTION=$1; shift ;;
    --ja) JA=1; shift ;;
    *) echo "Unbekannt: $1"; exit 1 ;;
  esac
done
STEMPEL=$(date +%Y%m%d-%H%M%S)

exec 9>"${TMPDIR:-/tmp}/futter-allinkl-$UMGEBUNG-deploy.lock"
flock -w 600 9

if [ "$UMGEBUNG" = live ] && [ "$AKTION" != --trocken ]; then
  [ -n "$JA" ] || { echo "Abgebrochen: Live-Deploy nur nach Martins ausdrücklichem Ja, dann mit --ja aufrufen."; exit 1; }
  echo "LIVE (https://$HOST/futter und /wiese, $AKTION)"
fi

# --- Sperre von dev-app: gültiger Block in der .htaccess der Dokumentenwurzel? (Ohne Block ist dev offen: nie deployen) ---
sperre_gueltig() {
  ssh "$ZIEL" "awk '/^# BEGIN dev-app-sperre/{s=1} s{print} /^# END dev-app-sperre/{s=0}' $DOCROOT/.htaccess 2>/dev/null" \
    | { b=0; d=0; e=0; while IFS= read -r z; do
          case "$z" in '# BEGIN dev-app-sperre'*) b=1 ;; '# END dev-app-sperre'*) e=1 ;; esac
          case "$z" in *'Require all denied'*) d=1 ;; esac
        done; [ $b = 1 ] && [ $d = 1 ] && [ $e = 1 ]; }
}
if [ "$UMGEBUNG" = dev ] && ! sperre_gueltig; then
  echo "Keine gültige Sperre (Block dev-app-sperre) in $DOCROOT/.htaccess. Abbruch (dev wäre offen)."; exit 1
fi

if [ "$AKTION" = einrichten ]; then
  ssh "$ZIEL" "set -e; test -d $DOCROOT || { echo 'Dokumentenwurzel $DOCROOT fehlt (Subdomain im KAS anlegen)'; exit 1; }
    test ! -e $APP || { echo '$APP gibt es schon'; exit 1; }
    for p in ${PFADE[*]}; do test ! -e $DOCROOT/\$p || { echo \"$DOCROOT/\$p gibt es schon\"; exit 1; }; done
    mkdir -p $APP/public
    mkdir -p -m 700 $APP/daten $SICHERUNGEN
    for p in ${PFADE[*]}; do ln -s ../apps/$(basename $APP)/public $DOCROOT/\$p; done"
  # Vorlage ohne Geheimnisse; Martin trägt die Werte auf dem Server selbst ein
  scp -q "$REPO/allinkl/konfig.example.php" "$ZIEL:$APP/konfig.php"
  ssh "$ZIEL" "chmod 600 $APP/konfig.php"
  echo "Eingerichtet: $APP (Code), $DOCROOT/{$(IFS=,; echo "${PFADE[*]}")} -> public/."
  echo "Jetzt $APP/konfig.php auf dem Server ausfüllen (Datenbank aus dem KAS, V2_SERVER_KEY, SMTP_FROM, SSO). Dann: $0 --$UMGEBUNG"
  exit 0
fi

ssh "$ZIEL" "test -d $APP/public && test -f $APP/konfig.php && test -d $APP/daten && for p in ${PFADE[*]}; do test -L $DOCROOT/\$p || exit 1; done" \
  || { echo "Nicht eingerichtet: zuerst $0 --$UMGEBUNG einrichten"; exit 1; }

# --- Paket bauen (aus dem letzten Commit) ---
CSV=${FUTTERWERTE_CSV:-$REPO/data/futterwerte.csv}
[ -f "$CSV" ] || { echo "futterwerte.csv fehlt ($CSV). FUTTERWERTE_CSV setzen."; exit 1; }
BAU=$(mktemp -d)
trap 'rm -rf "$BAU"' EXIT
mkdir -p "$BAU/src"
git -C "$REPO" archive HEAD | tar -x -C "$BAU/src"
COMMIT=$(git -C "$REPO" rev-parse HEAD)
KOMMENTAR="Commit: $(git -C "$REPO" log -1 --format='%h %s')"
[ -z "$(git -C "$REPO" status --porcelain -- allinkl static/v2 templates/v2 v2_api.py)" ] || echo "Hinweis: Arbeitsordner hat Änderungen; deployt wird der letzte Commit."
docker run --rm -u "$(id -u):$(id -g)" -v "$BAU/src:/src:ro" -v "$BAU:/aus" -v "$CSV:/csv/futterwerte.csv:ro" -w /src -e PYTHONDONTWRITEBYTECODE=1 "$IMAGE" \
  python3 -I allinkl/skripte/bauen.py /src /aus/paket /csv/futterwerte.csv
P=$BAU/paket
mkdir -p "$P/skripte"
cp "$BAU/src/allinkl/skripte/server.php" "$BAU/src/allinkl/skripte/umzug.php" "$P/skripte/"
if [ "$UMGEBUNG" = dev ]; then
  # Tor nur auf dev: tor.php und dessen .htaccess ersetzen die .htaccess von public/
  cp "$BAU/src/allinkl/dev/tor.php" "$BAU/src/allinkl/dev/.htaccess" "$P/public/"
else
  ! [ -e "$P/public/tor.php" ] || { echo "public/tor.php darf nicht auf live. Abbruch."; exit 1; }
fi
for f in "$P"/lib/*.php "$P"/public/*.php "$P"/skripte/*.php; do
  docker run --rm -v "$P:/p:ro" php:8.4-cli php -l "/p/${f#"$P"/}" >/dev/null || { echo "Syntaxfehler in ${f#"$P"/}. Abbruch."; exit 1; }
done
[ -s "$P/seiten/index.html" ] && [ -s "$P/seiten/basis.json" ] && [ -s "$P/public/assets/app.js" ] || { echo "Paket unvollständig. Abbruch."; exit 1; }

# --- Sperre-Block für dev: freie App-Pfade aus $DOCROOT/.sperre-frei (+ futter, wiese), Text wie in den anderen Deploy-Skripten ---
SPERRE=""
if [ "$UMGEBUNG" = dev ]; then
  SPERRE="$BAU/sperre-block.txt"
  FREI_LISTE=$( { ssh "$ZIEL" "test -f $DOCROOT/.sperre-frei && cat $DOCROOT/.sperre-frei || true"; printf '%s\n' "${PFADE[@]}"; } | grep -E '^[a-z0-9][a-z0-9-]*$' | sort -u)
  FREI_REGEX=$(echo "$FREI_LISTE" | paste -sd'|')
  { echo "# BEGIN dev-app-sperre (verwaltet von den Deploy-Skripten der Apps, Liste in .sperre-frei)"
    echo "## Testumgebung: Die Apps unter ihrem Pfad schützen sich selbst (Anmeldung mit AGFF-Konto). Alles andere auf"
    echo "## dieser Subdomain ist gesperrt; frei sind nur die Sperrseite und die Zertifikats-Erneuerung."
    echo "## THE_REQUEST statt REQUEST_URI: die Umleitung der Apps auf index.php ändert REQUEST_URI, die Anfragezeile nicht."
    echo "## Punkt-Segmente («/../») in der Anfragezeile sind gesperrt (sonst käme man über /app/../ an den Rest der Subdomain)."
    echo "<If \"%{REQUEST_URI} != '/sperre.html' && (%{THE_REQUEST} !~ m#^[A-Z]+ /(sperre\\.html|\\.well-known/[^ ]*|($FREI_REGEX)(/[^ ]*)?)[ ?]# || %{THE_REQUEST} =~ m#/(\\.|%2e){1,2}(/|%2f|[ ?])#i)\">"
    echo "  Require all denied"
    echo "  ErrorDocument 403 /sperre.html"
    echo "</If>"
    echo "<FilesMatch \"^\\.sperre-\">"
    echo "  Require all denied"
    echo "</FilesMatch>"
    echo "<IfModule mod_headers.c>"
    echo "  Header always set X-Robots-Tag \"noindex, nofollow\""
    echo "</IfModule>"
    echo "# END dev-app-sperre"; } > "$SPERRE"
  echo "$FREI_LISTE" > "$BAU/sperre-frei.txt"
fi

RSYNC=(-az -c --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r)
TEILE=(lib public seiten skripte)
if [ "$AKTION" = --trocken ]; then
  echo "$KOMMENTAR"
  for t in "${TEILE[@]}"; do rsync -n "${RSYNC[@]}" --itemize-changes "$P/$t/" "$ZIEL:$APP/$t/" | grep -v '^\.d' | sed "s#^#$t: #" | head -40 || true; done
  [ -z "$SPERRE" ] || echo "Sperre dev-app: freie Pfade künftig: $(echo "$FREI_LISTE" | paste -sd' ')"
  exit 0
fi

# --- konfig.php auf dem Server vollständig? (nur Namen fehlender Einträge, nie Werte) ---
ssh "$ZIEL" "cd $APP && test -f skripte/server.php" && { ssh "$ZIEL" "cd $APP && $PHP skripte/server.php pruefen" || { echo "Abbruch: konfig.php in $APP ergänzen."; exit 1; }; }

# --- Sicherung des Server-Stands (Code, konfig.php, Datenbank; daten/ mit den Fotos ändert der Deploy nicht) ---
ssh "$ZIEL" "set -euo pipefail; mkdir -p -m 700 $SICHERUNGEN/$STEMPEL; cd $APP
  tar czf $SICHERUNGEN/$STEMPEL/code.tar.gz \$(ls -d lib public seiten skripte schema.sql konfig.php .deploy-commit 2>/dev/null) 2>/dev/null || true
  if [ -f skripte/server.php ]; then $PHP skripte/server.php sichern $SICHERUNGEN/$STEMPEL/datenbank.sql.gz; fi
  chmod -R go-rwx $SICHERUNGEN/$STEMPEL
  ls -1d $SICHERUNGEN/*/ | head -n -10 | xargs -r rm -rf
  echo 'Sicherung: $SICHERUNGEN/$STEMPEL'"

# --- Hochladen (feste Rechte: mktemp legt den Bauordner mit 700 an), Schema einspielen ---
for t in "${TEILE[@]}"; do rsync "${RSYNC[@]}" "$P/$t/" "$ZIEL:$APP/$t/"; done
rsync -a -c --chmod=Fu=rw,Fgo=r "$P/schema.sql" "$ZIEL:$APP/schema.sql"
ssh "$ZIEL" "set -e; cd $APP; $PHP skripte/server.php pruefen; $PHP skripte/server.php schema
  echo '$COMMIT' > .deploy-commit; chmod 644 .deploy-commit; chmod 700 daten
  echo 'Deploy $UMGEBUNG fertig: '\$(date)"

# --- Sperre in die .htaccess der Dokumentenwurzel (nur dev, erst nach dem Hochladen; nur der eigene Block wird ersetzt) ---
if [ -n "$SPERRE" ]; then
  scp -q "$SPERRE" "$ZIEL:$DOCROOT/.sperre-block.tmp"
  scp -q "$BAU/sperre-frei.txt" "$ZIEL:$DOCROOT/.sperre-frei.tmp"
  ssh "$ZIEL" "set -e; cd $DOCROOT; test -f sperre.html || { echo 'sperre.html fehlt (kommt vom Lernherbar-Deploy)'; exit 1; }
    cp -p .htaccess .htaccess.vorher; cp -p .sperre-frei .sperre-frei.vorher 2>/dev/null || true
    awk '/^# BEGIN dev-app-sperre/{s=1} !s{print} /^# END dev-app-sperre/{s=0}' .htaccess > .htaccess.rest
    cat .sperre-block.tmp .htaccess.rest > .htaccess.neu && mv .htaccess.neu .htaccess && rm -f .htaccess.rest .sperre-block.tmp
    mv .sperre-frei.tmp .sperre-frei
    chmod 644 .htaccess .sperre-frei"
fi

# --- Prüfung von aussen ---
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" || true; }
fehler=0
if [ "$UMGEBUNG" = dev ]; then
  for p in "${PFADE[@]}"; do
    tor=$(curl -s --max-time 20 -w '\n%{http_code}' "https://$HOST/$p/" || true)
    c1=${tor##*$'\n'}
    if [ "$c1" = 200 ] && printf '%s' "$tor" | grep -q 'name="futter-tor"'; then echo "/$p/ ohne Sitzung -> 200 Torseite"; else echo "FEHLER /$p/ ohne Sitzung -> $c1 (erwartet Torseite)"; fehler=1; fi
  done
  c2=$(code "https://$HOST/futter/assets/app.js"); c2b=$(code "https://$HOST/futter/api/config"); c2c=$(code -X PUT "https://$HOST/futter/api/statistik/x")
  if [ "$c2$c2b$c2c" = 403403403 ]; then echo "assets, api (GET, PUT) ohne Sitzung -> 403"; else echo "FEHLER ohne Sitzung: app.js $c2, api/config $c2b, PUT $c2c (erwartet 403)"; fehler=1; fi
  c3=$(code "https://$HOST/futter/assets/app.css"); c3b=$(code "https://$HOST/futter/anmelden")
  echo "/futter/assets/app.css -> $c3 (frei für die Anmeldeseiten), /futter/anmelden -> $c3b (302 = AGFF-Login eingerichtet, 503 = SSO noch nicht eingerichtet)"
  [ "$c3" = 200 ] || fehler=1
  c4=$(code --path-as-is "https://$HOST/futter/../"); c4b=$(code --path-as-is "https://$HOST/futter/%2e%2e/%2e%2e/"); c4c=$(code "https://$HOST/futter/tor.php/../../")
  case "$c4$c4b$c4c" in *200*) echo "FEHLER Punkt-Segmente: $c4 $c4b $c4c"; fehler=1 ;; *) echo "/futter/../ -> $c4, %2e%2e -> $c4b (nichts ausgeliefert)" ;; esac
  c5=$(code "https://$HOST/irgendwas"); c5b=$(code "https://$HOST/.sperre-frei")
  if [ "$c5" = 403 ] && [ "$c5b" = 403 ]; then echo "/irgendwas -> 403, /.sperre-frei -> 403 (Sperre)"; else echo "FEHLER Sperre: /irgendwas -> $c5, /.sperre-frei -> $c5b (erwartet 403)"; fehler=1; fi
  for andere in herbar pratum heureka; do
    c6=$(code "https://$HOST/$andere/")
    case "$c6" in 200|302|401) echo "/$andere/ weiterhin erreichbar -> $c6" ;; *) echo "FEHLER /$andere/ -> $c6"; fehler=1 ;; esac
  done
  if [ "$fehler" != 0 ]; then
    ssh "$ZIEL" "cd $DOCROOT && mv .htaccess.vorher .htaccess && { test ! -f .sperre-frei.vorher || mv .sperre-frei.vorher .sperre-frei; }"
    echo "Prüfung fehlgeschlagen: die vorherige .htaccess der Dokumentenwurzel ist wiederhergestellt. Bitte prüfen."; exit 1
  fi
else
  for p in "${PFADE[@]}"; do c1=$(code "https://$HOST/$p/"); echo "https://$HOST/$p/ -> $c1"; [ "$c1" = 200 ] || fehler=1; done
  c2=$(code "https://$HOST/futter/api/config"); echo "api/config -> $c2"; [ "$c2" = 200 ] || fehler=1
  [ "$fehler" = 0 ] || exit 1
fi
echo "$KOMMENTAR"
