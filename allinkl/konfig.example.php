<?php
// Vorlage für konfig.php (liegt auf dem Server neben lib/, ausserhalb der Dokumentenwurzel, Rechte 600).
// Werte wie in .env der Flask-Version. Nie mit echten Werten ins Repository.
return [
    'DB_DSN' => 'mysql:host=localhost;dbname=XXX;charset=utf8mb4',
    'DB_USER' => '',
    'DB_PASS' => '',
    'V2_SERVER_KEY' => '',           // 32 Byte base64url – derselbe Schlüssel wie bisher, sonst sind verschlüsselte Daten unlesbar
    'ADMIN_PASSWORD' => '',
    'SSO_URL' => 'https://graswachstum.ch',   // dev: https://dev-graswachstum.graswachstum.ch (Aussteller = dieselbe Adresse)
    'SSO_CLIENT' => 'futter',
    'SSO_PUBLIC_KEY' => '',          // Ed25519, base64 (32 Byte); dev und live haben je ein eigenes Schlüsselpaar
    'SMTP_FROM' => 'webmaster@graswachstum.ch',   // Absender für mail() wie graswachstum.ch (sendmail auf all-inkl); SMTP_HOST/USER/PASS braucht es nicht
    'V2_PUBLIC_URL' => 'https://app.graswachstum.ch/futter/',   // Links in E-Mails; dev: https://dev-app.graswachstum.ch/futter/
    'V2_KURSLEITUNG_EMAILS' => '', 'V2_KURSLEITUNG_DOMAINS' => '', 'V2_ADMIN_MAIL' => '',
    'V2_RETENTION_DAYS' => 730,
    'DATEN_DIR' => __DIR__ . '/daten',   // Fotos
    'WIESE_PFADE' => ['/wiese/'],
    'WIESE_WEITER' => '/pratum/',        // /wiese/ leitet hierhin weiter (Pratum); 'aus' = Wiese-Modus wie bisher
    'COOKIE_PFAD' => null,               // dev: '/' (Admin-Anmeldung gilt dann auch für /wiese/, das Tor braucht sie dort)
    'CSP_CONNECT_EXTRA' => [],           // weitere Adressen für connect-src (OCR_URL wird automatisch ergänzt)
    // Texterkennung auf dem Home-Server (Plan Abschnitt 5): Basis der Labor-Routen, mit Schrägstrich am Ende.
    // Leer = keine Server-Texterkennung, die App liest dann nur «Auf meinem Gerät».
    'OCR_URL' => '',                     // z. B. 'https://apps.graswachstum.ch/futter/v2/api/labor/'
    // Umzug der Browserdaten: alte Adresse, von der die App Daten annimmt (Fenster /futter/umzug, postMessage). Leer = aus.
    'UMZUG_QUELLE' => '',                // live: 'https://apps.graswachstum.ch'
];
