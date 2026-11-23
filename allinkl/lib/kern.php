<?php
/**
 * Futter v2 auf all-inkl – Kern: Konfiguration, Datenbank, JSON, Sicherheits-Header, Ratenbegrenzung, Krypto.
 *
 * Portiert aus v2_api.py / v2_mail.py (Flask). Verhalten und Antworten sollen gleich bleiben; der Prüfstand
 * allinkl/test/vertrag.py läuft gegen beide Fassungen.
 *
 * JSON wird OHNE assoc dekodiert (Objekte = stdClass), damit {} und [] unterscheidbar bleiben wie in Python
 * (dict/list). Für Ausgaben mit möglicherweise leeren Objekten immer (object) bzw. new stdClass verwenden.
 */
declare(strict_types=1);

const CONSENT_VERSION = '2026-10-c';
const MAX_RECORD_BYTES = 64 * 1024;
const FUTTERARTEN = ['heu', 'gras', 'mais', 'gruen', 'gps'];
const ID_RE = '/^[A-Za-z0-9_-]{6,64}$/D';
const TOKEN_RE = '/^[A-Za-z0-9_-]{43}$/D';

// --- Konfiguration ------------------------------------------------------------------
function konfig(?string $schluessel = null, $standard = null)
{
    static $k = null;
    if ($k === null) {
        $pfad = getenv('FUTTER_KONFIG') ?: dirname(__DIR__) . '/konfig.php';
        $k = is_file($pfad) ? require $pfad : [];
        if (!is_array($k)) {
            $k = [];
        }
    }
    if ($schluessel === null) {
        return $k;
    }
    return array_key_exists($schluessel, $k) && $k[$schluessel] !== '' && $k[$schluessel] !== null ? $k[$schluessel] : $standard;
}

function retention_days(): int
{
    return (int) konfig('V2_RETENTION_DAYS', 730);
}

function daten_dir(): string
{
    return rtrim((string) konfig('DATEN_DIR', dirname(__DIR__) . '/daten'), '/');
}

// --- Antworten ----------------------------------------------------------------------
final class Antwort extends Exception
{
    public int $status;
    public $daten;
    public array $kopf;

    public function __construct($daten, int $status = 200, array $kopf = [])
    {
        parent::__construct('antwort');
        $this->daten = $daten;
        $this->status = $status;
        $this->kopf = $kopf;
    }
}

/** Antwort als JSON beenden (über Exception, damit der Router zentral ausgibt). */
function json_ende($daten, int $status = 200, array $kopf = []): void
{
    throw new Antwort($daten, $status, $kopf);
}

function fehler(string $code, int $status, array $extra = []): void
{
    json_ende((object) array_merge(['error' => $code], $extra), $status);
}

function json_text($daten): string
{
    return json_encode($daten, JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
}

// --- Sicherheits-Header (wie v2_api.CSP) ------------------------------------------------
function csp(): string
{
    $connect = ["'self'"];
    foreach ((array) konfig('CSP_CONNECT_EXTRA', []) as $u) { // z. B. https://ocr.graswachstum.ch
        if (preg_match('#^https://[a-z0-9.-]+$#D', (string) $u)) {
            $connect[] = $u;
        }
    }
    return implode('; ', [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "style-src-elem 'self'",
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob: https://i.ytimg.com",
        "font-src 'self'",
        'connect-src ' . implode(' ', $connect),
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    ]);
}

function sicherheits_header(bool $api): void
{
    header('Content-Security-Policy: ' . csp());
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Frame-Options: DENY');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()');
    header('Strict-Transport-Security: max-age=31536000');
    if ($api) {
        header('Cache-Control: no-store');
    }
}

// --- Datenbank (MySQL/MariaDB) ------------------------------------------------------------
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = (string) konfig('DB_DSN', '');
        if ($dsn === '') {
            throw new RuntimeException('DB_DSN fehlt in konfig.php');
        }
        $pdo = new PDO($dsn, (string) konfig('DB_USER', ''), (string) konfig('DB_PASS', ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_bin, time_zone = '+00:00'");
    }
    return $pdo;
}

function q(string $sql, array $par = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($par);
    return $st;
}

function zeile(string $sql, array $par = []): ?array
{
    $r = q($sql, $par)->fetch();
    return $r === false ? null : $r;
}

function wert(string $sql, array $par = [])
{
    $r = q($sql, $par)->fetchColumn();
    return $r === false ? null : $r;
}

/** Zeitstempel wie Python datetime.now(timezone.utc).replace(microsecond=0).isoformat() */
function jetzt_iso(): string
{
    return gmdate('Y-m-d\TH:i:s') . '+00:00';
}

function sha(string $token): string
{
    return hash('sha256', $token);
}

function zufall_id(int $bytes): string
{
    return b64url(random_bytes($bytes), false);
}

function b64url(string $roh, bool $polster = true): string
{
    $s = strtr(base64_encode($roh), '+/', '-_');
    return $polster ? $s : rtrim($s, '=');
}

