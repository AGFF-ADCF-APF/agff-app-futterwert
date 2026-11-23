<?php
/**
 * Futter v2 auf all-inkl – Einstieg. Alle Anfragen ausser /assets/ kommen hierher (.htaccess).
 * Der Code liegt ausserhalb der Dokumentenwurzel (FUTTER_LIB, Standard ../lib neben public/).
 */
declare(strict_types=1);

$lib = getenv('FUTTER_LIB') ?: dirname(__DIR__) . '/lib';
foreach (['kern', 'sso', 'statistik', 'rueckmeldung', 'seiten'] as $modul) {
    require $lib . '/' . $modul . '.php';
}

/** Pfad, unter dem die App läuft, mit Schrägstrich am Ende: /futter/ oder /wiese/ */
function basis_pfad(): string
{
    static $b = null;
    if ($b === null) {
        $b = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'))), '/') . '/';
    }
    return $b;
}

function modus(): string
{
    $wiese = (array) konfig('WIESE_PFADE', ['/wiese/']);
    return in_array(basis_pfad(), $wiese, true) ? 'wiese' : '';
}

// [Methode(n), Muster, Funktion] – Muster ohne Basis-Pfad, Gruppen werden als Argumente übergeben
$ROUTEN = [
    ['GET', '', 'r_seite_index'],
    ['GET', 'datenschutz', 'r_seite_datenschutz'],
    ['GET', 'admin', 'r_seite_admin'],
    ['GET', 'sw.js', 'r_sw'],
    ['GET', 'manifest.webmanifest', 'r_manifest'],
    ['GET', 'api/basis', 'r_basis'],
    ['GET', 'api/config', 'r_config'],
    ['PUT', 'api/statistik/([^/]+)', 'r_beitrag_speichern'],
    ['DELETE', 'api/statistik/([^/]+)', 'r_beitrag_loeschen'],
    ['GET', 'api/statistik/vergleich', 'r_vergleich'],
    ['GET', 'api/statistik/schweiz', 'r_schweiz'],
    ['GET', 'api/statistik/config', 'r_statistik_config'],
    ['GET', 'api/admin/statistik\.csv', 'r_admin_statistik_csv'],
    ['POST', 'api/rueckmeldung', 'r_rueckmeldung'],
    ['GET', 'api/admin/rueckmeldungen', 'r_admin_rueckmeldungen'],
    ['DELETE', 'api/admin/rueckmeldungen/([^/]+)', 'r_admin_rueckmeldung_loeschen'],
    ['GET', 'anmelden', 'r_anmelden'],
    ['GET', 'anmelden/zurueck', 'r_anmelden_zurueck'],
    ['GET', 'api/admin/ich', 'r_admin_ich'],
    ['POST', 'abmelden', 'r_abmelden'],
];

function ausgeben(Antwort $a, bool $api): void
{
    http_response_code($a->status);
    sicherheits_header($api);
    header('Content-Type: application/json');
    foreach ($a->kopf as $k => $v) {
        header($k . ': ' . $v);
    }
    echo json_text($a->daten), "\n";
}

$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$pfad = rawurldecode((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));
$basis = basis_pfad();
$rest = strncmp($pfad, $basis, strlen($basis)) === 0 ? substr($pfad, strlen($basis)) : ltrim($pfad, '/');
$ist_api = strncmp($rest, 'api/', 4) === 0;

try {
    $gefunden = false;
    foreach ($ROUTEN as [$m, $muster, $fn]) {
        if (!preg_match('#^' . $muster . '$#D', $rest, $treffer)) {
            continue;
        }
        $gefunden = true;
        if ($m !== $methode && !($m === 'GET' && $methode === 'HEAD')) {
            continue;
        }
        if ($ist_api || $fn === 'r_abmelden') {
            sicherheits_header(true);
        }
        $fn(...array_slice($treffer, 1));
        throw new RuntimeException('Route ohne Antwort: ' . $fn);
    }
    fehler($gefunden ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', $gefunden ? 405 : 404);
} catch (Antwort $a) {
    ausgeben($a, $ist_api);
} catch (Throwable $e) {
    // Inhalte nie protokollieren, nur Art und Stelle
    error_log('futter-v2: ' . get_class($e) . ' in ' . basename($e->getFile()) . ':' . $e->getLine());
    ausgeben(new Antwort(['error' => 'SERVER_ERROR'], 500), $ist_api);
}
