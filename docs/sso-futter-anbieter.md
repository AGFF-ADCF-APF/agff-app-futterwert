# Admin-Anmeldung von Futter v2 mit dem AGFF-Konto: was auf der Anbieterseite nötig ist

Futter v2 meldet die Administration über die AGFF-Anmeldung an (SSO der Anmelde-Website graswachstum.ch, Plugin
`agff-familie`, `classes/SsoExtern.php`, Beschreibung `~/git/lernherbar/docs/sso-agff.md`). Der frühere Weg über
`/eagff-mitwirken/zugang/apps` (Plugin agff-eagff, HS256 mit `ZENTRAL_GEHEIMNIS`) gibt es auf graswachstum.ch nicht mehr (404 seit
der Umstrukturierung, geprüft 23.11.2026).

Futter-Seite (`v2_zentral.py`): client `futter`, Start `/futter/v2/anmelden` → `https://graswachstum.ch/_konto/sso/extern?client=futter&state=…&stark=1`,
Rückweg `GET /futter/v2/anmelden/zurueck?token=…&state=…`. Admin-Sitzung nur mit Recht `futter.admin` **und** starker Anmeldung
(`stark_bis` in der Zukunft: Passkey oder zweiter Faktor). Prüfungen: `tests/test_sso.py`.

## Auf der Anbieterseite (agff-familie, durch den Admin von graswachstum.ch)

1. **Rückkehradresse** in `site/user/gemeinsam/websites.php`, `umgebungen.server.apps`:
   `'futter' => 'https://apps.graswachstum.ch/futter/v2/anmelden/zurueck'`
   (für einen Test auf dev entsprechend unter `dev.apps`, solange Futter keine eigene Dev-Adresse hat, nicht nötig).
2. **Recht** in `permissions.yaml` des Plugins agff-familie (wie `herbar`, `journal`):
   ```yaml
   futter:
     type: access
     label: 'Futterbeurteilung v2 (apps.graswachstum.ch/futter, Anmeldung mit AGFF-Konto, classes/SsoExtern.php)'
     actions:
       admin:
         label: 'Administration von Futter v2 (Kursleitung freischalten, Rückmeldungen, Statistik)'
   ```
   Danach den Admin-Konten das Recht `futter.admin` geben.
3. **Schlüsselpaar** auf dem Live-Server erzeugen: `werkzeuge/sso_schluessel.sh --live futter` (nur mit Ja des Admins).
   Der private Schlüssel bleibt in `user/gemeinsam/daten/sso/futter.key`; ausgegeben wird nur der öffentliche.

## In Futter (Home-Server)

4. Öffentlichen Schlüssel in `/opt/stacks/agff-apps/futter/.env` eintragen: `SSO_PUBLIC_KEY=<base64, 32 Byte>`
   (nicht geheim, aber nicht ins Repo). `ZENTRAL_GEHEIMNIS` kann entfernt werden.
5. `docker compose up -d --build`.

## Prüfen

- `https://apps.graswachstum.ch/futter/v2/api/admin/ich` → `"zentral": true`.
- `https://apps.graswachstum.ch/futter/v2/admin` → «Mit AGFF-Konto anmelden» → graswachstum.ch → zurück, «Angemeldet als …».
- Ohne Recht `futter.admin`: Meldung «kein Zugang», keine Sitzung. Ohne zweiten Faktor: graswachstum.ch fragt ihn nach (stark=1).
- Heureka (solange auf apps.graswachstum.ch): Musterlösungen erscheinen am Ergebnis einer Belüftungsheu-Runde.
