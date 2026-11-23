<?php
/**
 * Futter v2 auf all-inkl – Einstieg. Alle Anfragen ausser /assets/ kommen hierher (.htaccess).
 * Der Code liegt ausserhalb der Dokumentenwurzel (FUTTER_LIB, Standard ../lib neben public/).
 */
declare(strict_types=1);

// Nie Fehlertexte an Besucher ausgeben; Warnungen werden zu Ausnahmen (→ JSON 500, Stelle im Fehlerprotokoll)
ini_set('display_errors', '0');
set_error_handler(function (int $nr, string $text, string $datei, int $zeile): bool {
    if (!(error_reporting() & $nr)) {
        return false; // mit @ unterdrückt
    }
    throw new ErrorException($text, 0, $nr, $datei, $zeile);
});

$lib = getenv('FUTTER_LIB') ?: dirname(__DIR__) . '/lib';
foreach (['kern', 'mail', 'konto', 'sso', 'statistik', 'rueckmeldung', 'seiten', 'spaces'] as $modul) {
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
    // Freigaben (Spaces) und Gruppen
    ['POST', 'api/spaces/code', 'r_space_code'],
    ['POST', 'api/spaces', 'r_space_anlegen'],
    ['GET', 'api/spaces/([^/]+)', 'r_space_lesen'],
    ['DELETE', 'api/spaces/([^/]+)', 'r_space_loeschen'],
    ['PUT', 'api/spaces/([^/]+)/records/([^/]+)', 'r_record_speichern'],
    ['DELETE', 'api/spaces/([^/]+)/records/([^/]+)', 'r_record_loeschen'],
    ['POST', 'api/spaces/([^/]+)/rotate', 'r_space_rotate'],
    ['GET|POST|DELETE', 'api/spaces/([^/]+)/beitritt', 'r_beitritt'],
    ['POST', 'api/gruppen/beitreten', 'r_gruppe_beitreten'],
    ['PUT', 'api/spaces/([^/]+)/fotos/([^/]+)', 'r_foto_hochladen'],
    ['GET', 'api/spaces/([^/]+)/fotos/([^/]+)', 'r_foto_lesen'],
    ['DELETE', 'api/spaces/([^/]+)/fotos/([^/]+)', 'r_foto_loeschen'],
    // Konto und Cloud-Speicherung
    ['POST', 'api/konto/code', 'r_konto_code'],
    ['POST', 'api/konto/login', 'r_konto_login'],
    ['GET', 'api/konto', 'r_konto_info'],
    ['DELETE', 'api/konto', 'r_konto_loeschen'],
    ['DELETE', 'api/konto/links/([^/]+)', 'r_konto_link_weg'],
    ['DELETE', 'api/konto/links', 'r_konto_links_alle_weg'],
    ['DELETE', 'api/konto/geraete/([^/]+)', 'r_konto_geraet_weg'],
    ['POST', 'api/konto/logout', 'r_konto_logout'],
    ['PUT', 'api/konto/cloud', 'r_konto_cloud'],
    ['GET', 'api/konto/daten/([^/]+)', 'r_konto_daten_lesen'],
    ['PUT', 'api/konto/daten/([^/]+)', 'r_konto_daten_schreiben'],
    ['PUT', 'api/konto/fotos/([^/]+)', 'r_konto_foto_hochladen'],
    ['GET', 'api/konto/fotos/([^/]+)', 'r_konto_foto_lesen'],
    ['GET', 'api/konto/fotos', 'r_konto_foto_liste'],
    ['DELETE', 'api/konto/fotos/([^/]+)', 'r_konto_foto_loeschen'],
    ['POST', 'api/quota-antrag', 'r_quota_antrag'],
    ['POST', 'api/quota-antrag/code', 'r_quota_antrag_code'],
    ['GET', 'api/admin/quota', 'r_admin_quota_liste'],
    ['POST', 'api/admin/quota/([^/]+)', 'r_admin_quota_entscheid'],
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
        $erlaubt = explode('|', $m);
        if (!in_array($methode, $erlaubt, true) && !($methode === 'HEAD' && in_array('GET', $erlaubt, true))) {
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
