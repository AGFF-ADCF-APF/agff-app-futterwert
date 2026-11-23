<?php
/**
 * Freigabe-Bereiche (Spaces): Speichern eines Anlasses auf dem Server, Zugriff nur mit Lese- bzw. Bearbeiten-Link,
 * Gruppen-Beitritt per 8-stelligem Code, Fotos – portiert aus v2_api.py.
 */
declare(strict_types=1);

const MAX_RECORDS_PER_SPACE = 1000;
const HASH_RE = '/^[0-9a-f]{64}$/D';
const FOTO_ID_RE = '/^[A-Za-z0-9_-]{16}$/D';
const MAX_FOTO_BYTES = 5 * 1024 * 1024;
const MAX_FOTOS_PER_SPACE = 400;
const PROBE_KEYS = ['id', 'typ', 'createdAt', 'updatedAt', 'quelle', 'kopf', 'antworten', 'rad'];
const SHORT_RE = '/^[A-Za-z0-9_.-]{0,16}$/';
const DATE_RE = '/^\d{4}-\d{2}-\d{2}$/';
const ISO_RE = '/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/';
const KEY_RE = '/^[A-Za-z0-9_.-]{1,40}$/';
const CTRL_RE = '/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/';
const CODE_ZEICHEN = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function foto_dir(): string
{
    return rtrim((string) konfig('FOTO_DIR', daten_dir() . '/v2_fotos'), '/');
}

function max_foto_total(): int
{
    return (int) konfig('V2_FOTO_MB_PRO_PERSON', 20) * 1024 * 1024;
}

// --- Inhaltsprüfung (wie _scalar_ok, _frei_ok, _check_privat, _check_record) ----------------------
function scalar_ok($v): bool
{
    if (is_bool($v) || $v === null) {
        return true;
    }
    if (is_int($v) || is_float($v)) {
        return abs($v) < 1e6;
    }
    return is_string($v) && (bool) preg_match(SHORT_RE, $v);
}

function frei_ok($v, int $tiefe = 0): bool
{
    if ($v === null || is_bool($v)) {
        return true;
    }
    if (is_int($v) || is_float($v)) {
        return abs($v) < 1e12;
    }
    if (is_string($v)) {
        return mb_strlen($v) <= 5000 && !preg_match(CTRL_RE, $v);
    }
    if ($tiefe >= 4) {
        return false;
    }
    if (is_array($v)) {
        if (count($v) > 60) {
            return false;
        }
        foreach ($v as $x) {
            if (!frei_ok($x, $tiefe + 1)) {
                return false;
            }
        }
        return true;
    }
    if ($v instanceof stdClass) {
        $felder = get_object_vars($v);
        if (count($felder) > 80) {
            return false;
        }
        foreach ($felder as $k => $x) {
            if (!preg_match(KEY_RE, (string) $k) || !frei_ok($x, $tiefe + 1)) {
                return false;
            }
        }
        return true;
    }
    return false;
}

function check_privat($pv): bool
{
    if ($pv === null) {
        return true;
    }
    if (!ist_objekt($pv) || !frei_ok($pv)) {
        return false;
    }
    return strlen(py_json($pv, false)) <= MAX_RECORD_BYTES;
}

