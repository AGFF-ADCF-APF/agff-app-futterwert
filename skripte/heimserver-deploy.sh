#!/bin/bash
# Liefert einen Stand aus dem Entwicklungsordner an den Betrieb auf dem Home-Server aus (apps.graswachstum.ch/futter, /wiese).
#
#   Entwicklung: /home/dev/git/agff-app-futterwert   (hier wird gearbeitet und committet)
#   Betrieb:     /opt/stacks/agff-apps/futter         (templates/, static/, data/ sind live eingebunden – dort nie direkt ändern)
#
# Aufruf: skripte/heimserver-deploy.sh [ZWEIG]   (Standard: feature/v2-beta1)
# Ablauf: Betrieb holt den Zweig aus der Entwicklung (Remote «entwicklung») und übernimmt ihn nur per Fast-Forward.
#   Bricht ab, wenn der Betrieb auf einem anderen Zweig steht, dort ungesicherte Änderungen liegen oder er Commits hat,
#   die in der Entwicklung fehlen (dann zuerst in der Entwicklung übernehmen: git fetch betrieb && git merge betrieb/ZWEIG).
#   Python-, Docker- oder Abhängigkeitsänderungen → Container neu bauen; danach Build-Nummer live prüfen.
set -euo pipefail
ENTWICKLUNG=/home/dev/git/agff-app-futterwert
BETRIEB=/opt/stacks/agff-apps/futter
ZWEIG=${1:-feature/v2-beta1}
URL=https://apps.graswachstum.ch/futter/v2/api/config

cd "$BETRIEB"
[ "$(git branch --show-current)" = "$ZWEIG" ] || { echo "Betrieb steht auf $(git branch --show-current), nicht auf $ZWEIG. Abbruch."; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Im Betrieb liegen ungesicherte Änderungen an versionierten Dateien (andere Sitzung?). Abbruch:"; git status --short --untracked-files=no; exit 1
fi
git remote get-url entwicklung >/dev/null 2>&1 || git remote add entwicklung "$ENTWICKLUNG"
git fetch -q entwicklung "$ZWEIG"
ALT=$(git rev-parse HEAD)
NEU=$(git rev-parse "entwicklung/$ZWEIG")
if [ "$ALT" = "$NEU" ]; then echo "Betrieb ist schon auf $(git log -1 --format='%h %s')."; exit 0; fi
if ! git merge-base --is-ancestor "$ALT" "$NEU"; then
  echo "Der Betrieb hat Commits, die in der Entwicklung fehlen:"; git log --oneline "$NEU..$ALT"
  echo "Zuerst in $ENTWICKLUNG übernehmen: git fetch betrieb && git merge betrieb/$ZWEIG"; exit 1
fi
git merge -q --ff-only "$NEU"
echo "Übernommen: $(git log --oneline "$ALT..$NEU" | wc -l) Commit(s), jetzt $(git log -1 --format='%h %s')"
if git diff --name-only "$ALT" "$NEU" | grep -qE '(\.py$|^requirements\.txt$|^Dockerfile$|^docker-compose\.yml$)'; then
  echo "Python/Docker geändert: Container neu bauen …"
  docker compose up -d --build futterrechner
fi
SOLL=$(grep -oP "^ASSET_BUILD = '\K[^']+" v2_api.py)
for i in $(seq 1 30); do
  IST=$(curl -s --max-time 5 "$URL" | grep -oP '"build":"\K[^"]+' || true)
  [ "$IST" = "$SOLL" ] && { echo "Live: Build $IST"; exit 0; }
  sleep 2
done
echo "Achtung: live meldet Build «$IST», erwartet «$SOLL»."; exit 1
