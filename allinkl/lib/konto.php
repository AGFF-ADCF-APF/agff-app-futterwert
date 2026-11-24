<?php
/**
 * Konto (Anmeldung per E-Mail) und Cloud-Speicherung je App – portiert aus v2_konto.py.
 * Sitzung über Kopfzeile «X-Konto» (24 Monate), Anmelde-Link 24 Monate, Daten als JSON mit Grabsteinen,
 * Fotos mit Kontingent, Antrag auf mehr Foto-Speicher.
 */
declare(strict_types=1);

const LINK_TAGE = 730;
const SESSION_TAGE = 730;
const MAX_LINKS = 30;
const APPS = ['futter', 'wiese'];
const REC_ID_RE = '/^[A-Za-z0-9:_.-]{1,90}$/';
const MAX_REC_BYTES = 512 * 1024;
const MAX_RECS = 6000;
const MAX_DATEN_BYTES = 60 * 1024 * 1024;
const CONSENT_VERSION_KONTO = '2026-10-konto1';

function konto_foto_standard(): int
{
    return (int) konfig('V2_KONTO_FOTO_MB', 100) * 1024 * 1024;
}

// --- Sitzung (auch von anderen Modulen genutzt) -----------------------------------------------------
/** Konto der Sitzung aus Kopfzeile «X-Konto» (Zeile mit sid, expires_at und den Konto-Spalten) oder null. */
function konto_sitzung(): ?array
{
    $tok = kopfzeile('X-Konto');
    if (!preg_match(TOKEN_RE, $tok)) {
        return null;
    }
    $s = zeile('SELECT s.id AS sid, s.expires_at, k.* FROM futter_konto_sessions s JOIN futter_konten k ON k.id = s.konto_id WHERE s.token_hash = ?', [sha('konto|' . $tok)]);
    if (!$s || (float) $s['expires_at'] < microtime(true)) {
        rate_hit('konto_fail', 60, 600);
        return null;
    }
    $jetzt = jetzt_iso();
    if (substr((string) $s['last_seen'], 0, 10) !== substr($jetzt, 0, 10)) {
        q('UPDATE futter_konten SET last_seen = ? WHERE id = ?', [$jetzt, $s['id']]);
        q('UPDATE futter_konto_sessions SET last_used = ? WHERE id = ?', [$jetzt, $s['sid']]);
    }
    return $s;
}

/** Bestätigte Adresse der aktuellen Sitzung (oder null). */
function konto_email(): ?string
{
    $k = konto_sitzung();
    return $k ? email_dec($k['email_enc']) : null;
}

/** Standard-Kontingent plus vom Betreiber freigegebene Zusatz-MB für diese Adresse. */
function foto_limit(?string $email_hmac, int $standard): int
{
    if (!$email_hmac) {
        return $standard;
    }
    $mb = wert('SELECT mb FROM futter_foto_quota WHERE email_hmac = ?', [$email_hmac]);
    return $standard + ($mb !== null ? (int) $mb * 1024 * 1024 : 0);
}

/** Gesamtobergrenze für Fotos auf dem Server (v2_admin.foto_platz_frei). */
function foto_platz_frei(int $zusatz): bool
{
    return foto_bytes_gesamt() + $zusatz <= (int) konfig('V2_FOTO_GESAMT_MB', 5000) * 1024 * 1024;
}

function foto_bytes_gesamt(): int
{
    $t = 0;
    foreach (['futter_e2e_fotos', 'futter_kurs_fotos', 'futter_pool_fotos'] as $tab) {
        $t += (int) wert("SELECT COALESCE(SUM(bytes), 0) FROM $tab");
    }
    return $t;
}

// --- Hilfen ----------------------------------------------------------------------------------------
function konto_purge(): void
{
    $grenze = gmdate('Y-m-d\TH:i:s', time() - retention_days() * 86400);
    foreach (q('SELECT id FROM futter_konten WHERE last_seen < ?', [$grenze])->fetchAll(PDO::FETCH_COLUMN) as $id) {
        konto_fotos_weg($id);
    }
    q('DELETE FROM futter_konten WHERE last_seen < ?', [$grenze]);
    q('DELETE FROM futter_konto_links WHERE expires_at < ?', [microtime(true)]);
    q('DELETE FROM futter_konto_sessions WHERE expires_at < ?', [microtime(true)]);
}

