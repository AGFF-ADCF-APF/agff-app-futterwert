# Portierungsplan: Futter v2 auf all-inkl.com (PHP + MySQL)

Stand: 23.11.2026 (Build b1-91). Ziel: v2 (inkl. Modus «Wiese») läuft auf dem Webhosting von all-inkl
unter **`app.graswachstum.ch/futter`** (wie Heureka unter `app.graswachstum.ch/heureka`) neben den anderen Apps, mit MySQL statt SQLite. Der Home-Server bleibt nur noch für die
Texterkennung (OCR) und als Rückfallebene.

## 1. Ausgangslage

| Teil | Umfang | Was passiert |
|---|---|---|
| Browser-App (`static/v2/*.js`, CSS, Bilder, PDFs, Vendor: pdf.js, Tesseract.js, jsPDF) | ~13 200 Zeilen JS | **unverändert** übernehmen (statische Dateien) |
| Seiten (`templates/v2/index.html`, `admin.html`, `datenschutz.html`) | 3 Jinja-Vorlagen | in PHP-Vorlagen umschreiben (wenige Platzhalter) |
| Server-API (`v2_*.py`) | ~3 500 Zeilen Python, **88 API-Schnittstellen** (98 Routen inkl. Seiten), 23 Tabellen | **neu in PHP** (gleiche Adressen, gleiche Antworten) |
| Texterkennung (`v2_labor.py`, `labor_parser.py`, `labor_bericht.py`) | ~530 Zeilen, braucht Tesseract + pdftotext | bleibt auf dem Home-Server bzw. wandert in den Browser (Abschnitt 5) |
| Daten | `v2.db` 244 KB, Fotos 1,3 MB | Einmal-Migration (Skript) |

Warum PHP: Das Webhosting von all-inkl bietet Python nur als CGI (ein Prozess je Anfrage, kein
dauerhafter Flask-Server, keine Systempakete). PHP + MySQL ist dort der tragfähige Weg.

## 2. Vorab klären (Phase 0, ½ Tag, im KAS-Panel bzw. per SSH)

- [x] **Adresse entschieden:** `app.graswachstum.ch/futter` (Wiese: `app.graswachstum.ch/wiese`). Neuer Ursprung → Umzug der Browserdaten nötig (Abschnitt 4).
- [ ] PHP-Version ≥ 8.2, Erweiterungen: `openssl` (AES-256-GCM), `pdo_mysql`, `mbstring`, `json`, `fileinfo`
- [ ] MySQL/MariaDB-Version; eigene Datenbank für Futter v2 (nicht mit anderen Apps teilen)
- [ ] `upload_max_filesize` / `post_max_size` ≥ 13 MB (Laborberichte 12 MB, Fotos 5 MB), `max_execution_time`, `memory_limit`
- [ ] `.htaccess`: `mod_rewrite`, `mod_headers` (CSP und Sicherheits-Header), Ausschluss von Verzeichnissen
- [ ] Speicherplatz für Fotos (heute Limit 5 000 MB gesamt, 20 MB je Person und Anlass)
- [ ] Cronjob (KAS, per HTTP) für Aufräumen (abgelaufene Codes, Sitzungen, Aufbewahrungsfrist)
- [ ] SMTP über das all-inkl-Postfach (heute SMTP_SSL Port 465)
- [ ] Sind `exec`/`proc_open` erlaubt? (nur für den OCR-Versuch in Abschnitt 5.3)
- [ ] Konfiguration ausserhalb des Web-Verzeichnisses ablegbar (Schlüssel, Passwörter)?

## 3. Umsetzung in Phasen

### Phase 1 – Prüfstand zuerst (2 Tage)
Bevor PHP geschrieben wird: eine **Testsammlung gegen die heutige Flask-API** (Python oder
Playwright), die jede Schnittstelle mit gültigen, ungültigen und bösartigen Eingaben aufruft und die
Antworten festhält (Statuscode, JSON-Form, Fehlercodes, Grenzwerte, Anfragebegrenzung). Dieselbe
Sammlung läuft später gegen PHP. So bleibt das Verhalten – vor allem die Sicherheitsprüfungen –
nachweislich gleich. Dazu die bestehenden Browser-Tests (Playwright) für die Hauptwege.

### Phase 2 – PHP-Gerüst (2 Tage)
- Ein Einstieg `index.php` mit kleinem Router (keine grosse Bibliothek), `.htaccess` leitet `/v2/…` dorthin.
- Gemeinsame Bausteine, 1:1 zum Python-Vorbild:
  - Sicherheits-Header (CSP wie in `v2_api.py`, HSTS, COOP, CORP, `no-store` für die API)
  - JSON-Ein-/Ausgabe mit Grössenlimits, Inhaltsprüfung (`_scalar_ok`, Feldlisten)
  - **Krypto**: AES-256-GCM mit `V2_SERVER_KEY` (`openssl_encrypt`, Format Nonce‖Chiffre‖Tag, base64url),
    HMAC-SHA256 für E-Mail-Suche, SHA-256-Token-Hashes, `hash_equals` – **kompatibel**, damit migrierte Daten lesbar bleiben
  - Anfragebegrenzung: statt Arbeitsspeicher eine MySQL-Tabelle (Schlüssel = gehashte IP + Zweck, Zeitfenster)
  - Gleichzeitigkeit: Transaktionen/`SELECT … FOR UPDATE` statt Python-Locks
  - E-Mail: SMTP (PHPMailer, einzige Fremdbibliothek, per Composer lokal gebaut und hochgeladen)
