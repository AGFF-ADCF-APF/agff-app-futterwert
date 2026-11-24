# Futter v2 auf all-inkl (PHP + MySQL)

Port der Flask-API von Futter v2 nach PHP für `app.graswachstum.ch/futter` (und `/wiese`). Plan und Begründung:
[`docs/PORTIERUNG-ALL-INKL.md`](../docs/PORTIERUNG-ALL-INKL.md). Die Browser-App (`static/v2`, `templates/v2`) bleibt
unverändert und wird beim Bauen übernommen – es gibt keine zweite Kopie.

## Aufbau

```
allinkl/
  lib/            PHP-Code (auf dem Server ausserhalb der Dokumentenwurzel)
    kern.php        Konfiguration, MySQL (PDO), JSON, Sicherheits-Header, Ratenbegrenzung (Tabelle rate_treffer), AES-GCM/HMAC
    seiten.php      Seiten, sw.js, Manifest, api/basis, api/config
    statistik.php   anonyme Beiträge, Vergleich, Schweiz-Übersicht, CSV-Export (Rundung und fsum exakt wie Python)
    rueckmeldung.php  Rückmeldung zur Beta
    sso.php         Admin-Anmeldung mit dem AGFF-Konto (Ed25519 über sodium), admin_ok()
    mail.php        Einmal-Codes, Versand über mail() (Testmodus: V2_MAIL_DRYRUN_FILE wie in Flask)
    konto.php       Konto: Anmeldung per Code/Link, Geräte, Cloud-Daten je App, Fotos, Antrag auf mehr Foto-Speicher
    spaces.php      Freigaben: Datensätze, Fotos, Links erneuern, Gruppen-Beitritt per Code
    kurs.php        Kurse: Anlegen/Aktivieren, Beitritt, Etiketten, Ersterfassung, Beurteilungen, Fotos, «Meine Kurse»
    pool.php        Probenpool der Kursleitenden, öffentliche Sammlungen, Übernahme in Kurse
    admin.php       Kursleitung (Status, Antrag, Freischaltung), Einladungscodes, Admin-Übersicht
  public/         Dokumentenwurzel-Teil: index.php (Router), .htaccess; beim Bauen kommt assets/ (= static/v2) dazu
  schema.sql      MySQL/MariaDB-Schema, alle Tabellen mit Präfix futter_ (die Datenbank darf geteilt sein, auf dev mit dem Journal)
  skripte/bauen.py   Paket bauen: lib, public+assets, vorgerenderte Seiten (Futter/Wiese), basis.json, build.txt
  skripte/deploy-allinkl.sh   Auslieferung nach all-inkl (--dev einrichten | --dev [--trocken] | --live …), Sicherung vor jedem Deploy
  skripte/server.php  läuft auf dem Server: konfig.php prüfen (nur Namen), Schema einspielen, Datenbank sichern
  dev/            Tor der Testumgebung (tor.php + .htaccess, nur auf dev): Zugang nur mit Admin-Anmeldung über das AGFF-Konto
  test/           lokale Nachbildung von all-inkl (PHP 8.4 + MariaDB 10.11) und Prüfstand gegen Flask
```

Konfiguration: `konfig.php` neben `lib/` (nie im Repo), Vorlage `konfig.example.php`. Gleiche Namen wie in `.env`.

## Testen

```bash
allinkl/test/start.sh                     # baut, startet PHP (127.0.0.1:5097/futter/) und Flask-Referenz (127.0.0.1:5098/v2/)
python3 -I allinkl/test/vertrag.py        # gleiche Anfragen an beide, Antworten vergleichen
```

`start.sh` beginnt jedes Mal mit leeren Datenbanken. Der Prüfstand ersetzt Zufallswerte (IDs, Zeiten) durch Platzhalter und
vergleicht Status, Sicherheits-Header und JSON.

## Stand

| Bereich | Stand |
|---|---|
| Kern (Konfiguration, DB, Header, Ratenbegrenzung, Krypto) | portiert |
| Seiten, sw.js, Manifest, Basis, Config, Modus Wiese | portiert, geprüft |
| Statistik (Beiträge, Vergleich, Schweiz, CSV) | portiert, geprüft |
| Rückmeldung | portiert, geprüft |
| Admin-Anmeldung (SSO) | portiert, Fehlerwege geprüft; Anmeldung mit echtem Token noch offen |
| E-Mail-Codes, Freigaben (Spaces) inkl. Fotos und Gruppen-Beitritt | portiert, geprüft |
| Konto und Cloud-Speicherung, Antrag Foto-Speicher | portiert, geprüft |
| Kurse, Pool, Administration (Übersicht, Kursleitung, Einladungen) | portiert, geprüft |
| Texterkennung | läuft auf dem Home-Server (Flask, `/futter/v2/api/labor/*`, CORS über `OCR_CORS_ORIGINS`); die PHP-App nennt die Adresse unter `api/labor/config` (konfig `OCR_URL`, ergänzt die CSP). Kein Server eingestellt oder erreichbar (30 s) → «Auf meinem Gerät» |
| Deploy-Skript (dev mit Tor, live mit Bestätigung) | in Betrieb (dev und live) |
| Datenumzug Server-Daten | `allinkl/skripte/umzug.sh --lokal|--dev|--live` (Export im Flask-Container → SSH-Pipe → `skripte/umzug.php`, alter → neuer Schlüssel, Fotos mit). Lokal geprüft mit `allinkl/test/umzug_pruefen.sh` (10/10 gleich); dev nur mit Testdaten; live wartet auf Martin |
| Umzugsseite (Browserdaten, Plan Abschnitt 4) | `static/v2/umzug.js`, `api/umzug` (Flask `V2_UMZUG_ZIEL`, PHP `UMZUG_QUELLE`), Einstieg `/futter/umzug` ohne COOP-Sperre. Browser-Test `allinkl/test/umzug_browser.sh` (8/8). Eingeschaltet am 24.11.2026: live `UMZUG_QUELLE`, Home-Server `V2_UMZUG_ZIEL` (Vorgabe in `docker-compose.yml`) |

Abweichungen von Flask, bewusst: Ratenbegrenzung in MySQL statt im Arbeitsspeicher; Admin-Cookie nur für den Pfad
der App (`/futter/`) statt `/`; unbekannte Adressen antworten mit JSON `{"error":"NOT_FOUND"}`; Fehler werden nie an Besucher ausgegeben (JSON 500, Stelle im Fehlerprotokoll);
E-Mail über `mail()` statt SMTP-Anmeldung (auf all-inkl liefert das Web-PHP über sendmail aus); Links in E-Mails (Kurs-Bestätigung,
Freischaltung, Antrag) zeigen auf `V2_PUBLIC_URL` bzw. die eigene Adresse statt fest auf apps.graswachstum.ch; Einladung mit ungültiger Zahl
(`max`, `tage`) → 400 statt 500; Datensätze ohne feste Reihenfolge (InnoDB: nach ID).