function check_record(string $record_id, $data): bool
{
    if (!ist_objekt($data) || array_diff(schluessel($data), ['analyse', 'privat'])) {
        return false;
    }
    $an = feld($data, 'analyse');
    $an = wahr($an) ? $an : new stdClass();
    if (!ist_objekt($an) || !check_privat(feld($data, 'privat'))) {
        return false;
    }
    if ($record_id === 'anlassmeta') {
        $d = feld($an, 'datum');
        return !array_diff(schluessel($an), ['id', 'datum']) && ($d === null || $d === '' || (bool) preg_match(DATE_RE, py_str($d)));
    }
    if (array_diff(schluessel($an), PROBE_KEYS) || feld($an, 'id') !== $record_id || !in_array(feld($an, 'typ'), FUTTERARTEN, true)) {
        return false;
    }
    foreach (['createdAt', 'updatedAt'] as $k) {
        $v = feld($an, $k);
        if ($v !== null && !(is_string($v) && preg_match(ISO_RE, $v))) {
            return false;
        }
    }
    if (!in_array(feld($an, 'quelle'), [null, 'v1'], true)) {
        return false;
    }
    $kopf = feld($an, 'kopf');
    $kopf = wahr($kopf) ? $kopf : new stdClass();
    if (!ist_objekt($kopf) || array_diff(schluessel($kopf), ['schnitt']) || (wahr(feld($kopf, 'schnitt')) && !preg_match(DATE_RE, py_str($kopf->schnitt)))) {
        return false;
    }
    foreach (['antworten', 'rad'] as $teil) {
        $d = feld($an, $teil);
        $d = wahr($d) ? $d : new stdClass();
        if (!ist_objekt($d) || count(get_object_vars($d)) > 40) {
            return false;
        }
        foreach (get_object_vars($d) as $k => $v) {
            if (!preg_match(SHORT_RE, (string) $k) || !scalar_ok($v)) {
                return false;
            }
        }
    }
    return true;
}

// --- Zugriff -------------------------------------------------------------------------------
function purge_expired(): void
{
    $grenze = gmdate('Y-m-d\TH:i:s', time() - retention_days() * 86400);
    foreach (q('SELECT id FROM e2e_spaces WHERE updated_at < ?', [$grenze])->fetchAll(PDO::FETCH_COLUMN) as $id) {
        fotos_entfernen($id);
    }
    q('DELETE FROM e2e_spaces WHERE updated_at < ?', [$grenze]);
}

function ordner_loeschen(string $pfad): void
{
    if (!is_dir($pfad)) {
        return;
    }
    foreach (scandir($pfad) as $f) {
        if ($f !== '.' && $f !== '..') {
            is_dir("$pfad/$f") ? ordner_loeschen("$pfad/$f") : @unlink("$pfad/$f");
        }
    }
    @rmdir($pfad);
}

function fotos_entfernen(string $space_id): void
{
    if (preg_match(ID_RE, $space_id)) {
        ordner_loeschen(foto_dir() . '/' . $space_id);
    }
}

function foto_pfad(string $space_id, string $foto_id): string
{
    return foto_dir() . '/' . $space_id . '/' . $foto_id . '.bin';
}

/** Lese- bzw. Schreib-Token prüfen. Space-Zeile oder null (keine Unterscheidung nach aussen). */
function space_auth(string $space_id, bool $schreiben = false): ?array
{
    if (!preg_match(ID_RE, $space_id)) {
        return null;
    }
    $row = zeile('SELECT * FROM e2e_spaces WHERE id = ?', [$space_id]);
    if (!$row) {
        return null;
    }
    [$kopf, $spalte] = $schreiben ? ['X-Write-Token', 'write_hash'] : ['X-Read-Token', 'read_hash'];
    $token = kopfzeile($kopf);
    if (!preg_match(TOKEN_RE, $token) || !hash_equals($row[$spalte], sha($token))) {
        rate_hit('auth_fail', 60, 600);
        return null;
    }
    return $row;
}

function space_touch(string $space_id): void
{
    q('UPDATE e2e_spaces SET updated_at = ? WHERE id = ?', [jetzt_iso(), $space_id]);
}

function record_speichern(string $space_id, string $record_id, stdClass $data, string $client_updated): void
{
    $an = feld($data, 'analyse');
    $pv = feld($data, 'privat');
    q('INSERT INTO e2e_records (space_id, id, analyse, privat, client_updated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
        . 'ON DUPLICATE KEY UPDATE analyse = VALUES(analyse), privat = VALUES(privat), client_updated_at = VALUES(client_updated_at), updated_at = VALUES(updated_at)',
        [$space_id, $record_id, py_json(wahr($an) ? $an : new stdClass(), false), wahr($pv) ? py_json($pv) : null, $client_updated, jetzt_iso()]);
}

