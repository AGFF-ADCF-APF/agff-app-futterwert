# AGFF Futter-App (Futterwert) – v1 und v2

Web-App der AGFF zur Beurteilung von Raufutter (Dürrfutter, Gras- und Maissilage) nach den AGFF-Merkblättern K3a–c, mit Nährwertschätzung, Rationscheck und weiteren Unter-Apps.

| Adresse | Inhalt |
|---|---|
| `https://apps.graswachstum.ch/futter/` | v1 (bisherige App) |
| `https://apps.graswachstum.ch/futter/v2/` | v2 (Beta), ersetzt v1 beim Go-live |
| `https://apps.graswachstum.ch/wiese/` | dieselbe v2 im Modus «Wiese» (gleicher Container) |

Die Entwicklung von v2 läuft auf dem Branch **`feature/v2-beta1`**. `main` enthält nur v1.

> Dieses Repository ist **öffentlich**. Es dürfen keine Geheimnisse (`.env`, Schlüssel, Passwörter), Datenbanken oder Nutzerdaten eingecheckt werden. `data/` und `.env` sind in `.gitignore`.

## Grundsätze v2

- **Daten bleiben im Browser** (localStorage/IndexedDB). Der Server erhält Daten nur nach ausdrücklicher Zustimmung (Kurse, Team-Freigaben, Konto-Speicherung, anonyme Beiträge, Texterkennung von Laborberichten).
- **Sicherheit vor Komfort**: keine Tracker, keine Fremd-CDNs, strenge CSP (keine Inline-Scripts), E-Mail-Adressen nur verschlüsselt (AES-GCM) bzw. gehasht (HMAC) in der Datenbank.
- **Keine KI**: Hilfen, Assistent «Traktor», Pflanzenbestimmung und Beratung arbeiten mit festen, fachlich geprüften Texten.
- **Fachgrundlagen**: AGFF-Merkblätter (K3a/b/c, MB03, MB08), Agroscope Grünes Buch (Nährwerte, Verzehr), Fuplan (Verzehrsschätzungen).
- Sprachen: Deutsch; Teile auf Französisch/Italienisch. Neue Unter-Apps zuerst nur Deutsch.

## Unter-Apps und Module (v2)

Single-Page-App ohne Build-Schritt, Hash-Routen (`#/…`) in `static/v2/app.js`.

| Route | Datei | Zweck |
|---|---|---|
| `#/` , `#/a/…`, `#/p/…` | `app.js`, `k3.js`, `wheel.js` | Anlässe und Proben erfassen, Beurteilung nach K3a–c (Rad), Ergebnis, PDF |
| `#/bilanz` | `bilanz.js` | Rationscheck Energie & Protein (Orientierung) |
| `#/knappheit` | `knappheit.js` | **Futterknappheit – lohnt sich der Futterzukauf?** (Beta, siehe unten) |
| `#/labor` | `ocr.js`, `laborauswertung.js`, `laborregeln.js`, `naehrwert.js` | Laborbericht lesen, auswerten, mit Schätzung vergleichen |
| `#/wiese`, `#/aufnahmen`, `#/fotopunkte` | `wiese.js`, `aufnahme.js`, `konservierbarkeit.js` | Wiese mit Kamera, Wiesenaufnahme nach MB08, Fotopunkte |
| `#/pflanzen` | `pflanzen.js` | Pflanzen bestimmen nach AGFF-Schlüsseln |
| `#/schweiz`, `#/daten` | `schweiz.js`, `statistik.js` | anonyme Beiträge, regionaler Vergleich (ab 5 Beiträgen) |
| `#/pool` | `pool.js`, `auswahl.js` | Musterproben-Pool, Auswahl für PDF-Export |
| `#/hilfe`, `#/texte` | `assistent*.js`, `beratung.js`, `textpruefung.js` | Hilfe, Prüfseite der Texte für Fachleute |
| Kurse/Konto | `kurs.js`, `konto.js`, `crypto.js` | Kursmodus, Konto per E-Mail-Code, Zugangs-Links |
| `/v2/admin` | `admin.js`, `templates/v2/admin.html` | Freischaltung Kursleitung, Pool, Speicher |

Weitere: `io.js` (Ein-/Ausgabe, PDF mit QR-Code, v1-Übernahme), `model.js` (Validierung, Schutzklassen), `foto.js`, `sammel.js`, `tastatur.js`, `boot.js`, `sw.js` (Service Worker, offline).

Server (Flask-Blueprint, Python): `v2_api.py` (Seiten, Assets, Freigaben), `v2_konto.py`, `v2_kurs.py`, `v2_pool.py`, `v2_statistik.py`, `v2_labor.py` (+ `labor_parser.py`, `labor_bericht.py`), `v2_mail.py`, `v2_admin.py`, `v2_zentral.py` (zentrale Anmeldung über graswachstum.ch). v1 liegt in `app.py` und `templates/*.html`.

### Futterknappheit (`#/knappheit`)

Entscheidungshilfe nach dem INFORAMA-Merkblatt von A. Häberli («Futterknappheit in der Winterfütterung») in fünf Schritten:

