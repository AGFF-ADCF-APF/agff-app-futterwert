<?php
/**
 * Seiten, Service Worker, Manifest, Nährwert-Basis und Konfiguration.
 * Die HTML-Seiten und basis.json werden beim Bauen aus templates/v2 bzw. futterwerte.csv erzeugt
 * (allinkl/skripte/bauen.py) und liegen im Ordner seiten/ neben lib/ (ausserhalb der Dokumentenwurzel).
 */
declare(strict_types=1);

function seiten_dir(): string
{
    return rtrim((string) konfig('SEITEN_DIR', dirname(__DIR__) . '/seiten'), '/');
}

function assets_dir(): string
{
    return rtrim((string) konfig('ASSETS_DIR', dirname(__DIR__) . '/public/assets'), '/');
}

function datei_senden(string $pfad, string $typ, array $kopf = []): void
{
    if (!is_file($pfad)) {
        fehler('NOT_FOUND', 404);
    }
    sicherheits_header(false);
    header('Content-Type: ' . $typ);
    foreach ($kopf as $k => $v) {
        header($k . ': ' . $v);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
        readfile($pfad);
    }
    exit;
}

function seite(string $name, array $kopf = []): void
{
    $datei = seiten_dir() . '/' . $name . (modus() === 'wiese' && $name !== 'admin' ? '-wiese' : '') . '.html';
    datei_senden($datei, 'text/html; charset=utf-8', ['Cache-Control' => 'no-cache'] + $kopf);
}

// --- Umzug der Browserdaten von der alten Adresse (Plan Abschnitt 4) ---------------------------
/** Alte Adresse (Ursprung), von der diese App Browserdaten annimmt, z. B. https://apps.graswachstum.ch; sonst null. */
function umzug_quelle(): ?string
{
    $u = rtrim(trim((string) konfig('UMZUG_QUELLE', '')), '/');
    return preg_match('#^https://[a-z0-9.-]+$|^http://127\.0\.0\.1:\d+$#D', $u) ? $u : null;
}

function r_umzug_config(): void
{
    json_ende(['quelle' => umzug_quelle(), 'ziel' => null]);
}

/**
 * Einstieg für das Umzugsfenster: dieselbe Seite wie index, aber ohne COOP «same-origin», damit das Fenster der alten
 * Adresse (window.opener) die Daten per postMessage übergeben kann. Ohne UMZUG_QUELLE wie index.
 */
function r_seite_umzug(): void
{
    seite('index', umzug_quelle() !== null ? ['Cross-Origin-Opener-Policy' => 'unsafe-none'] : []);
}

function r_seite_index(): void
{
    seite('index');
}

function r_seite_datenschutz(): void
{
    seite('datenschutz');
}

function r_seite_admin(): void
{
    seite('admin');
}

function r_sw(): void
{
    datei_senden(assets_dir() . '/sw.js', 'text/javascript; charset=utf-8', ['Cache-Control' => 'no-cache', 'Service-Worker-Allowed' => './']);
}

function r_manifest(): void
{
    datei_senden(assets_dir() . '/' . (modus() === 'wiese' ? 'manifest-wiese.webmanifest' : 'manifest.webmanifest'), 'application/manifest+json');
}

function r_basis(): void
{
    datei_senden(seiten_dir() . '/basis.json', 'application/json', ['Cache-Control' => 'public, max-age=3600']);
}

function asset_build(): string
{
    static $b = null;
    return $b ??= trim((string) @file_get_contents(seiten_dir() . '/build.txt'));
}

/**
 * Texterkennung: läuft nicht auf all-inkl, sondern auf dem Home-Server (konfig OCR_URL) oder im Browser.
 * url = Basis für lesen/bericht beim Home-Server, null = nur «Auf meinem Gerät». (Flask liefert kein url → gleiche Herkunft.)
 */
function r_labor_config(): void
{
    json_ende(['consentVersion' => '2026-10-o1', 'url' => ocr_url()]);
}

function r_config(): void
{
    $privacy = (string) konfig('V2_PRIVACY_URL', '');
    json_ende(['build' => asset_build(), 'consentVersion' => CONSENT_VERSION, 'privacyUrl' => $privacy !== '' ? $privacy : null, 'retentionDays' => retention_days()]);
}