function b64url_dec(string $s)
{
    $s = strtr($s, '-_', '+/');
    $s .= str_repeat('=', (4 - strlen($s) % 4) % 4);
    return base64_decode($s, true);
}

// --- Eingaben ------------------------------------------------------------------------------
/** JSON-Body wie v2_api._json_body: zu gross oder ungültig → null. Objekte als stdClass. */
function json_body()
{
    $roh = file_get_contents('php://input', false, null, 0, MAX_RECORD_BYTES * 40 + 1);
    if ($roh === false || strlen($roh) > MAX_RECORD_BYTES * 40) {
        return null;
    }
    try {
        return json_decode($roh, false, 64, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
    } catch (JsonException $e) {
        return null;
    }
}

/** Feld eines dekodierten JSON-Objekts (stdClass) oder Standard. */
function feld($obj, string $k, $standard = null)
{
    return ($obj instanceof stdClass && property_exists($obj, $k)) ? $obj->$k : $standard;
}

function ist_objekt($v): bool
{
    return $v instanceof stdClass;
}

function ist_liste($v): bool
{
    return is_array($v) && array_is_list($v);
}

/** Python-«Truthiness» für JSON-Werte (leere Objekte/Listen/Strings, 0, false, null sind falsch). */
function wahr($v): bool
{
    if ($v instanceof stdClass) {
        return count(get_object_vars($v)) > 0;
    }
    return (bool) $v;
}

function schluessel($obj): array
{
    return $obj instanceof stdClass ? array_map('strval', array_keys(get_object_vars($obj))) : [];
}

function kopfzeile(string $name): string
{
    $k = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$k]) ? (string) $_SERVER[$k] : '';
}

function arg(string $name, string $standard = ''): string
{
    return isset($_GET[$name]) && is_string($_GET[$name]) ? $_GET[$name] : $standard;
}

// --- Ratenbegrenzung (in der Datenbank; IPs nur gehasht) ------------------------------------
function client_key(): string
{
    return substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '?')), 0, 16);
}

function rate_hit(string $bucket, int $limit, int $fenster, ?string $schluessel = null): void
{
    $k = substr(hash('sha256', $bucket . '|' . ($schluessel ?? client_key())), 0, 32);
    $t = microtime(true);
    q('INSERT INTO futter_rate_treffer (schluessel, zeit) VALUES (?, ?)', [$k, $t]);
    if (random_int(1, 200) === 1) {
        q('DELETE FROM futter_rate_treffer WHERE zeit < ?', [$t - 86400]);
    }
    $n = (int) wert('SELECT COUNT(*) FROM futter_rate_treffer WHERE schluessel = ? AND zeit > ?', [$k, $t - $fenster]);
    if ($n > $limit) {
        fehler('RATE_LIMITED', 429);
    }
}

// --- Server-Schlüssel, Verschlüsselung (kompatibel zu v2_mail.text_enc/-dec) ------------------------
function server_key(): string
{
    static $key = null;
    if ($key === null) {
        $roh = b64url_dec((string) konfig('V2_SERVER_KEY', ''));
        if ($roh === false || strlen($roh) !== 32) {
            throw new RuntimeException('V2_SERVER_KEY fehlt oder ist ungültig (32 Byte base64url erwartet)');
        }
        $key = $roh;
    }
    return $key;
}

function text_enc(?string $text, string $aad = 'agff-email'): string
{
    $nonce = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt((string) $text, 'aes-256-gcm', server_key(), OPENSSL_RAW_DATA, $nonce, $tag, $aad, 16);
    if ($ct === false) {
        throw new RuntimeException('Verschlüsselung fehlgeschlagen');
    }
    return b64url($nonce . $ct . $tag);
}

function text_dec(?string $blob, string $aad = 'agff-email'): ?string
{
    $roh = b64url_dec((string) $blob);
    if ($roh === false || strlen($roh) < 28) {
        return null;
    }
    $pt = openssl_decrypt(substr($roh, 12, -16), 'aes-256-gcm', server_key(), OPENSSL_RAW_DATA, substr($roh, 0, 12), substr($roh, -16), $aad);
    return $pt === false ? null : $pt;
}

function email_norm(?string $email): string
{
    return mb_strtolower(trim((string) $email));
}

function email_ok($email): bool
{
    return is_string($email) && (bool) preg_match('/^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$/uD', email_norm($email));
}

function email_hmac(string $email): string
{
    return hash_hmac('sha256', 'email|' . email_norm($email), server_key());
}

function email_enc(string $email): string
{
    return text_enc(email_norm($email));
}

function email_dec(?string $blob): ?string
{
    return text_dec($blob);
}