/** str(body.get('updatedAt') or '')[:40] */
function client_zeit($v): string
{
    return wahr($v) ? py_kurz(py_str($v), 40) : '';
}

// --- Routen --------------------------------------------------------------------------------
function r_space_code(): void
{
    rate_hit('space_code', 20, 3600);
    $b = json_body();
    $email = feld(wahr($b) ? $b : new stdClass(), 'email');
    if (!email_ok($email)) {
        fehler('BAD_REQUEST', 400);
    }
    code_senden('space', $email, 'Speichern auf dem Server');
    json_ende(['status' => 'sent']);
}

function r_space_anlegen(): void
{
    rate_hit('create', 30, 3600);
    $body = json_body();
    $body = wahr($body) ? $body : new stdClass();
    $consent = feld($body, 'consent');
    $consent = wahr($consent) ? $consent : new stdClass();
    if (feld($consent, 'accepted') !== true) {
        fehler('CONSENT_REQUIRED', 400);
    }
    if (feld($consent, 'version') !== CONSENT_VERSION) {
        fehler('CONSENT_OUTDATED', 409, ['consentVersion' => CONSENT_VERSION]);
    }
    $rh = feld($body, 'readHash', '');
    $wh = feld($body, 'writeHash', '');
    if (!(is_string($rh) && is_string($wh) && preg_match(HASH_RE, $rh) && preg_match(HASH_RE, $wh)) || $rh === $wh) {
        fehler('BAD_KEYS', 400);
    }
    $email = konto_email();
    if (!$email) {
        $e = feld($body, 'email');
        $email = email_norm(is_string($e) ? $e : '');
        if (!email_ok($email)) {
            fehler('EMAIL_REQUIRED', 400);
        }
        if (!code_pruefen('space', $email, feld($body, 'code'))) {
            fehler('CODE_INVALID', 400);
        }
    }
    $id = zufall_id(9);
    $jetzt = jetzt_iso();
    purge_expired();
    q('INSERT INTO e2e_spaces (id, read_hash, write_hash, consent_version, consent_at, owner_email_hmac, owner_email_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$id, $rh, $wh, CONSENT_VERSION, $jetzt, email_hmac($email), email_enc($email), $jetzt, $jetzt]);
    json_ende(['id' => $id, 'consentAt' => $jetzt, 'retentionDays' => retention_days()], 201);
}

function r_space_lesen(string $space_id): void
{
    $space = space_auth($space_id);
    if (!$space) {
        fehler('NOT_FOUND', 404);
    }
    $records = [];
    foreach (q('SELECT id, analyse, privat, client_updated_at, updated_at FROM e2e_records WHERE space_id = ?', [$space_id])->fetchAll() as $r) {
        $records[] = ['id' => $r['id'], 'data' => ['analyse' => json_decode($r['analyse'], false), 'privat' => $r['privat'] ? json_decode($r['privat'], false) : null],
            'clientUpdatedAt' => $r['client_updated_at'], 'updatedAt' => $r['updated_at']];
    }
    json_ende(['space' => ['id' => $space['id'], 'epoch' => (int) $space['epoch'], 'createdAt' => $space['created_at'], 'updatedAt' => $space['updated_at'],
        'consentAt' => $space['consent_at'], 'consentVersion' => $space['consent_version']], 'records' => $records, 'retentionDays' => retention_days()]);
}

function r_space_loeschen(string $space_id): void
{
    if (!space_auth($space_id, true)) {
        fehler('NOT_FOUND', 404);
    }
    q('DELETE FROM e2e_spaces WHERE id = ?', [$space_id]);
    fotos_entfernen($space_id);
    json_ende(['status' => 'deleted']);
}

function r_record_speichern(string $space_id, string $record_id): void
{
    if (!preg_match(ID_RE, $record_id)) {
        fehler('BAD_ID', 400);
    }
    $roh = file_get_contents('php://input', false, null, 0, MAX_RECORD_BYTES + 1);
    if (strlen((string) $roh) > MAX_RECORD_BYTES) {
        fehler('TOO_LARGE', 413);
    }
    try {
        $body = json_decode((string) $roh, false, 64, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
    } catch (JsonException $e) {
        fehler('BAD_JSON', 400);
    }
    if (!ist_objekt($body)) {
        throw new RuntimeException('Body ist kein Objekt'); // Python: AttributeError → 500
    }
    $data = feld($body, 'data');
    if (!check_record($record_id, $data)) {
        fehler('REJECTED_CONTENT', 422);
    }
    $client = client_zeit(feld($body, 'updatedAt'));
    if (!space_auth($space_id, true)) {
        fehler('NOT_FOUND', 404);
    }
    db()->beginTransaction();
    $alt = zeile('SELECT client_updated_at FROM e2e_records WHERE space_id = ? AND id = ? FOR UPDATE', [$space_id, $record_id]);
    if ($alt === null) {
        if ((int) wert('SELECT COUNT(*) FROM e2e_records WHERE space_id = ?', [$space_id]) >= MAX_RECORDS_PER_SPACE) {
            db()->rollBack();
            fehler('SPACE_FULL', 409);
        }
    } elseif ($alt['client_updated_at'] && $client !== '' && strcmp($alt['client_updated_at'], $client) > 0) {
        db()->rollBack();
        json_ende(['status' => 'stale'], 409);
    }
    record_speichern($space_id, $record_id, $data, $client);
    space_touch($space_id);
    db()->commit();
    json_ende(['status' => 'ok']);
}

function r_record_loeschen(string $space_id, string $record_id): void
{
    if (!space_auth($space_id, true)) {
        fehler('NOT_FOUND', 404);
    }
    q('DELETE FROM e2e_records WHERE space_id = ? AND id = ?', [$space_id, $record_id]);
    space_touch($space_id);
    json_ende(['status' => 'deleted']);
}

/** Links erneuern: neue Token-Hashes und aktueller Stand der Datensätze in einer Transaktion. */
function r_space_rotate(string $space_id): void
{
    $body = json_body();
    $body = wahr($body) ? $body : new stdClass();
    $rh = feld($body, 'readHash', '');
    $wh = feld($body, 'writeHash', '');
    $recs = feld($body, 'records');
    if (!(is_string($rh) && is_string($wh) && preg_match(HASH_RE, $rh) && preg_match(HASH_RE, $wh)) || $rh === $wh || !ist_liste($recs) || count($recs) > MAX_RECORDS_PER_SPACE + 1) {
        fehler('BAD_REQUEST', 400);
    }
    foreach ($recs as $r) {
        $rid = ist_objekt($r) ? py_str(feld($r, 'id', '')) : '';
        if (!ist_objekt($r) || !preg_match('/^[A-Za-z0-9_-]{6,64}$/', $rid) || !check_record(py_str(feld($r, 'id')), feld($r, 'data'))) {
            fehler('REJECTED_CONTENT', 422, ['id' => ist_objekt($r) ? py_kurz(py_str(feld($r, 'id', '')), 64) : null]);
        }
    }
    $space = space_auth($space_id, true);
    if (!$space) {
        fehler('NOT_FOUND', 404);
    }
    db()->beginTransaction();
    q('DELETE FROM e2e_records WHERE space_id = ?', [$space_id]);
    foreach ($recs as $r) {
        record_speichern($space_id, (string) $r->id, $r->data, client_zeit(feld($r, 'updatedAt')));
    }
    q('UPDATE e2e_spaces SET read_hash = ?, write_hash = ?, epoch = epoch + 1, beitritt_hmac = NULL, beitritt_enc = NULL, updated_at = ? WHERE id = ?',
        [$rh, $wh, jetzt_iso(), $space_id]);
    db()->commit();
    json_ende(['status' => 'rotated', 'epoch' => (int) $space['epoch'] + 1]);
}

// --- Gruppen-Beitritt mit 8-stelligem Code ----------------------------------------------------------
function beitritt_code_norm($code): string
{
    $s = $code === null || $code === false || $code === '' || $code === 0 ? '' : py_str($code);
    return mb_strtoupper(mb_substr(preg_replace('/[\s-]/u', '', $s), 0, 20));
}

function beitritt_hmac(string $code): string
{
    return hash_hmac('sha256', 'gruppe|' . $code, server_key());
}

/** Wie im Browser (crypto.js): HKDF-SHA256(secret, salt «agff-futter-v2», info «auth-write») → base64url. */
function write_token_aus(string $secret): string
{
    $roh = b64url_dec($secret);
    return b64url(hash_hkdf('sha256', (string) $roh, 32, 'auth-write', 'agff-futter-v2'), false);
}

function beitritt_lesen(array $space): ?array
{
    if (!$space['beitritt_enc']) {
        return null;
    }
    $j = json_decode((string) text_dec($space['beitritt_enc'], 'gruppe-beitritt'), true);
    return is_array($j) ? $j : null;
}

function r_beitritt(string $space_id): void
{
    $space = space_auth($space_id, true);
    if (!$space) {
        fehler('NOT_FOUND', 404);
    }
    $m = $_SERVER['REQUEST_METHOD'];
    if ($m === 'GET' || $m === 'HEAD') {
        $b = beitritt_lesen($space);
        json_ende(['code' => $b['code'] ?? null]);
    }
    if ($m === 'DELETE') {
        q('UPDATE e2e_spaces SET beitritt_hmac = NULL, beitritt_enc = NULL WHERE id = ?', [$space_id]);
        json_ende(['code' => null]);
    }
    rate_hit('beitritt_neu', 20, 3600);
    $body = json_body();
    $body = wahr($body) ? $body : new stdClass();
    $secret = feld($body, 'secret');
    if (!is_string($secret) || !preg_match(TOKEN_RE, $secret) || !hash_equals($space['write_hash'], sha(write_token_aus($secret)))) {
        fehler('BAD_KEYS', 400);
    }
    $b = beitritt_lesen($space);
    if ($b && ($b['secret'] ?? null) === $secret && !wahr(feld($body, 'neu'))) {
        json_ende(['code' => $b['code']]);
    }
    for ($i = 0; $i < 5; $i++) {
        $code = '';
        for ($j = 0; $j < 8; $j++) {
            $code .= CODE_ZEICHEN[random_int(0, strlen(CODE_ZEICHEN) - 1)];
        }
        if (!wert('SELECT 1 FROM e2e_spaces WHERE beitritt_hmac = ?', [beitritt_hmac($code)])) {
            break;
        }
    }
    q('UPDATE e2e_spaces SET beitritt_hmac = ?, beitritt_enc = ? WHERE id = ?',
        [beitritt_hmac($code), text_enc(py_json((object) ['code' => $code, 'secret' => $secret]), 'gruppe-beitritt'), $space_id]);
    json_ende(['code' => $code]);
}

/** Code → Bearbeiten-Link der Gruppe. Gleiche Antwort für «falsch» und «nicht vorhanden». */
function r_gruppe_beitreten(): void
{
    rate_hit('beitritt', 10, 900);
    $b = json_body();
    $code = beitritt_code_norm(feld(wahr($b) ? $b : new stdClass(), 'code'));
    if (!preg_match('/^[' . CODE_ZEICHEN . ']{8}$/', $code)) {
        fehler('NOT_FOUND', 404);
    }
    purge_expired();
    $space = zeile('SELECT * FROM e2e_spaces WHERE beitritt_hmac = ?', [beitritt_hmac($code)]);
    $bt = $space ? beitritt_lesen($space) : null;
    if (!$bt || ($bt['code'] ?? null) !== $code) {
        rate_hit('beitritt_fehl', 300, 3600, '*'); // Fehlversuche zusätzlich über alle Geräte begrenzen
        fehler('NOT_FOUND', 404);
    }
    json_ende(['id' => $space['id'], 'secret' => $bt['secret']]);
}

// --- Fotos -----------------------------------------------------------------------------------------
function bild_typ(string $kopf): ?string
{
    if (strncmp($kopf, "\xff\xd8\xff", 3) === 0) {
        return 'image/jpeg';
    }
    if (strncmp($kopf, 'RIFF', 4) === 0 && substr($kopf, 8, 4) === 'WEBP') {
        return 'image/webp';
    }
    return null;
}

/** Foto ausliefern: Typ aus dem Dateikopf (Altbestand verschlüsselt → octet-stream), nie zwischenspeichern. */
function bild_senden(string $pfad): void
{
    $fh = @fopen($pfad, 'rb');
    if (!$fh) {
        fehler('NOT_FOUND', 404);
    }
    $typ = bild_typ((string) fread($fh, 12)) ?? 'application/octet-stream';
    fclose($fh);
    sicherheits_header(true);
    header('Content-Type: ' . $typ);
    header('Content-Length: ' . filesize($pfad));
    header('Content-Disposition: inline');
    header('Cache-Control: no-store');
    readfile($pfad);
    exit;
}

/** Hochgeladene Bilddaten lesen (höchstens MAX_FOTO_BYTES + 1). */
function bild_body(): string
{
    return (string) file_get_contents('php://input', false, null, 0, MAX_FOTO_BYTES + 1);
}

function datei_ablegen(string $pfad, string $daten): void
{
    if (!is_dir(dirname($pfad))) {
        mkdir(dirname($pfad), 0700, true);
    }
    $tmp = $pfad . '.tmp';
    file_put_contents($tmp, $daten, LOCK_EX);
    rename($tmp, $pfad);
}

function r_foto_hochladen(string $space_id, string $foto_id): void
{
    if (!preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('BAD_ID', 400);
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_FOTO_BYTES) {
        fehler('TOO_LARGE', 413);
    }
    $daten = bild_body();
    if (strlen($daten) > MAX_FOTO_BYTES || strlen($daten) < 100 || !bild_typ(substr($daten, 0, 12))) {
        fehler('REJECTED_CONTENT', 422);
    }
    if (!space_auth($space_id, true)) {
        fehler('NOT_FOUND', 404);
    }
    $r = zeile('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS total FROM e2e_fotos WHERE space_id = ? AND id != ?', [$space_id, $foto_id]);
    $eigner = wert('SELECT owner_email_hmac FROM e2e_spaces WHERE id = ?', [$space_id]);
    $limit = foto_limit($eigner ?: null, max_foto_total());
    if ((int) $r['n'] >= MAX_FOTOS_PER_SPACE || (int) $r['total'] + strlen($daten) > $limit) {
        fehler('QUOTA', 409, ['bytes' => (int) $r['total'], 'limit' => $limit, 'bereich' => 'gruppe']);
    }
    if (!foto_platz_frei(strlen($daten))) {
        fehler('SERVER_VOLL', 507);
    }
    datei_ablegen(foto_pfad($space_id, $foto_id), $daten);
    q('INSERT INTO e2e_fotos (space_id, id, bytes, created_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE bytes = VALUES(bytes)',
        [$space_id, $foto_id, strlen($daten), jetzt_iso()]);
    space_touch($space_id);
    json_ende(['status' => 'ok']);
}

function r_foto_lesen(string $space_id, string $foto_id): void
{
    if (!preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('BAD_ID', 400);
    }
    if (!space_auth($space_id)) {
        fehler('NOT_FOUND', 404);
    }
    if (!wert('SELECT 1 FROM e2e_fotos WHERE space_id = ? AND id = ?', [$space_id, $foto_id])) {
        fehler('NOT_FOUND', 404);
    }
    bild_senden(foto_pfad($space_id, $foto_id));
}

function r_foto_loeschen(string $space_id, string $foto_id): void
{
    if (!preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('BAD_ID', 400);
    }
    if (!space_auth($space_id, true)) {
        fehler('NOT_FOUND', 404);
    }
    q('DELETE FROM e2e_fotos WHERE space_id = ? AND id = ?', [$space_id, $foto_id]);
    space_touch($space_id);
    @unlink(foto_pfad($space_id, $foto_id));
    json_ende(['status' => 'deleted']);
}