1. **Herde und Zeitraum** – tierartneutral (Milchkuh, Mutterkuh, Aufzucht, Mast, Ziegen, Schafe, Pferde). Verzehr nach **Fuplan**, Vergleich mit dem **Grünen Buch** wo vorhanden; Mutterkuh, Pferd und Stroh sind als *Richtwert* gekennzeichnet (fachlich noch zu prüfen).
2. **Vorrat** – Heu, Silage, Ballen mit Raumgewichten aus Fuplan → Fehlmenge und Reichweite.
3. **Angebote** – Paritätspreis (Energie bzw. Energie + Protein gegenüber Referenzfuttern), Bewertung günstig / an der Parität / zu teuer.
4. **Massnahmen** – Strecken (z. B. Galtkühe/Jungvieh mit Stroh + Ergänzung), Abstocken, Verstellen.
5. **Vergleich** – alles zukaufen / eigener Plan / günstigste Reihenfolge; PDF-Export.

Daten: nur im Browser (`localStorage`, Schlüssel `agffV2Knappheit`). Offen: Richtwerte prüfen; Rationsvarianten im Rationscheck.

### Mediathek (`#/mediathek`, gemeinsam mit Heureka und drywatch)

Eine Videoliste für alle AGFF-Apps. Gepflegt wird nur `static/v2/mediathek.json`. Heureka (`lernen.html#videos`) und drywatch (Dialog «Info & Wissen») laden `mediathek.js`, `mediathek.css` und die Liste über `/futter/v2/assets/` vom selben Host, ohne eigene Kopie.

- Videos werden **nicht eingebettet**: Jede Karte ist ein Link, der das Video beim Anbieter in einem neuen Tab öffnet. Es kommen keine Drittinhalte in die Apps, und die CSP bleibt unverändert.
- Neuer Eintrag: `id`, `titel`, `url` (nur https), `quelle`, `anbieter`, `sprache`, `dauer`, `datum`, `verfuegbarBis` (danach ausgeblendet, wichtig bei ARD/SRF), `beschreibung` (eigene Worte), `themen` (Schlüssel aus `themenNamen`), optional `apps`.
- Einbinden in einer weiteren Seite: `<div data-agff-mediathek data-app="…" data-themen="heu,anwelken" data-filter></div>` plus Skript und CSS (siehe Kopf von `mediathek.js`).
- Eine Änderung nur an der Liste braucht keinen Neubau. Nach dem Speichern gilt sie sofort in allen drei Apps (in Heureka wegen des Offline-Caches spätestens beim zweiten Aufruf).

## Betrieb

Docker-Stack hinter Traefik (`docker-compose.yml`). Die App läuft mit gunicorn auf Port 5000; Traefik entfernt `/futter` und bildet `/wiese/…` auf `/v2/…` ab (Kopfzeile `X-AGFF-Modus: wiese`).

```bash
cp .env.example .env              # Werte eintragen, nie committen
docker compose up -d --build futterrechner
```

- `templates/`, `static/` und `data/` sind als Volumes eingebunden: Änderungen daran sind **sofort live**.
- Python-Dateien sind ins Image kopiert: nach Änderungen `docker compose up -d --build futterrechner`.
- `data/` (nicht im Repo) braucht mindestens `futterwerte.csv` (Agroscope-Nährwerttabelle) und `Rohdaten_Maschinen_Cleaned.csv`. Datenbanken (`database.db` v1, `v2.db`), Fotos und Laborberichte entstehen dort.
- Umgebungsvariablen: siehe `.env.example` (Admin-Passwort, SMTP, `V2_SERVER_KEY`, Kursleitung, Admin-Anmeldung mit dem AGFF-Konto).
- Admin-Anmeldung: AGFF-Konto über graswachstum.ch (SSO, Ed25519, Recht `futter.admin`, starke Anmeldung), `v2_zentral.py`; Einrichtung auf der Anbieterseite: `docs/sso-futter-anbieter.md`; Prüfungen: `tests/test_sso.py`. Rückfallebene: Admin-Passwort.

### Build-Nummer (v2)

Bei jeder Änderung an v2-Assets die Build-Nummer (z. B. `b1-85`) **überall gleich** erhöhen, sonst sehen Nutzer alte Dateien aus dem Cache:

- alle `?v=` in `templates/v2/index.html`, `admin.html`, `datenschutz.html`
- `SHELL`-Liste in `static/v2/sw.js` (neue Dateien dort ergänzen)
- `ASSET_BUILD` in `v2_api.py` (danach Image neu bauen)

Die App vergleicht ihren Build mit `/v2/api/config` und bietet bei Abweichung ein Update an.

## Mitwirken

- Commits auf Deutsch, mit Build-Nummer im Titel (z. B. `v2 Futter: …; Build b1-85`).
- Neue Unter-App: Route in `parseHash()` und `SEITEN` (`app.js`), Script in `index.html` und `sw.js`, Eintrag in der Navigation.
- Fachliche Werte immer mit Quelle im Code kommentieren; nicht belegte Werte als Richtwert kennzeichnen.
- Sicherheits- oder Datenschutzfragen: siehe [SECURITY.md](SECURITY.md).
