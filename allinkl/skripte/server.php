<?php
/**
 * Hilfen für das Deploy-Skript, laufen auf dem Server (CLI) im Code-Ordner der App:
 *
 *   php84 skripte/server.php pruefen          konfig.php vollständig? (gibt nur Namen fehlender Einträge aus, nie Werte)
 *   php84 skripte/server.php schema           schema.sql einspielen (CREATE TABLE IF NOT EXISTS, wiederholbar)
 *   php84 skripte/server.php sichern <datei>  eigene Tabellen (aus schema.sql) mit mysqldump nach <datei> (gzip) sichern
 *
 * Zugangsdaten bleiben auf dem Server: Fehlermeldungen geben nur Art und SQLSTATE aus, der Zugang für mysqldump liegt nur
 * während der Sicherung in einer Datei mit Rechten 600 und wird danach gelöscht.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}
$app = dirname(__DIR__);
require $app . '/lib/kern.php';

function abbruch(string $text, int $code = 1): void
{
    fwrite(STDERR, $text . "\n");
    exit($code);
}

function db_fehler(Throwable $e): string
{
    $state = $e instanceof PDOException ? (string) ($e->errorInfo[0] ?? $e->getCode()) : '';
    return get_class($e) . ($state !== '' ? ' SQLSTATE ' . $state : '');
}

$befehl = $argv[1] ?? '';
try {
    if ($befehl === 'pruefen') {
        $fehlt = [];
        foreach (['DB_DSN', 'DB_USER', 'DB_PASS', 'V2_SERVER_KEY'] as $k) {
            if (konfig($k) === null) {
                $fehlt[] = $k;
            }
        }
        if ($fehlt) {
            abbruch('konfig.php: leer oder fehlend: ' . implode(', ', $fehlt));
        }
        server_key(); // wirft bei falscher Länge
        $hinweise = [];
        foreach (['SMTP_FROM' => 'E-Mail-Versand (Codes)', 'SSO_PUBLIC_KEY' => 'Admin-Anmeldung mit dem AGFF-Konto', 'V2_PUBLIC_URL' => 'Links in E-Mails'] as $k => $wozu) {
            if (konfig($k) === null) {
                $hinweise[] = "$k ($wozu)";
            }
        }
        db()->query('SELECT 1');
        echo 'konfig.php ok, Datenbank erreichbar' . ($hinweise ? '; noch leer: ' . implode(', ', $hinweise) : '') . "\n";
    } elseif ($befehl === 'schema') {
        $sql = (string) file_get_contents($app . '/schema.sql');
        $sql = (string) preg_replace('/^\s*--.*$/m', '', $sql);
        $n = 0;
        foreach (preg_split('/;\s*$/m', $sql) as $befehl_sql) {
            if (trim($befehl_sql) !== '') {
                db()->exec($befehl_sql);
                $n++;
            }
        }
        $tabellen = (int) wert('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()');
        echo "Schema eingespielt ($n Befehle), $tabellen Tabellen\n";
    } elseif ($befehl === 'sichern') {
        $ziel = $argv[2] ?? '';
        if ($ziel === '' || !is_dir(dirname($ziel))) {
            abbruch('Aufruf: server.php sichern <datei.sql.gz>');
        }
        if (!preg_match('/(?:^|;)dbname=([^;]+)/', (string) konfig('DB_DSN', ''), $m)) {
            abbruch('DB_DSN ohne dbname');
        }
        preg_match('/(?:^|[:;])host=([^;]+)/', (string) konfig('DB_DSN', ''), $h);
        // Nur die eigenen Tabellen (die Datenbank kann mit anderen Apps geteilt sein, z. B. auf dev mit dem Journal)
        preg_match_all('/CREATE TABLE IF NOT EXISTS ([a-z_0-9]+)/', (string) file_get_contents($app . '/schema.sql'), $t);
        $da = q('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchAll(PDO::FETCH_COLUMN);
        $tabellen = array_values(array_intersect($t[1], $da));
        if (!$tabellen) {
            echo "Datenbank: noch keine Tabellen, nichts zu sichern\n";
            exit(0);
        }
        $zugang = tempnam(sys_get_temp_dir(), 'futter-db-');
        chmod($zugang, 0600);
        $esc = fn ($v) => '"' . addcslashes((string) $v, "\\\"") . '"';
        file_put_contents($zugang, "[client]\nuser=" . $esc(konfig('DB_USER')) . "\npassword=" . $esc(konfig('DB_PASS')) . "\nhost=" . $esc($h[1] ?? 'localhost') . "\n");
        try {
            $cmd = 'mysqldump --defaults-extra-file=' . escapeshellarg($zugang) . ' --single-transaction --skip-lock-tables --no-tablespaces '
                . escapeshellarg($m[1]) . ' ' . implode(' ', array_map('escapeshellarg', $tabellen)) . ' 2>/dev/null | gzip -c > ' . escapeshellarg($ziel) . '; exit ${PIPESTATUS[0]}';
            $rc = 0;
            $aus = [];
            exec('bash -c ' . escapeshellarg($cmd), $aus, $rc);
        } finally {
            @unlink($zugang);
        }
        if ($rc !== 0) {
            abbruch("mysqldump fehlgeschlagen (Rückgabe $rc)");
        }
        chmod($ziel, 0600);
        echo 'Datenbank gesichert (' . count($tabellen) . ' Tabellen, ' . filesize($ziel) . " Byte)\n";
    } else {
        abbruch('Aufruf: server.php pruefen|schema|sichern <datei>');
    }
} catch (Throwable $e) {
    abbruch('Fehler: ' . db_fehler($e));
}
