<?php
/**
 * Datenumzug Futter v2: Flask/SQLite (Home-Server) → PHP/MySQL (all-inkl), Teil 2: Import. Läuft auf dem Server (CLI)
 * im Code-Ordner der App und liest den Strom von skripte/umzug_export.py auf stdin (Aufruf über allinkl/skripte/umzug.sh):
 *
 *   php84 skripte/umzug.php leer                         sind die Tabellen futter_* (ohne Sitzungen/Ratenbegrenzung) leer?
 *   php84 skripte/umzug.php einspielen [--ersetzen]      Strom einspielen; ohne --ersetzen nur in leere Tabellen
 *
 * Verschlüsselt mit dem Server-Schlüssel dieser Installation (konfig.php) neu: Felder {"klar": …} → text_enc mit
 * derselben AAD wie die App, {"email": …} → email_hmac, Gruppen-Code → beitritt_hmac. Alles in EINER Transaktion: bei
 * einem Fehler bleibt die Datenbank unverändert. Fotos landen zuerst in einem Nebenordner und werden erst nach dem
 * Commit an ihren Platz verschoben.
 *
 * Ausgabe nur Anzahlen, nie Inhalte (auch nicht in Fehlermeldungen).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}
$lib = getenv('FUTTER_LIB') ?: dirname(__DIR__) . '/lib';   // Prüfstand: Skript liegt nicht im Paket
require $lib . '/kern.php';
require_once $lib . '/spaces.php';

const FORMAT = 'futter-umzug-1';
// Tabellen in Fremdschlüssel-Reihenfolge (wie umzug_export.py)
const TABELLEN = ['e2e_spaces', 'e2e_fotos', 'e2e_records', 'kursleitende', 'einladungen', 'kurse', 'kurs_teilnehmende', 'kurs_sessions',
    'kurs_proben', 'kurs_beurteilungen', 'kurs_fotos', 'pool_proben', 'pool_fotos', 'beitraege', 'konten', 'konto_links', 'konto_sessions',
    'konto_daten', 'konto_fotos', 'foto_quota', 'quota_antraege', 'rueckmeldungen'];
// (Tabelle.Spalte) → AAD für text_enc (gleich wie in der App bzw. v2_*.py)
const AAD = [
    'e2e_spaces.owner_email_enc' => 'agff-email', 'e2e_spaces.beitritt_enc' => 'gruppe-beitritt',
    'kursleitende.email_enc' => 'agff-email', 'kursleitende.name_enc' => 'kl', 'kursleitende.org_enc' => 'kl', 'kursleitende.text_enc' => 'kl',
    'kurse.link_enc' => 'kurs-link', 'kurs_teilnehmende.email_enc' => 'agff-email', 'pool_proben.daten_enc' => 'pool',
    'konten.email_enc' => 'agff-email', 'konto_links.email_enc' => 'agff-email',
    'quota_antraege.email_enc' => 'agff-email', 'quota_antraege.text_enc' => 'quota', 'rueckmeldungen.text_enc' => 'agff-rueckmeldung',
];

function abbruch(string $text, int $code = 1): void
{
    fwrite(STDERR, $text . "\n");
    exit($code);
}

function tab(string $t): string
{
    if (!in_array($t, TABELLEN, true)) {
        throw new RuntimeException('unbekannte Tabelle');
    }
    return 'futter_' . $t;
}

function belegt(): array
{
    $voll = [];
    foreach (TABELLEN as $t) {
        $n = (int) wert('SELECT COUNT(*) FROM ' . tab($t));
        if ($n > 0) {
            $voll[$t] = $n;
        }
    }
    return $voll;
}

$befehl = $argv[1] ?? '';
$ersetzen = in_array('--ersetzen', $argv, true);
$foto_neu = null;
try {
    if ($befehl === 'leer') {
        $voll = belegt();
        echo $voll ? 'Belegt: ' . implode(', ', array_map(fn ($t, $n) => "$t $n", array_keys($voll), $voll)) . "\n" : "Tabellen leer\n";
        exit($voll ? 3 : 0);
    }
    if ($befehl !== 'einspielen') {
        abbruch('Aufruf: umzug.php leer | einspielen [--ersetzen]  (Strom auf stdin)');
    }
    server_key();
    $voll = belegt();
    if ($voll && !$ersetzen) {
        abbruch('Abbruch: Tabellen nicht leer (' . implode(', ', array_keys($voll)) . '). Mit --ersetzen werden sie vorher geleert.', 3);
    }
    $kopf = json_decode((string) fgets(STDIN), true);
    if (!is_array($kopf) || ($kopf['format'] ?? '') !== FORMAT) {
        abbruch('Abbruch: unbekanntes Format des Stroms (Export fehlgeschlagen?)');
    }

    $fotos_ziel = foto_dir();
    $foto_neu = $fotos_ziel . '.umzug-' . getmypid();
    if (!is_dir($foto_neu) && !mkdir($foto_neu, 0700, true)) {
        abbruch('Abbruch: Fotoordner nicht anlegbar');
    }

    $pdo = db();
    $pdo->beginTransaction();
    if ($ersetzen) {
        foreach (array_reverse(TABELLEN) as $t) {
            $pdo->exec('DELETE FROM ' . tab($t));
        }
    }
    $spalten_cache = [];
    $zaehler = [];
    $fehlt = [];
    $fotos = 0;
    $foto_byte = 0;
    $ende = null;
    while (($zeile = fgets(STDIN)) !== false) {
        $z = json_decode($zeile, true, 64, JSON_THROW_ON_ERROR);
        if (isset($z['ende'])) {
            $ende = $z;
            break;
        }
        $t = (string) ($z['t'] ?? '');
        if ($t === '_foto') {
            $rel = (string) ($z['p'] ?? '');
            if (!preg_match('#^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.bin$#D', $rel)) {
                throw new RuntimeException('ungültiger Fotopfad');
            }
            $inhalt = base64_decode((string) ($z['b'] ?? ''), true);
            if ($inhalt === false) {
                throw new RuntimeException('Foto nicht lesbar');
            }
            $pfad = $foto_neu . '/' . $rel;
            if (!is_dir(dirname($pfad))) {
                mkdir(dirname($pfad), 0700, true);
            }
            if (file_put_contents($pfad, $inhalt) !== strlen($inhalt)) {
                throw new RuntimeException('Foto nicht schreibbar');
            }
            $fotos++;
            $foto_byte += strlen($inhalt);
            continue;
        }
        $tabelle = tab($t);
        $r = $z['r'] ?? null;
        if (!is_array($r)) {
            throw new RuntimeException('Zeile ohne Daten');
        }
        if (!isset($spalten_cache[$t])) {
            $spalten_cache[$t] = q('SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?', [$tabelle])
                ->fetchAll(PDO::FETCH_COLUMN);
        }
        // Gruppen-Code für beitritt_hmac aus dem entschlüsselten beitritt_enc
        $klar_beitritt = is_array($r['beitritt_enc'] ?? null) ? ($r['beitritt_enc']['klar'] ?? null) : null;
        $werte = [];
        foreach ($r as $sp => $w) {
            if (!in_array($sp, $spalten_cache[$t], true)) {
                throw new RuntimeException("Spalte fehlt in $tabelle");
            }
            if (is_array($w)) {
                if (array_key_exists('klar', $w)) {
                    $aad = AAD["$t.$sp"] ?? null;
                    if ($aad === null) {
                        throw new RuntimeException("unerwartetes verschlüsseltes Feld $t.$sp");
                    }
                    if ($w['klar'] === null) {
                        $fehlt["$t.$sp"] = ($fehlt["$t.$sp"] ?? 0) + 1;
                        $w = null;
                    } else {
                        $w = text_enc((string) $w['klar'], $aad);
                    }
                } elseif (array_key_exists('email', $w)) {
                    if ($w['email'] === null) {
                        $fehlt["$t.$sp"] = ($fehlt["$t.$sp"] ?? 0) + 1;
                        $w = null;
                    } else {
                        $w = email_hmac((string) $w['email']);
                    }
                } elseif (array_key_exists('code_aus', $w)) {
                    $code = $klar_beitritt !== null ? (json_decode($klar_beitritt, true)['code'] ?? null) : null;
                    $w = is_string($code) ? beitritt_hmac($code) : null;
                } else {
                    throw new RuntimeException("unbekannter Feldtyp in $t.$sp");
                }
            } elseif (is_bool($w)) {
                $w = $w ? 1 : 0;
            }
            $werte[$sp] = $w;
        }
        // Pflichtfelder, deren Adresse fehlt: Zeile auslassen statt Umzug abbrechen (z. B. Pool-Probe ohne bekannte Person)
        if (($t === 'pool_proben' && $werte['creator_hmac'] === null) || ($t === 'foto_quota' && $werte['email_hmac'] === null)
            || (in_array($t, ['kursleitende', 'konten', 'konto_links', 'quota_antraege'], true) && ($werte['email_hmac'] === null || $werte['email_enc'] === null))) {
            $fehlt["$t (Zeile ausgelassen)"] = ($fehlt["$t (Zeile ausgelassen)"] ?? 0) + 1;
            continue;
        }
        $sp = array_keys($werte);
        q('INSERT INTO ' . $tabelle . ' (' . implode(', ', $sp) . ') VALUES (' . implode(', ', array_fill(0, count($sp), '?')) . ')', array_values($werte));
        $zaehler[$t] = ($zaehler[$t] ?? 0) + 1;
    }
    if ($ende === null) {
        throw new RuntimeException('Strom unvollständig (kein Ende)');
    }
    $soll = array_sum(array_map('intval', (array) ($ende['zeilen'] ?? [])));
    $ist = array_sum($zaehler) + array_sum(array_filter($fehlt, fn ($k) => str_ends_with($k, '(Zeile ausgelassen)'), ARRAY_FILTER_USE_KEY));
    if ($soll !== $ist || (int) ($ende['fotos'] ?? -1) !== $fotos) {
        throw new RuntimeException("Anzahl stimmt nicht (Zeilen $ist von $soll, Fotos $fotos von " . (int) ($ende['fotos'] ?? 0) . ')');
    }
    $pdo->commit();

    // Fotos an ihren Platz (bestehende gleiche Pfade werden ersetzt; mit --ersetzen vorher alte Fotos zur Seite)
    if ($ersetzen && is_dir($fotos_ziel)) {
        rename($fotos_ziel, $fotos_ziel . '.vorher-' . date('Ymd-His'));
    }
    if (!is_dir($fotos_ziel)) {
        rename($foto_neu, $fotos_ziel);
    } else {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($foto_neu, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            $rel = substr($f->getPathname(), strlen($foto_neu) + 1);
            $ziel = $fotos_ziel . '/' . $rel;
            if (!is_dir(dirname($ziel))) {
                mkdir(dirname($ziel), 0700, true);
            }
            rename($f->getPathname(), $ziel);
        }
        exec('rm -rf ' . escapeshellarg($foto_neu));
    }
    $foto_neu = null;

    echo 'Eingespielt: ' . implode(', ', array_map(fn ($t, $n) => "$t $n", array_keys($zaehler), $zaehler)) . "; Fotos $fotos (" . intdiv($foto_byte, 1024) . " KB)\n";
    if ($fehlt) {
        echo 'Achtung, ohne Wert bzw. ausgelassen: ' . implode(', ', array_map(fn ($k, $n) => "$k $n", array_keys($fehlt), $fehlt)) . "\n";
    }
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if ($foto_neu !== null && is_dir($foto_neu)) {
        exec('rm -rf ' . escapeshellarg($foto_neu));
    }
    $state = $e instanceof PDOException ? ' SQLSTATE ' . (string) ($e->errorInfo[0] ?? $e->getCode()) : '';
    // Nur eigene Meldungen (ohne Inhalte) ausgeben, sonst nur die Art des Fehlers
    $text = $e instanceof RuntimeException && !($e instanceof PDOException) ? $e->getMessage() : get_class($e) . $state;
    abbruch('Fehler, nichts übernommen: ' . $text);
}