function email_mask(?string $email): string
{
    if (!$email || strpos($email, '@') === false) {
        return '…';
    }
    [$local, $domain] = explode('@', $email, 2);
    $head = mb_strlen($local) > 3 ? mb_substr($local, 0, 2) : mb_substr($local, 0, 1);
    if (strpos($domain, '.') === false) {
        return $head . '…@…';
    }
    $i = strrpos($domain, '.');
    $name = substr($domain, 0, $i);
    $tld = substr($domain, $i + 1);
    return $head . '…@…' . mb_substr($name, -2) . '.' . $tld;
}

// --- Python-Gleichheit ------------------------------------------------------------------------
/** json.dumps(v) wie Python (Trenner «, » und «: »); $ascii = ensure_ascii (Standard in Python: True). */
function py_json($v, bool $ascii = true): string
{
    if ($v instanceof stdClass) {
        $t = [];
        foreach (get_object_vars($v) as $k => $x) {
            $t[] = py_json((string) $k, $ascii) . ': ' . py_json($x, $ascii);
        }
        return '{' . implode(', ', $t) . '}';
    }
    if (is_array($v)) {
        return '[' . implode(', ', array_map(fn ($x) => py_json($x, $ascii), $v)) . ']';
    }
    if (is_float($v)) {
        return py_float($v);
    }
    return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | ($ascii ? 0 : JSON_UNESCAPED_UNICODE));
}

/** json.dumps(v, ensure_ascii=False, separators=(',', ':')) wie Python. */
function py_json_kompakt($v): string
{
    if ($v instanceof stdClass) {
        $t = [];
        foreach (get_object_vars($v) as $k => $x) {
            $t[] = py_json((string) $k, false) . ':' . py_json_kompakt($x);
        }
        return '{' . implode(',', $t) . '}';
    }
    if (is_array($v)) {
        return '[' . implode(',', array_map('py_json_kompakt', $v)) . ']';
    }
    return py_json($v, false);
}

/** repr(float) wie Python: kürzeste exakte Ziffernfolge; Festkomma für Exponent -4 … 15, sonst «1.5e-07». */
function py_float(float $x): string
{
    if (is_nan($x)) {
        return 'NaN';
    }
    if (is_infinite($x)) {
        return $x > 0 ? 'Infinity' : '-Infinity';
    }
    if ($x == 0.0) {
        return (1 / $x < 0) ? '-0.0' : '0.0';
    }
    for ($p = 0; $p < 17; $p++) {
        $e = sprintf('%.' . $p . 'e', $x);
        if ((float) $e === $x) {
            break;
        }
    }
    [$mant, $exp] = explode('e', $e);
    $exp = (int) $exp;
    $neg = $mant[0] === '-';
    $ziffern = str_replace(['-', '.'], '', $mant);
    $ziffern = rtrim($ziffern, '0') ?: '0';
    if ($exp >= -4 && $exp < 16) {
        if ($exp >= 0) {
            $ganz = substr(str_pad($ziffern, $exp + 1, '0'), 0, $exp + 1);
            $rest = substr($ziffern, $exp + 1);
            $t = $ganz . '.' . ($rest === '' ? '0' : $rest);
        } else {
            $t = '0.' . str_repeat('0', -$exp - 1) . $ziffern;
        }
    } else {
        $t = $ziffern[0] . (strlen($ziffern) > 1 ? '.' . substr($ziffern, 1) : '') . 'e' . ($exp < 0 ? '-' : '+') . sprintf('%02d', abs($exp));
    }
    return ($neg ? '-' : '') . $t;
}

/** int(v) wie Python für JSON-Werte; null bei TypeError/ValueError. */
function py_int($v): ?int
{
    if (is_bool($v)) {
        return $v ? 1 : 0;
    }
    if (is_int($v)) {
        return $v;
    }
    if (is_float($v)) {
        return is_finite($v) ? (int) $v : null;
    }
    if (is_string($v) && preg_match('/^\s*[+-]?\d+(_\d+)*\s*$/', $v)) {
        return (int) str_replace('_', '', trim($v));
    }
    return null;
}

/** datetime.now(timezone.utc).isoformat(): Mikrosekunden nur, wenn nicht 0. */
function jetzt_fein(): string
{
    $t = DateTime::createFromFormat('U.u', sprintf('%.6F', microtime(true)), new DateTimeZone('UTC'));
    $us = (int) $t->format('u');
    return $t->format('Y-m-d\TH:i:s') . ($us ? '.' . $t->format('u') : '') . '+00:00';
}

/** str(v) wie Python für JSON-Werte (True/False/None, 5.0, Text unverändert). */
function py_str($v): string
{
    if ($v === null) {
        return 'None';
    }
    if (is_bool($v)) {
        return $v ? 'True' : 'False';
    }
    if (is_float($v)) {
        return py_float($v);
    }
    if (is_string($v)) {
        return $v;
    }
    if (is_int($v)) {
        return (string) $v;
    }
    return py_json($v);
}

/** Text auf n Zeichen kürzen wie Python s[:n] (Zeichen, nicht Bytes). */
function py_kurz(string $s, int $n): string
{
    return mb_substr($s, 0, $n);
}