- Konfiguration in `config.php` ausserhalb des Web-Verzeichnisses (gleiche Namen wie `.env`).

### Phase 3 – Module portieren (6–8 Tage), in dieser Reihenfolge
1. Seiten, Assets, `api/config`, `api/basis` (Nährwerttabelle aus `futterwerte.csv`), Service Worker, Manifest, Modus «Wiese»
2. Rückmeldung, anonyme Beiträge/Statistik (inkl. Quantile, k-Anonymität ab 5)
3. Freigaben (Spaces, Records, Fotos, Beitritt, Rotation)
4. E-Mail-Codes (`v2_mail`) und Konto/Cloud-Speicherung (`v2_konto`, inkl. Kontingente)
5. Kursmodus (`v2_kurs`, grösstes Modul: Beitritt, Zustimmung, Beurteilungen, Fotos, Etiketten)
6. Probenpool (öffentlich und für Kursleitende)
7. Administration und zentrale Anmeldung über graswachstum.ch (JWT HS256, Nonce, Einmaligkeit; Admin-Passwort als Rückfall)

Jedes Modul ist erst fertig, wenn der Prüfstand aus Phase 1 dafür grün ist.

### Phase 4 – Texterkennung (2–3 Tage), siehe Abschnitt 5

### Phase 5 – Daten und Umschaltung (1–2 Tage)
- Migrationsskript SQLite → MySQL (Tabellen 1:1, Verschlüsselung bleibt), Fotos per SFTP.
- Generalprobe auf einer Test-Adresse mit Kopie der Daten; du testest Kurs, Konto, Mail, Pool, Admin.
- Umschalten (DNS bzw. Weiterleitung), Home-Server-Version 2 Wochen als Rückweg bereithalten (nur lesend).

**Summe: ca. 16–20 Arbeitstage** (inkl. Umzugsseite) Entwicklung, plus deine Testzeit. Grösste Unsicherheit: Kursmodus und
Konto (viele Sonderfälle).

## 4. Umzug der Browserdaten (neue Adresse `app.graswachstum.ch`)

Proben, Anlässe und Fotos liegen im Browser (`localStorage`, IndexedDB) – und zwar **pro Adresse
(Ursprung)**. Unter `app.graswachstum.ch` sieht der Browser zuerst eine **leere App**; installierte
Apps (PWA) zeigen weiter auf `apps.graswachstum.ch`. Darum (Phase 5, ca. 2 Tage zusätzlich):

1. **Umzugsseite auf der alten Adresse** (`apps.graswachstum.ch/futter/v2/`, bleibt auf dem Home-Server):
   Hinweis «Die App ist umgezogen», Knopf «Meine Daten mitnehmen». Die alte Seite öffnet die neue in
   einem Fenster und übergibt Anlässe, Proben, Einstellungen und Fotos per `postMessage` – nur an den
   festen Ursprung `https://app.graswachstum.ch`, mit Bestätigung auf der neuen Seite. Nichts geht
   über einen Server.
2. Die neue App übernimmt die Daten wie beim bestehenden JSON-Import (gleiche Prüfung durch `model.js`,
   bei gleicher ID gewinnt der neuere Stand) und meldet die Anzahl übernommener Proben und Fotos.
3. Rückfall: Auf der alten Seite bleibt der JSON-/PDF-Export, auf der neuen der Import.
4. Die alte Adresse leitet nach erfolgreichem Umzug (gemerkt im Browser) künftig direkt weiter;
   installierte Apps zeigen einen Hinweis zum Neu-Installieren.
5. Kurs-, Freigabe- und Zugangs-Links mit der alten Adresse leiten weiter (Pfad und `#…` bleiben erhalten),
   QR-Etiketten bleiben damit gültig. Die alte Adresse darum mindestens ein Jahr bestehen lassen.

Server-seitige Daten (Kurse, Konten, Freigaben, Pool) ziehen mit der Datenbank ohne Zutun mit.

## 5. Texterkennung (OCR)

### 5.1 Heute
- «Laborbericht lesen»: Server (Tesseract/pdftotext) **oder** «Auf meinem Gerät» (Tesseract.js, pdf.js).
- «Laboranalyse auswerten» (Prüfbericht mit mehreren Proben): **nur Server** (`labor_bericht.py`, pdftotext mit Layout).

### 5.2 Ziel
1. **Text-PDFs im Browser lesen** (die meisten Laborberichte): `labor_bericht.py` und den PDF-Teil von
   `labor_parser.py` nach JavaScript übertragen und mit pdf.js (schon in der App) auslesen. Kein Server,
   nichts verlässt das Gerät. Die Positionsdaten von pdf.js ersetzen `pdftotext -layout`; mit den
   UFAG-Musterberichten gegen die Python-Fassung prüfen.
