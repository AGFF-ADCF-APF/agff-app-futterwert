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
    konto.php       Konto-Sitzung (X-Konto), Foto-Kontingent (Teil 3: Rest des Kontos)
    spaces.php      Freigaben: Datensätze, Fotos, Links erneuern, Gruppen-Beitritt per Code
  public/         Dokumentenwurzel-Teil: index.php (Router), .htaccess; beim Bauen kommt assets/ (= static/v2) dazu
  schema.sql      MySQL/MariaDB-Schema (alle 23 Tabellen + rate_treffer)
  skripte/bauen.py   Paket bauen: lib, public+assets, vorgerenderte Seiten (Futter/Wiese), basis.json, build.txt
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
| Konto, Kurse, Pool, Administration | offen |
| Texterkennung | bleibt auf dem Home-Server bzw. im Browser (Plan Abschnitt 5) |
| Deploy-Skript, Datenumzug, Umzugsseite | offen |

Abweichungen von Flask, bewusst: Ratenbegrenzung in MySQL statt im Arbeitsspeicher; Admin-Cookie nur für den Pfad
der App (`/futter/`) statt `/`; unbekannte Adressen antworten mit JSON `{"error":"NOT_FOUND"}`; Fehler werden nie an Besucher ausgegeben (JSON 500, Stelle im Fehlerprotokoll);
E-Mail über `mail()` statt SMTP-Anmeldung (auf all-inkl liefert das Web-PHP über sendmail aus); Datensätze ohne feste Reihenfolge (InnoDB: nach ID).
