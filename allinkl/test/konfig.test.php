<?php
// Nur für die lokale Testumgebung (feste Testwerte, keine echten Geheimnisse)
return [
    'DB_DSN' => 'mysql:host=db;dbname=futter;charset=utf8mb4',
    'DB_USER' => 'futter',
    'DB_PASS' => 'futter-test',
    'V2_SERVER_KEY' => getenv('TEST_SERVER_KEY') ?: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=', // Umzugstest: anderer Schlüssel
    'ADMIN_PASSWORD' => 'test-admin-passwort',
    'DATEN_DIR' => '/daten',
    'SEITEN_DIR' => '/app/seiten',
    'ASSETS_DIR' => '/app/public/assets',
    'V2_MAIL_DRYRUN_FILE' => '/daten/mail.jsonl',
    'V2_KURSLEITUNG_DOMAINS' => 'schule.example.org',
];
