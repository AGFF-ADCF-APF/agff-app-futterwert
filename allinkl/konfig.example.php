<?php
// Vorlage für konfig.php (liegt auf dem Server neben lib/, ausserhalb der Dokumentenwurzel, Rechte 600).
// Werte wie in .env der Flask-Version. Nie mit echten Werten ins Repository.
return [
    'DB_DSN' => 'mysql:host=localhost;dbname=XXX;charset=utf8mb4',
    'DB_USER' => '',
    'DB_PASS' => '',
    'V2_SERVER_KEY' => '',           // 32 Byte base64url – derselbe Schlüssel wie bisher, sonst sind verschlüsselte Daten unlesbar
    'ADMIN_PASSWORD' => '',
    'SSO_URL' => 'https://graswachstum.ch',
    'SSO_CLIENT' => 'futter',
    'SSO_PUBLIC_KEY' => '',          // Ed25519, base64 (32 Byte)
    'SMTP_HOST' => '', 'SMTP_USER' => '', 'SMTP_PASS' => '', 'SMTP_FROM' => '',
    'V2_KURSLEITUNG_EMAILS' => '', 'V2_KURSLEITUNG_DOMAINS' => '', 'V2_ADMIN_MAIL' => '',
    'V2_RETENTION_DAYS' => 730,
    'DATEN_DIR' => __DIR__ . '/daten',   // Fotos
    'WIESE_PFADE' => ['/wiese/'],
    'CSP_CONNECT_EXTRA' => [],           // z. B. ['https://ocr.graswachstum.ch'] für die Texterkennung auf dem Home-Server
];