2. **Fotos und gescannte PDFs**: weiterhin **direkt vom Browser an den Home-Server** in einem eigenen,
   schlanken Container `ocr` (nur `/labor/lesen`, `/labor/bericht`, `/labor/config`), z. B. unter
   `ocr.graswachstum.ch`:
   - CORS nur für die App-Adresse, keine Cookies, Zustimmung und Grenzen wie heute, nichts gespeichert
   - CSP der App: `connect-src 'self' https://ocr.graswachstum.ch`
   - Zeitlimit im Browser (z. B. 25 s); ist der Home-Server nicht erreichbar → Hinweis und Wechsel auf
     «Auf meinem Gerät». **Der Rest der App wartet nie auf den Home-Server.**
   - **Nicht** über PHP auf all-inkl weiterleiten (würde dort je Anfrage bis 30 s einen Prozess belegen).
   - Datenschutzerklärung: Standort der Verarbeitung (Home-Server, Schweiz) ergänzen.

### 5.3 Könnte die Texterkennung direkt auf all-inkl laufen?
- **Text-PDFs: ja.** Entweder im Browser (5.2, empfohlen) oder serverseitig mit einer reinen
  PHP-Bibliothek (z. B. `smalot/pdfparser`), ohne Systemprogramme.
- **Fotos/Scans: nur als Versuch, nicht als Grundlage.** Tesseract ist auf dem Webhosting nicht
  installiert und lässt sich nicht als Paket nachinstallieren. Denkbar wäre, ein **statisch gebautes
  Tesseract** (x86_64, ~30–40 MB mit deutschen und französischen Sprachdaten) in den Webspace zu laden
  und per `proc_open` aufzurufen. Haken:
  - `exec`/`proc_open` sind bei Shared Hosting teils gesperrt (Phase 0 prüfen)
  - ein Foto braucht 5–20 s volle CPU; Shared Hosting begrenzt Laufzeit, Speicher und Prozesse und
    teilt die CPU mit den anderen Apps – bei mehreren Anfragen (Kurs mit 20 Personen) bremst das spürbar
  - Bildvorbereitung (Schatten, Drehung) heute mit Pillow/numpy müsste nach PHP (GD/Imagick)
  - Aufwand ca. 2–3 Tage zusätzlich, Ergebnis unsicher
- **Alternative ohne Server:** Tesseract.js «Auf meinem Gerät» gibt es schon; es ist bei schrägen
  Handyfotos etwas schwächer. Mit der Flächen-Aufhellung (b1-87) und der Bildvorbereitung im Browser
  lässt sich der Abstand weiter verkleinern.

**Empfehlung:** Text-PDFs in den Browser (5.2.1), Fotos an den Home-Server mit Gerät als Rückfall
(5.2.2). Den Tesseract-Versuch auf all-inkl nur machen, falls der Home-Server ganz wegfallen soll.

## 6. Was verloren ginge – und wie nicht

| Funktion | Ohne Massnahme | Mit diesem Plan |
|---|---|---|
| Alle Browser-Funktionen | bleibt | bleibt |
| Kurse, Konto, Freigaben, Pool, Statistik, Rückmeldung, Admin | weg | portiert (Phase 3) |
| Laborbericht lesen (Server) | weg | Text-PDF im Browser, Fotos über Home-Server, Rückfall Gerät |
| Laboranalyse auswerten | weg | Text-PDF im Browser, Scans über Home-Server |
| Daten im Browser | unter der neuen Adresse zuerst leer | Umzugsseite (Abschnitt 4) |
| Anfragebegrenzung im Speicher | – | MySQL-Tabelle |

## 7. Sicherheit (Vorrang)
- Gleiche CSP und Header wie heute; `.htaccess` sperrt alles ausser `index.php` und `assets/`.
- Keine Fremd-CDNs; PHPMailer als einzige Bibliothek, Version festgehalten.
- Schlüssel und Passwörter nur in `config.php` ausserhalb des Web-Verzeichnisses, nie im Repository.
- Eigene MySQL-Datenbank und eigener Benutzer nur für Futter v2.
- Prüfstand (Phase 1) enthält Angriffsfälle: zu grosse Eingaben, falsche Token, Raten von Codes, fremde Kurs-/Space-IDs, Pfad-Tricks bei Foto-IDs.
- Nach der Umschaltung: Sicherheitsprüfung des PHP-Codes (Review) vor der Freigabe für Kurse.

## 8. Offene Entscheidungen
1. ~~Adresse~~ → entschieden: `app.graswachstum.ch/futter` (Umzugsseite nötig).
2. Soll v1 mitziehen (nur statisch/archiviert) oder bis zum Go-live auf dem Home-Server bleiben?
3. OCR: Home-Server als Dienst behalten (empfohlen) oder Versuch mit Tesseract auf all-inkl?
4. Alternative ohne Neuschreiben: kleiner VPS bzw. Managed Server mit Docker – weniger Arbeit, aber laufende Kosten und eigene Wartung.
