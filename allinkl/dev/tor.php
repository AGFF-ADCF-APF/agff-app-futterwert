<?php
/**
 * Tor der Testumgebung von Futter v2 (nur dev, nie live). Das Deploy-Skript legt diese Datei und die .htaccess daneben nur
 * auf dev nach public/; dort läuft JEDE Anfrage unter /futter/ und /wiese/ hierher.
 *
 * Durchgelassen wird nur mit Admin-Sitzung der App (Anmeldung mit dem AGFF-Konto: Recht «futter.admin» und starke Anmeldung,
 * lib/sso.php). Ohne Sitzung: kleine Seite mit dem Knopf «Mit AGFF-Konto anmelden», die API antwortet 403, Dateien werden nicht
 * ausgeliefert. Frei sind nur die Anmeldung selbst (anmelden, anmelden/zurueck) und das Stylesheet der Anmeldeseiten.
 * Mit Sitzung liefert das Tor die Dateien unter assets/ aus und gibt alles andere an index.php weiter.
 */
declare(strict_types=1);

const TOR_MIME = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8', 'json' => 'application/json', 'webmanifest' => 'application/manifest+json', 'svg' => 'image/svg+xml',
    'png' => 'image/png', 'webp' => 'image/webp', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'ico' => 'image/x-icon',
    'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'pdf' => 'application/pdf', 'wasm' => 'application/wasm', 'txt' => 'text/plain; charset=utf-8',
    'gz' => 'application/octet-stream', 'mp4' => 'video/mp4', 'webm' => 'video/webm', 'vtt' => 'text/vtt; charset=utf-8',
];

/** Wird von index.php vor dem Weiterleiten aufgerufen (nur wenn diese Datei der Einstieg ist). */
function dev_tor(string $rest): void
{
    if (sso_sitzung() !== null) {
        if (strncmp($rest, 'assets/', 7) === 0) {
            tor_datei(substr($rest, 7));
        }
        return;
    }
    if ($rest === 'anmelden' || $rest === 'anmelden/zurueck') {
        return; // Anmeldung der App selbst
    }
    if ($rest === 'assets/app.css') {
        tor_datei('app.css'); // Stylesheet der Anmelde- und Torseite
    }
    if (strncmp($rest, 'api/', 4) === 0 || ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' || strncmp($rest, 'assets/', 7) === 0 || $rest === 'sw.js') {
        fehler('DEV_TOR', 403);
    }
    tor_seite();
}

function tor_datei(string $name): void
{
    $basis = realpath(assets_dir());
    $pfad = $basis === false ? false : realpath($basis . '/' . $name);
    if ($pfad === false || strncmp($pfad, $basis . '/', strlen($basis) + 1) !== 0 || !is_file($pfad)
        || preg_match('#(^|/)\.#', substr($pfad, strlen($basis) + 1))) {
        fehler('NOT_FOUND', 404);
    }
    $endung = strtolower(pathinfo($pfad, PATHINFO_EXTENSION));
    sicherheits_header(false);
    header('Content-Type: ' . (TOR_MIME[$endung] ?? 'application/octet-stream'));
    header('Content-Length: ' . filesize($pfad));
    header('Cache-Control: no-cache');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
        readfile($pfad);
    }
    exit;
}

function tor_seite(): void
{
    http_response_code(200);
    sicherheits_header(true);
    header('Content-Type: text/html; charset=utf-8');
    $h = fn ($s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    echo '<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex,nofollow"><meta name="futter-tor" content="dev"><title>Testumgebung Futterbeurteilung</title>'
        . '<link rel="stylesheet" href="' . $h(basis_pfad() . 'assets/app.css') . '"></head><body><div class="doc">'
        . '<h1>Testumgebung Futterbeurteilung v2</h1>'
        . '<p>Diese Testversion ist nicht öffentlich. Zugang nur mit dem AGFF-Konto (Administration von Futter v2, Passkey oder zweiter Faktor).</p>'
        . '<p><a class="btn" href="' . $h(basis_pfad() . 'anmelden') . '">Mit AGFF-Konto anmelden</a></p>'
        . '<p>Die öffentliche Version: <a href="https://app.graswachstum.ch/futter/">app.graswachstum.ch/futter</a></p></div></body></html>';
    exit;
}

require __DIR__ . '/index.php';