function konto_foto_pfad(string $konto_id, string $foto_id): string
{
    return foto_dir() . '/konto_' . $konto_id . '/' . $foto_id . '.bin';
}

function konto_fotos_weg(string $konto_id): void
{
    if (preg_match('/^[A-Za-z0-9_-]+$/D', $konto_id)) {
        ordner_loeschen(foto_dir() . '/konto_' . $konto_id);
    }
}

function geraet_name(): string
{
    $ua = mb_substr(kopfzeile('User-Agent'), 0, 300);
    $teile = [];
    foreach ([['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Android', 'Android'], ['Windows', 'Windows'], ['Mac', 'Macintosh'], ['Linux', 'Linux']] as [$n, $p]) {
        if (strpos($ua, $p) !== false) {
            $teile[] = $n;
            break;
        }
    }
    foreach ([['Edge', 'Edg/'], ['Firefox', 'Firefox/'], ['Chrome', 'Chrome/'], ['Safari', 'Safari/']] as [$n, $p]) {
        if (strpos($ua, $p) !== false) {
            $teile[] = $n;
            break;
        }
    }
    return $teile ? implode(' · ', $teile) : 'Browser';
}

function konto_anmelden(string $email, string $via): string
{
    $eh = email_hmac($email);
    $k = zeile('SELECT * FROM futter_konten WHERE email_hmac = ?', [$eh]);
    if (!$k) {
        $kid = zufall_id(9);
        q('INSERT INTO futter_konten (id, email_hmac, email_enc, created_at, last_seen) VALUES (?, ?, ?, ?, ?)', [$kid, $eh, email_enc($email), jetzt_iso(), jetzt_iso()]);
    } else {
        $kid = $k['id'];
        q('UPDATE futter_konten SET last_seen = ? WHERE id = ?', [jetzt_iso(), $kid]);
    }
    $tok = zufall_id(32);
    q('INSERT INTO futter_konto_sessions (id, konto_id, token_hash, via, geraet, created_at, last_used, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [zufall_id(9), $kid, sha('konto|' . $tok), $via, geraet_name(), jetzt_iso(), jetzt_iso(), microtime(true) + SESSION_TAGE * 86400]);
    return $tok;
}

function konto_oder_404(): array
{
    $k = konto_sitzung();
    if (!$k) {
        fehler('NOT_FOUND', 404);
    }
    return $k;
}

function host(): string
{
    return (string) ($_SERVER['HTTP_HOST'] ?? '');
}

// --- Anmeldung -------------------------------------------------------------------------------------
function r_konto_code(): void
{
    rate_hit('konto_code', 10, 3600);
    $body = json_body();
    $body = wahr($body) ? $body : new stdClass();
    $e = feld($body, 'email');
    $email = email_norm(wahr($e) ? py_str($e) : '');
    if (!email_ok($email)) {
        fehler('BAD_REQUEST', 400);
    }
    // Link nur auf diesen Server: Host aus der Anfrage, nie fremde Domains
    $basis = wahr(feld($body, 'appUrl')) ? py_str($body->appUrl) : '';
    $u = parse_url($basis);
    $u = is_array($u) ? $u : [];
    $netloc = ($u['host'] ?? '') . (isset($u['port']) ? ':' . $u['port'] : '');
    $lokal = in_array($u['host'] ?? '', ['localhost', '127.0.0.1'], true);
    $pfad = $u['path'] ?? '/';
    if ($netloc !== host() || (($u['scheme'] ?? '') !== 'https' && !$lokal) || !preg_match('#^/[A-Za-z0-9/_.-]*$#', $pfad === '' ? '/' : $pfad)
        || isset($u['query']) || isset($u['fragment']) || isset($u['user'])) {
        $basis = 'https://' . host() . basis_pfad();
    } else {
        $basis = $u['scheme'] . '://' . $netloc . ($pfad === '' ? '/' : $pfad);
    }
    $code = code_erzeugen('konto', $email);
    $lid = zufall_id(9);
    $geheim = zufall_id(32);
    $eh = email_hmac($email);
    q('INSERT INTO futter_konto_links (id, email_hmac, email_enc, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [$lid, $eh, email_enc($email), sha('link|' . $geheim), jetzt_iso(), microtime(true) + LINK_TAGE * 86400]);
    $alte = q('SELECT id FROM futter_konto_links WHERE email_hmac = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 18446744073709551615 OFFSET ' . MAX_LINKS, [$eh])->fetchAll(PDO::FETCH_COLUMN);
    foreach ($alte as $id) {
        q('UPDATE futter_konto_links SET revoked = 1 WHERE id = ?', [$id]);
    }
    login_senden($email, $code, $basis . '#login=' . $lid . '.' . $geheim, modus() === 'wiese' ? 'Wiese' : 'Futterbeurteilung');
    json_ende(['status' => 'sent']);
}

function r_konto_login(): void
{
    rate_hit('konto_login', 30, 900);
    $body = json_body();
    $body = wahr($body) ? $body : new stdClass();
    $link = wahr(feld($body, 'link')) ? py_str($body->link) : '';
    konto_purge();
    if ($link !== '') {
        $m = preg_match('/^([A-Za-z0-9_-]{6,20})\.([A-Za-z0-9_-]{43})$/', $link, $t);
        $r = $m ? zeile('SELECT * FROM futter_konto_links WHERE id = ?', [$t[1]]) : null;
        if (!$r || $r['revoked'] || (float) $r['expires_at'] < microtime(true) || !hash_equals($r['secret_hash'], sha('link|' . $t[2]))) {
            rate_hit('konto_link_fail', 10, 900);
            fehler('LINK_UNGUELTIG', 404);
        }
        $email = email_dec($r['email_enc']);
        if (!$email) {
            fehler('LINK_UNGUELTIG', 404);
        }
        q('UPDATE futter_konto_links SET used_at = ? WHERE id = ?', [jetzt_iso(), $r['id']]);
        $tok = konto_anmelden($email, 'link');
    } else {
        $e = feld($body, 'email');
        $email = email_norm(wahr($e) ? py_str($e) : '');
        if (!email_ok($email) || !code_pruefen('konto', $email, feld($body, 'code'))) {
            fehler('CODE_INVALID', 400);
        }
        $tok = konto_anmelden($email, 'code');
    }
    json_ende(['session' => $tok, 'email' => $email]);
}

function r_konto_info(): void
{
    $k = konto_oder_404();
    $jetzt = microtime(true);
    $links = q('SELECT id, created_at, expires_at, used_at FROM futter_konto_links WHERE email_hmac = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC', [$k['email_hmac'], $jetzt])->fetchAll();
    $sess = q('SELECT id, via, geraet, created_at, last_used FROM futter_konto_sessions WHERE konto_id = ? AND expires_at > ? ORDER BY last_used DESC', [$k['id'], $jetzt])->fetchAll();
    $n = [];
    foreach (APPS as $a) {
        $n[$a] = (int) wert('SELECT COUNT(*) FROM futter_konto_daten WHERE konto_id = ? AND app = ? AND data IS NOT NULL', [$k['id'], $a]);
    }
    $fb = (int) wert('SELECT COALESCE(SUM(bytes), 0) FROM futter_konto_fotos WHERE konto_id = ?', [$k['id']]);
    $antrag = zeile("SELECT wunsch_mb, created_at FROM futter_quota_antraege WHERE email_hmac = ? AND status = 'offen' ORDER BY created_at DESC LIMIT 1", [$k['email_hmac']]);
    json_ende([
        'email' => email_dec($k['email_enc']), 'createdAt' => $k['created_at'],
        'cloud' => ['futter' => (bool) $k['cloud_futter'], 'wiese' => (bool) $k['cloud_wiese']], 'anzahl' => $n,
        'fotos' => ['bytes' => $fb, 'limit' => foto_limit($k['email_hmac'], konto_foto_standard()), 'antrag' => $antrag ? ['wunsch_mb' => (int) $antrag['wunsch_mb'], 'created_at' => $antrag['created_at']] : null],
        'links' => array_map(fn ($r) => ['id' => $r['id'], 'createdAt' => $r['created_at'], 'expiresAt' => (float) $r['expires_at'], 'usedAt' => $r['used_at']], $links),
        'geraete' => array_map(fn ($r) => ['id' => $r['id'], 'via' => $r['via'], 'geraet' => $r['geraet'], 'createdAt' => $r['created_at'], 'lastUsed' => $r['last_used'], 'ich' => $r['id'] === $k['sid']], $sess),
        'retentionDays' => retention_days(), 'consentVersion' => CONSENT_VERSION_KONTO,
    ]);
}

function r_konto_link_weg(string $lid): void
{
    $k = konto_oder_404();
    q('UPDATE futter_konto_links SET revoked = 1 WHERE id = ? AND email_hmac = ?', [$lid, $k['email_hmac']]);
    json_ende(['status' => 'ok']);
}

function r_konto_links_alle_weg(): void
{
    $k = konto_oder_404();
    q('UPDATE futter_konto_links SET revoked = 1 WHERE email_hmac = ?', [$k['email_hmac']]);
    json_ende(['status' => 'ok']);
}

function r_konto_geraet_weg(string $sid): void
{
    $k = konto_oder_404();
    q('DELETE FROM futter_konto_sessions WHERE id = ? AND konto_id = ?', [$sid, $k['id']]);
    json_ende(['status' => 'ok']);
}

function r_konto_logout(): void
{
    $k = konto_sitzung();
    if ($k) {
        q('DELETE FROM futter_konto_sessions WHERE id = ?', [$k['sid']]);
    }
    json_ende(['status' => 'ok']);
}

/** Cloud-Speicherung je App ein/aus. Aus + «loeschen» entfernt die Daten (und Fotos) dieser App vom Server. */
function r_konto_cloud(): void
{
    $body = json_body();
    $body = wahr($body) ? $body : new stdClass();
    $app = feld($body, 'app');
    $an = feld($body, 'an');
    if (!in_array($app, APPS, true) || !is_bool($an)) {
        fehler('BAD_REQUEST', 400);
    }
    $k = konto_oder_404();
    if ($an && $app === 'wiese') {
        // «Wiese in der Cloud» ist abgeschaltet (24.11.2026): Pratum gleicht diese Daten mit eigener Cloud ab. Ausschalten und Löschen gehen weiter.
        fehler('UMGEZOGEN', 409, ['ziel' => '/pratum/']);
    }
    if ($an) {
        $c = feld($body, 'consent');
        $c = wahr($c) ? $c : new stdClass();
        if (feld($c, 'accepted') !== true || feld($c, 'version') !== CONSENT_VERSION_KONTO) {
            fehler('CONSENT_REQUIRED', 400, ['consentVersion' => CONSENT_VERSION_KONTO]);
        }
        q("UPDATE futter_konten SET cloud_$app = 1, consent_version = ?, consent_at = ? WHERE id = ?", [CONSENT_VERSION_KONTO, jetzt_iso(), $k['id']]);
    } else {
        q("UPDATE futter_konten SET cloud_$app = 0 WHERE id = ?", [$k['id']]);
        if (wahr(feld($body, 'loeschen'))) {
            konto_app_loeschen($k['id'], $app);
        }
    }
    json_ende(['status' => 'ok']);
}

function konto_app_loeschen(string $konto_id, string $app): void
{
    q('DELETE FROM futter_konto_daten WHERE konto_id = ? AND app = ?', [$konto_id, $app]);
    foreach (q('SELECT id FROM futter_konto_fotos WHERE konto_id = ? AND app = ?', [$konto_id, $app])->fetchAll(PDO::FETCH_COLUMN) as $fid) {
        @unlink(konto_foto_pfad($konto_id, $fid));
    }
    q('DELETE FROM futter_konto_fotos WHERE konto_id = ? AND app = ?', [$konto_id, $app]);
}

function r_konto_loeschen(): void
{
    $k = konto_oder_404();
    q('DELETE FROM futter_konten WHERE id = ?', [$k['id']]);
    q('UPDATE futter_konto_links SET revoked = 1 WHERE email_hmac = ?', [$k['email_hmac']]);
    konto_fotos_weg($k['id']);
    json_ende(['status' => 'deleted']);
}

// --- Daten -----------------------------------------------------------------------------------------
function app_ok(string $app, array $k): bool
{
    return in_array($app, APPS, true) && (bool) $k['cloud_' . $app];
}

function r_konto_daten_lesen(string $app): void
{
    $seit = py_kurz(arg('seit'), 40);
    $k = konto_oder_404();
    if (!app_ok($app, $k)) {
        fehler('CLOUD_AUS', 409);
    }
    $rows = q('SELECT id, data, client_updated_at, updated_at FROM futter_konto_daten WHERE konto_id = ? AND app = ? AND updated_at > ? ORDER BY updated_at', [$k['id'], $app, $seit])->fetchAll();
    $stand = $seit;
    foreach ($rows as $r) {
        if (strcmp($r['updated_at'], $stand) > 0) {
            $stand = $r['updated_at'];
        }
    }
    json_ende(['records' => array_map(fn ($r) => ['id' => $r['id'], 'data' => $r['data'] ? json_decode($r['data'], false) : null,
        'clientUpdatedAt' => $r['client_updated_at'], 'updatedAt' => $r['updated_at']], $rows), 'stand' => $rows ? $stand : $seit]);
}

function tiefe_ok($v, int $t = 0): bool
{
    if ($t > 10) {
        return false;
    }
    if ($v instanceof stdClass) {
        $f = get_object_vars($v);
        if (count($f) > 400) {
            return false;
        }
        foreach ($f as $x => $y) {
            if (mb_strlen((string) $x) > 100 || !tiefe_ok($y, $t + 1)) {
                return false;
            }
        }
        return true;
    }
    if (is_array($v)) {
        if (count($v) > 2000) {
            return false;
        }
        foreach ($v as $x) {
            if (!tiefe_ok($x, $t + 1)) {
                return false;
            }
        }
        return true;
    }
    return $v === null || is_bool($v) || is_int($v) || is_float($v) || (is_string($v) && mb_strlen($v) <= 20000);
}

/** Stapel: {records: [{id, data|null, updatedAt}]}. Ältere Fassungen als die gespeicherte werden übergangen. */
function r_konto_daten_schreiben(string $app): void
{
    $roh = (string) file_get_contents('php://input', false, null, 0, 8 * 1024 * 1024 + 1);
    if (strlen($roh) > 8 * 1024 * 1024) {
        fehler('TOO_LARGE', 413);
    }
    try {
        $body = json_decode($roh, false, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
    } catch (JsonException $e) {
        fehler('BAD_JSON', 400);
    }
    if (!ist_objekt($body)) {
        fehler('BAD_JSON', 400); // Python: AttributeError bei .get → BAD_JSON
    }
    $recs = feld($body, 'records');
    if (!ist_liste($recs) || count($recs) > 300) {
        fehler('BAD_REQUEST', 400);
    }
    $k = konto_oder_404();
    if (!app_ok($app, $k)) {
        fehler('CLOUD_AUS', 409);
    }
    $n = (int) wert('SELECT COUNT(*) FROM futter_konto_daten WHERE konto_id = ? AND app = ?', [$k['id'], $app]);
    $total = (int) wert('SELECT COALESCE(SUM(bytes), 0) FROM futter_konto_daten WHERE konto_id = ?', [$k['id']]);
    $ok = [];
    $alt = [];
    $jetzt = jetzt_fein();
    foreach ($recs as $r) { // wie Flask ohne Transaktion: bereits geschriebene Datensätze bleiben bei einem späteren Fehler gespeichert
        if (!ist_objekt($r) || !preg_match(REC_ID_RE, py_str(feld($r, 'id', '')))) {
            fehler('BAD_ID', 400);
        }
        $id = py_str($r->id);
        $d = feld($r, 'data');
        if ($d !== null && (!(ist_objekt($d) || is_array($d)) || !tiefe_ok($d))) {
            fehler('REJECTED_CONTENT', 422);
        }
        $txt = $d !== null ? py_json_kompakt($d) : null;
        $b = $txt !== null ? strlen($txt) : 0;
        if ($b > MAX_REC_BYTES) {
            fehler('TOO_LARGE', 413);
        }
        $cu = client_zeit(feld($r, 'updatedAt'));
        $ex = zeile('SELECT client_updated_at, bytes FROM futter_konto_daten WHERE konto_id = ? AND app = ? AND id = ?', [$k['id'], $app, $id]);
        if ($ex && $ex['client_updated_at'] && $cu !== '' && strcmp($ex['client_updated_at'], $cu) > 0) {
            $alt[] = $r->id;
            continue;
        }
        if (!$ex) {
            $n++;
            if ($n > MAX_RECS) {
                fehler('ZU_VIELE', 409);
            }
        }
        $total += $b - ($ex ? (int) $ex['bytes'] : 0);
        if ($total > MAX_DATEN_BYTES) {
            fehler('SPEICHER_VOLL', 409);
        }
        q('INSERT INTO futter_konto_daten (konto_id, app, id, data, bytes, client_updated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) '
            . 'ON DUPLICATE KEY UPDATE data = VALUES(data), bytes = VALUES(bytes), client_updated_at = VALUES(client_updated_at), updated_at = VALUES(updated_at)',
            [$k['id'], $app, $id, $txt, $b, $cu, $jetzt]);
        $ok[] = $r->id;
    }
    json_ende(['ok' => $ok, 'stale' => $alt, 'stand' => $jetzt]);
}

// --- Fotos -----------------------------------------------------------------------------------------
function r_konto_foto_hochladen(string $foto_id): void
{
    $app = arg('app');
    if (!preg_match(FOTO_ID_RE, $foto_id) || !in_array($app, APPS, true)) {
        fehler('BAD_REQUEST', 400);
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_FOTO_BYTES) {
        fehler('TOO_LARGE', 413);
    }
    $daten = bild_body();
    if (strlen($daten) > MAX_FOTO_BYTES || strlen($daten) < 100 || !bild_typ(substr($daten, 0, 12))) {
        fehler('REJECTED_CONTENT', 422);
    }
    $k = konto_oder_404();
    if (!app_ok($app, $k)) {
        fehler('CLOUD_AUS', 409);
    }
    $belegt = (int) wert('SELECT COALESCE(SUM(bytes), 0) FROM futter_konto_fotos WHERE konto_id = ? AND id != ?', [$k['id'], $foto_id]);
    $limit = foto_limit($k['email_hmac'], konto_foto_standard());
    if ($belegt + strlen($daten) > $limit) {
        fehler('QUOTA', 409, ['bytes' => $belegt, 'limit' => $limit]);
    }
    if (!foto_platz_frei(strlen($daten))) {
        fehler('SERVER_VOLL', 507);
    }
    datei_ablegen(konto_foto_pfad($k['id'], $foto_id), $daten);
    q('INSERT INTO futter_konto_fotos (konto_id, id, app, bytes, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE bytes = VALUES(bytes)',
        [$k['id'], $foto_id, $app, strlen($daten), jetzt_iso()]);
    json_ende(['status' => 'ok']);
}

function r_konto_foto_lesen(string $foto_id): void
{
    if (!preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('BAD_REQUEST', 400);
    }
    $k = konto_sitzung();
    if (!$k || !wert('SELECT 1 FROM futter_konto_fotos WHERE konto_id = ? AND id = ?', [$k['id'], $foto_id])) {
        fehler('NOT_FOUND', 404);
    }
    bild_senden(konto_foto_pfad($k['id'], $foto_id));
}

function r_konto_foto_liste(): void
{
    $k = konto_oder_404();
    json_ende(['fotos' => array_map(fn ($r) => ['id' => $r['id'], 'app' => $r['app']],
        q('SELECT id, app FROM futter_konto_fotos WHERE konto_id = ?', [$k['id']])->fetchAll())]);
}

function r_konto_foto_loeschen(string $foto_id): void
{
    if (!preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('BAD_REQUEST', 400);
    }
    $k = konto_oder_404();
    q('DELETE FROM futter_konto_fotos WHERE konto_id = ? AND id = ?', [$k['id'], $foto_id]);
    @unlink(konto_foto_pfad($k['id'], $foto_id));
    json_ende(['status' => 'deleted']);
}

// --- Antrag auf mehr Foto-Speicher -----------------------------------------------------------------
function r_quota_antrag(): void
{
    rate_hit('quota_antrag', 5, 3600);
    $body = json_body();
    $body = wahr($body) ? $body : new stdClass();
    $bereich = in_array(feld($body, 'bereich'), ['konto', 'gruppe', 'kurs'], true) ? $body->bereich : 'konto';
    $w = feld($body, 'wunschMb');
    $wunsch = py_int(wahr($w) ? $w : 0);
    if ($wunsch === null) {
        fehler('BAD_REQUEST', 400);
    }
    $wunsch = max(10, min(5000, $wunsch));
    $tb = feld($body, 'begruendung');
    $text = py_kurz(trim(wahr($tb) ? py_str($tb) : ''), 1000);
    $email = konto_email();
    if (!$email) {
        $e = feld($body, 'email');
        $email = email_norm(wahr($e) ? py_str($e) : '');
        if (!email_ok($email) || !code_pruefen('quota', $email, feld($body, 'code'))) {
            fehler('CODE_INVALID', 400);
        }
    }
    q("INSERT INTO futter_quota_antraege (id, email_hmac, email_enc, bereich, wunsch_mb, text_enc, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'offen', ?)",
        [zufall_id(9), email_hmac($email), email_enc($email), $bereich, $wunsch, $text !== '' ? text_enc($text, 'quota') : null, jetzt_iso()]);
    $adm = admin_adresse();
    if ($adm) {
        mail_senden($adm, 'Antrag: mehr Foto-Speicher', "Neuer Antrag auf $wunsch MB zusätzlichen Foto-Speicher ($bereich). Bitte auf der Admin-Seite entscheiden.\n");
    }
    json_ende(['status' => 'ok']);
}

function r_quota_antrag_code(): void
{
    rate_hit('quota_code', 10, 3600);
    $b = json_body();
    $e = feld(wahr($b) ? $b : new stdClass(), 'email');
    $email = email_norm(wahr($e) ? py_str($e) : '');
    if (!email_ok($email)) {
        fehler('BAD_REQUEST', 400);
    }
    code_senden('quota', $email, 'Antrag Foto-Speicher');
    json_ende(['status' => 'sent']);
}

function r_admin_quota_liste(): void
{
    if (!admin_ok()) {
        fehler('NOT_FOUND', 404);
    }
    $rows = q("SELECT * FROM futter_quota_antraege ORDER BY status = 'offen' DESC, created_at DESC LIMIT 200")->fetchAll();
    $qu = [];
    foreach (q('SELECT * FROM futter_foto_quota')->fetchAll() as $r) {
        $qu[$r['email_hmac']] = (int) $r['mb'];
    }
    json_ende(['konten' => (int) wert('SELECT COUNT(*) FROM futter_konten'), 'antraege' => array_map(fn ($r) => [
        'id' => $r['id'], 'email' => email_dec($r['email_enc']), 'bereich' => $r['bereich'], 'wunschMb' => (int) $r['wunsch_mb'],
        'text' => $r['text_enc'] ? text_dec($r['text_enc'], 'quota') : null, 'status' => $r['status'], 'createdAt' => $r['created_at'],
        'zusatzMb' => $qu[$r['email_hmac']] ?? 0], $rows)]);
}

function r_admin_quota_entscheid(string $aid): void
{
    if (!admin_ok()) {
        fehler('NOT_FOUND', 404);
    }
    $b = json_body();
    $b = wahr($b) ? $b : new stdClass();
    $status = feld($b, 'status');
    if (!in_array($status, ['ok', 'abgelehnt'], true)) {
        fehler('BAD_REQUEST', 400);
    }
    $r = zeile('SELECT * FROM futter_quota_antraege WHERE id = ?', [$aid]);
    if (!$r) {
        fehler('NOT_FOUND', 404);
    }
    $mb = (int) $r['wunsch_mb'];
    if ($status === 'ok') {
        $m = feld($b, 'mb');
        $mb = py_int(wahr($m) ? $m : (int) $r['wunsch_mb']);
        if ($mb === null) {
            fehler('BAD_REQUEST', 400);
        }
        $mb = max(1, min(20000, $mb));
        q('INSERT INTO futter_foto_quota (email_hmac, mb, decided_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE mb = VALUES(mb), decided_at = VALUES(decided_at)',
            [$r['email_hmac'], $mb, jetzt_iso()]);
    }
    q('UPDATE futter_quota_antraege SET status = ?, decided_at = ? WHERE id = ?', [$status, jetzt_iso(), $aid]);
    $email = email_dec($r['email_enc']);
    if ($email) {
        mail_senden($email, 'Ihr Antrag Foto-Speicher', $status === 'ok' ? "Ihr Antrag wurde angenommen: zusätzlich $mb MB Foto-Speicher.\n"
            : "Ihr Antrag auf mehr Foto-Speicher wurde leider nicht angenommen.\n");
    }
    json_ende(['status' => 'ok']);
}
