# Sicherheit und Datenschutz

## Lücken melden

Bitte Sicherheitslücken **nicht** als öffentliches Issue melden, sondern vertraulich an die AGFF-Geschäftsstelle (Kontakt auf [agff.ch](https://www.agff.ch)), oder – falls aktiviert – über «Report a vulnerability» (GitHub Security Advisories).

## Grundsätze (v2)

- Daten werden standardmässig nur im Browser gespeichert. Übermittlung an den Server nur nach ausdrücklicher Zustimmung.
- E-Mail-Adressen liegen nie im Klartext in der Datenbank (AES-GCM mit `V2_SERVER_KEY`, Suche über HMAC).
- Hochgeladene Laborberichte werden nur im Arbeitsspeicher verarbeitet und sofort verworfen.
- Anonyme Beiträge enthalten keine Namen, Betriebe oder Fotos; Vergleiche erst ab 5 Beiträgen je Gruppe.
- Fotos werden ohne Metadaten gespeichert.
- Keine Tracker, keine externen Skripte; Content-Security-Policy ohne Inline-Scripts.

## Für Mitwirkende

- Dieses Repository ist öffentlich: **keine** `.env`, Schlüssel, Passwörter, Datenbanken, Nutzerdaten oder Server-Sicherungen committen.
- Geheimnisse nur über Umgebungsvariablen (siehe `.env.example`).
- Alle Daten von aussen (Import, QR-Code, Server) über `static/v2/model.js` validieren.
