<?php
/**
 * Kursmodus (Schulklassen, Gruppen, Kurse) – portiert aus v2_kurs.py.
 *
 * Kursleitung (freigeschaltet, E-Mail bestätigt) legt den Kurs an und reserviert Etiketten (leere Proben). Teilnehmende
 * treten mit dem Beitritts-Token aus dem Kurs-Link bei (Server: nur Hash), Sitzung über Kopfzeile «X-Kurs-Session».
 * Vergleich der Beurteilungen erst nach eigener Abgabe. Adressen nur verschlüsselt, Suche per HMAC; das Link-Geheimnis
 * liegt mit dem Serverschlüssel verschlüsselt auf dem Server («Meine Kurse»).
 */
declare(strict_types=1);

const KURS_CONSENT_VERSION = '2026-10-k5';
const KURS_SESSION_TTL = 120 * 24 * 3600;
const MAX_PROBEN = 400;
const MAX_TEILNEHMENDE = 300;
const HINWEIS_KEYS = ['foto', 'standort', 'alter', 'labor', 'notiz', 'bezeichnung'];
const HINWEIS_DEFAULT = ['foto' => true, 'standort' => true, 'alter' => true, 'labor' => false, 'notiz' => false, 'bezeichnung' => true];

// --- Hilfen ----------------------------------------------------------------------------------
/** JSON-Body als Objekt (wie «_json_body() or {}»; Nicht-Objekte gelten als leer). */
function body_obj(): stdClass
{
    $b = json_body();
    return $b instanceof stdClass ? $b : new stdClass();
}

/** Feld als Objekt wie «body.get(k) or {}». */
function feld_obj($obj, string $k)
{
    $v = feld($obj, $k);
    return wahr($v) ? $v : new stdClass();
}

/** str.strip() wie Python (Unicode-Leerraum). */
function py_strip(string $s): string
{
    $ws = '[\s\x{1c}-\x{1f}\x{85}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}]';
    return (string) preg_replace('/^' . $ws . '+|' . $ws . '+$/uD', '', $s);
}

/** json.loads(v) if v else None – Objekte als stdClass. */
function box(?string $v)
{
    if ($v === null || $v === '') {
        return null;
    }
    return json_decode($v, false, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
}

/** E-Mail aus dem Body wie M.email_norm(body.get('email')). */
function body_email(stdClass $b): string
{
    $e = feld($b, 'email');
    return email_norm(is_string($e) ? $e : '');
}

function kurs_foto_dir(string $kurs_id): string
{
    return foto_dir() . '/k_' . $kurs_id;
}

function kurs_foto_pfad(string $kurs_id, string $foto_id): string
{
    return kurs_foto_dir($kurs_id) . '/' . $foto_id . '.bin';
}

function kurs_entfernen(string $kurs_id): void
{
    q('DELETE FROM kurs_sessions WHERE kurs_id = ?', [$kurs_id]);
    q('DELETE FROM kurse WHERE id = ?', [$kurs_id]);
    if (preg_match('/^[A-Za-z0-9_-]+$/D', $kurs_id)) {
        ordner_loeschen(kurs_foto_dir($kurs_id));
    }
}

function kurs_purge(): void
{
    $grenze = gmdate('Y-m-d\TH:i:s', time() - retention_days() * 86400);
    foreach (q('SELECT id FROM kurse WHERE updated_at < ?', [$grenze])->fetchAll(PDO::FETCH_COLUMN) as $id) {
        kurs_entfernen($id);
    }
    q('DELETE FROM kurs_sessions WHERE expires_at < ?', [microtime(true)]);
    // In Flask beim Start (init_kurs_db): nicht aktivierte Kurse nach einem Tag entfernen
    q("DELETE FROM kurse WHERE status = 'pending' AND created_at < ?", [gmdate('Y-m-d\TH:i:s', time() - 86400)]);
}

function kurs_touch(string $kurs_id): void
{
    q('UPDATE kurse SET updated_at = ? WHERE id = ?', [jetzt_iso(), $kurs_id]);
}

/** Teilnehmer-Zeile der Sitzung (Kopfzeile X-Kurs-Session) oder null. */
function kurs_session(string $kurs_id): ?array
{
    $tok = kopfzeile('X-Kurs-Session');
    if (!preg_match(TOKEN_RE, $tok) || !preg_match(ID_RE, $kurs_id)) {
        return null;
    }
    $row = zeile('SELECT t.* FROM kurs_sessions s JOIN kurs_teilnehmende t ON t.id = s.teilnehmer_id '
        . 'WHERE s.token_hash = ? AND s.kurs_id = ? AND s.expires_at > ?', [sha($tok), $kurs_id, microtime(true)]);
    if (!$row) {
        rate_hit('auth_fail', 60, 600);
        return null;
    }
    q('UPDATE kurs_sessions SET expires_at = ? WHERE token_hash = ?', [microtime(true) + KURS_SESSION_TTL, sha($tok)]);
    return $row;
}

function kurs_session_oder_404(string $kurs_id): array
{
    $ich = kurs_session($kurs_id);
    if (!$ich) {
        fehler('NOT_FOUND', 404);
    }
    return $ich;
}

function kurs_leitung(string $kurs_id): ?array
{
    $ich = kurs_session($kurs_id);
    return $ich && $ich['rolle'] === 'leitung' ? $ich : null;
}

function kurs_neue_session(string $person_id, string $kurs_id): string
{
    $token = zufall_id(32);
    q('INSERT INTO kurs_sessions (token_hash, teilnehmer_id, kurs_id, expires_at) VALUES (?, ?, ?, ?)',
        [sha($token), $person_id, $kurs_id, microtime(true) + KURS_SESSION_TTL]);
    return $token;
}

function kurs_consent_ok(stdClass $body): bool
{
    $c = feld_obj($body, 'consent');
    return feld($c, 'accepted') === true && feld($c, 'version') === KURS_CONSENT_VERSION;
}

function kurs_join_ok(string $kurs_id, $join_token): bool
{
    $k = zeile('SELECT join_hash, status FROM kurse WHERE id = ?', [$kurs_id]);
    $ok = $k && $k['status'] === 'aktiv' && is_string($join_token) && preg_match(TOKEN_RE, $join_token) && hash_equals($k['join_hash'], sha($join_token));
    if (!$ok) {
        rate_hit('auth_fail', 60, 600);
    }
    return (bool) $ok;
}

/** Wie im Browser (crypto.js kursKeys): HKDF-SHA256(secret, salt «agff-futter-v2», info «kurs-join») → base64url. */
function kurs_join_token_aus(string $secret): string
{
    return b64url(hash_hkdf('sha256', (string) b64url_dec($secret), 32, 'kurs-join', 'agff-futter-v2'), false);
}

/** Link-Geheimnis übernehmen, wenn es zum Kurs passt (Beitritts-Hash). */
function kurs_link_speichern(string $kurs_id, $secret): bool
{
    if (!is_string($secret) || !preg_match(TOKEN_RE, $secret)) {
        return false;
    }
    $jh = wert('SELECT join_hash FROM kurse WHERE id = ?', [$kurs_id]);
    if ($jh === null || !hash_equals((string) $jh, sha(kurs_join_token_aus($secret)))) {
        return false;
    }
    q('UPDATE kurse SET link_enc = ? WHERE id = ?', [text_enc($secret, 'kurs-link'), $kurs_id]);
    return true;
}

function hinweise_aus(?string $meta_analyse): array
{
    $h = HINWEIS_DEFAULT;
    $m = $meta_analyse ? json_decode($meta_analyse, false) : null;
    $x = $m instanceof stdClass ? feld($m, 'hinweise') : null;
    if ($x instanceof stdClass) {
        foreach (get_object_vars($x) as $k => $v) {
            $h[(string) $k] = $v;
        }
    }
    return $h;
}

function kurs_hinweise(string $kurs_id): array
{
    return hinweise_aus(wert('SELECT meta_analyse FROM kurse WHERE id = ?', [$kurs_id]));
}

function kurs_foto_loeschen(string $kurs_id, string $foto_id): void
{
    q('DELETE FROM kurs_fotos WHERE kurs_id = ? AND id = ?', [$kurs_id, $foto_id]);
    if (preg_match('/^[A-Za-z0-9_-]+$/D', $kurs_id) && preg_match('/^[A-Za-z0-9_-]+$/D', $foto_id)) {
        @unlink(kurs_foto_pfad($kurs_id, $foto_id));
    }
}

/** Typ der erfassten Probe: json.loads(analyse or '{}').get('typ') */
function analyse_typ(?string $analyse)
{
    $a = json_decode($analyse ?: '{}', false);
    return $a instanceof stdClass ? feld($a, 'typ') : null;
}

// --- Kurs anlegen (nur freigeschaltete Kursleitung, E-Mail bestätigt) ----------------------------
function r_kurs_anlegen(): void
{
    rate_hit('kurs_create', 10, 3600);
    $body = body_obj();
    $consent = feld_obj($body, 'consent');
    if (feld($consent, 'accepted') !== true) {
        fehler('CONSENT_REQUIRED', 400);
    }
    if (feld($consent, 'version') !== KURS_CONSENT_VERSION) {
        fehler('CONSENT_OUTDATED', 409, ['consentVersion' => KURS_CONSENT_VERSION]);
    }
    $email = body_email($body);
    $join_hash = feld($body, 'joinHash', '');
    $einladung = feld($body, 'einladung');
    if (!email_ok($email) || !is_string($join_hash) || !preg_match(HASH_RE, $join_hash)) {
        fehler('BAD_REQUEST', 400);
    }
    if (!darf_kurs_anlegen($email) && !(wahr($einladung) && einladung_gueltig($einladung))) {
        fehler('NICHT_FREIGESCHALTET', 403);
    }
    $kurs_id = zufall_id(9);
    $jetzt = jetzt_iso();
    kurs_purge();
    $einl = wahr($einladung) ? py_kurz(py_str($einladung), 40) : '';
    q("INSERT INTO kurse (id, join_hash, status, pending_email_hmac, pending_einladung, consent_version, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)",
        [$kurs_id, $join_hash, email_hmac($email), $einl !== '' ? $einl : null, KURS_CONSENT_VERSION, $jetzt, $jetzt]);
    if (wahr(feld($body, 'secret'))) {
        kurs_link_speichern($kurs_id, feld($body, 'secret'));
    }
    code_senden('kurs:' . $kurs_id, $email, 'Kurs anlegen');
    json_ende(['id' => $kurs_id, 'consentVersion' => KURS_CONSENT_VERSION], 201);
}

function r_kurs_aktivieren(string $kurs_id): void
{
    $body = body_obj();
    $email = body_email($body);
    if (!email_ok($email) || !preg_match(ID_RE, $kurs_id)) {
        fehler('BAD_REQUEST', 400);
    }
    $k = zeile('SELECT * FROM kurse WHERE id = ?', [$kurs_id]);
    if (!$k || $k['status'] !== 'pending' || $k['pending_email_hmac'] !== email_hmac($email)) {
        fehler('NOT_FOUND', 404);
    }
    if (!code_pruefen('kurs:' . $kurs_id, $email, feld($body, 'code'))) {
        fehler('CODE_INVALID', 400);
    }
    if (!darf_kurs_anlegen($email) && !($k['pending_einladung'] && einladung_einloesen($k['pending_einladung'], $email))) {
        fehler('NICHT_FREIGESCHALTET', 403);
    }
    $pid = zufall_id(9);
    q("UPDATE kurse SET status = 'aktiv', pending_email_hmac = NULL, pending_einladung = NULL WHERE id = ?", [$kurs_id]);
    q("INSERT INTO kurs_teilnehmende (id, kurs_id, email_hmac, email_enc, rolle, consent_version, consent_at, created_at) VALUES (?, ?, ?, ?, 'leitung', ?, ?, ?)",
        [$pid, $kurs_id, email_hmac($email), email_enc($email), KURS_CONSENT_VERSION, jetzt_iso(), jetzt_iso()]);
    $token = kurs_neue_session($pid, $kurs_id);
    json_ende(['session' => $token, 'ich' => ['id' => $pid, 'rolle' => 'leitung']]);
}

// --- Beitreten (ohne E-Mail) / E-Mail verknüpfen / Anmelden -------------------------------------
function r_kurs_beitreten(string $kurs_id): void
{
    rate_hit('kurs_join', 40, 3600);
    $body = body_obj();
    if (!kurs_consent_ok($body)) {
        fehler('CONSENT_REQUIRED', 400);
    }
    if (!kurs_join_ok($kurs_id, feld($body, 'joinToken'))) {
        fehler('NOT_FOUND', 404);
    }
    if ((int) wert('SELECT COUNT(*) FROM kurs_teilnehmende WHERE kurs_id = ?', [$kurs_id]) >= MAX_TEILNEHMENDE) {
        fehler('KURS_VOLL', 409);
    }
    $pid = zufall_id(9);
    q("INSERT INTO kurs_teilnehmende (id, kurs_id, rolle, consent_version, consent_at, created_at) VALUES (?, ?, 'teilnahme', ?, ?, ?)",
        [$pid, $kurs_id, KURS_CONSENT_VERSION, jetzt_iso(), jetzt_iso()]);
    $token = kurs_neue_session($pid, $kurs_id);
    kurs_touch($kurs_id);
    json_ende(['session' => $token, 'ich' => ['id' => $pid, 'rolle' => 'teilnahme']]);
}

/** Code zum Verknüpfen (mit Sitzung) oder zum Anmelden auf neuem Gerät (mit Beitritts-Token). */
function r_kurs_email_code(string $kurs_id): void
{
    $body = body_obj();
    $email = body_email($body);
    if (!email_ok($email)) {
        fehler('BAD_REQUEST', 400);
    }
    $ich = kurs_session($kurs_id);
    if (!($ich || kurs_join_ok($kurs_id, feld($body, 'joinToken')))) {
        fehler('NOT_FOUND', 404);
    }
    // Mit Sitzung (Adresse verknüpfen): Bestätigungslink; ohne (Anmeldung neues Gerät): nur Code
    code_senden('kurs:' . $kurs_id, $email, 'Kurs', $ich ? app_url() . '#km=' . $kurs_id . '.' : null);
    json_ende(['status' => 'sent']);
}

/** Mit Sitzung: E-Mail mit der eigenen Teilnahme verknüpfen. Ohne: mit bekannter Adresse anmelden. */
function r_kurs_email_verify(string $kurs_id): void
{
    $body = body_obj();
    $email = body_email($body);
    if (!email_ok($email)) {
        fehler('BAD_REQUEST', 400);
    }
    $ich = kurs_session($kurs_id);
    if (!$ich && !kurs_join_ok($kurs_id, feld($body, 'joinToken'))) {
        fehler('NOT_FOUND', 404);
    }
    if (!code_pruefen('kurs:' . $kurs_id, $email, feld($body, 'code'))) {
        fehler('CODE_INVALID', 400);
    }
    $eh = email_hmac($email);
    $andere = zeile('SELECT * FROM kurs_teilnehmende WHERE kurs_id = ? AND email_hmac = ?', [$kurs_id, $eh]);
    if ($ich) {
        if ($andere && $andere['id'] !== $ich['id']) {
            fehler('EMAIL_VERGEBEN', 409);
        }
        q('UPDATE kurs_teilnehmende SET email_hmac = ?, email_enc = ? WHERE id = ?', [$eh, email_enc($email), $ich['id']]);
        json_ende(['status' => 'verknuepft', 'ich' => ['id' => $ich['id'], 'rolle' => $ich['rolle']]]);
    }
    if (!$andere) {
        fehler('UNBEKANNT', 404);
    }
    $token = kurs_neue_session($andere['id'], $kurs_id);
    json_ende(['session' => $token, 'ich' => ['id' => $andere['id'], 'rolle' => $andere['rolle']]]);
}

function r_kurs_logout(string $kurs_id): void
{
    q('DELETE FROM kurs_sessions WHERE token_hash = ? AND kurs_id = ?', [sha(kopfzeile('X-Kurs-Session')), $kurs_id]);
    json_ende(['status' => 'ok']);
}

// --- Lesen -------------------------------------------------------------------------------------
function r_kurs_lesen(string $kurs_id): void
{
    $ich = kurs_session_oder_404($kurs_id);
    $k = zeile('SELECT * FROM kurse WHERE id = ?', [$kurs_id]);
    $leitung = $ich['rolle'] === 'leitung';
    $personen = q("SELECT id, rolle, name_privat, email_enc FROM kurs_teilnehmende WHERE kurs_id = ? ORDER BY rolle = 'leitung' DESC, created_at", [$kurs_id])->fetchAll();
    $proben = q('SELECT * FROM kurs_proben WHERE kurs_id = ? ORDER BY nr', [$kurs_id])->fetchAll();
    $abgaben = [];
    foreach (q('SELECT probe_id, COUNT(*) AS n FROM kurs_beurteilungen WHERE kurs_id = ? GROUP BY probe_id', [$kurs_id]) as $r) {
        $abgaben[$r['probe_id']] = (int) $r['n'];
    }
    $meine = [];
    foreach (q('SELECT probe_id, abgegeben_at FROM kurs_beurteilungen WHERE kurs_id = ? AND teilnehmer_id = ?', [$kurs_id, $ich['id']]) as $r) {
        $meine[$r['probe_id']] = $r['abgegeben_at'];
    }
    $foto_bytes = (int) wert('SELECT COALESCE(SUM(bytes), 0) FROM kurs_fotos WHERE kurs_id = ? AND teilnehmer_id = ?', [$kurs_id, $ich['id']]);
    // Musterproben: aus dem Pool übernommen (pool_id) oder selbst Quelle eines Pool-Eintrags
    $pool_info = [];
    foreach (q('SELECT id, sammlung, oeffentlich, quelle_kurs, quelle_probe FROM pool_proben') as $r) {
        $pool_info[$r['id']] = $r;
    }
    $quelle = [];
    foreach ($pool_info as $r) {
        if ($r['quelle_kurs'] === $kurs_id) {
            $quelle[(string) $r['quelle_probe']] = $r;
        }
    }
    $hinweise = hinweise_aus($k['meta_analyse']);
    $teilnehmende = [];
    foreach ($personen as $p) {
        $email = $p['email_enc'] ? email_dec($p['email_enc']) : null;
        $teilnehmende[] = ['id' => $p['id'], 'rolle' => $p['rolle'], 'name' => box($p['name_privat']), 'mitEmail' => (bool) $email,
            'email' => $email ? (($leitung || $p['id'] === $ich['id']) ? $email : email_mask($email)) : null];
    }
    $liste = [];
    foreach ($proben as $r) {
        if ($r['status'] !== 'erfasst' && !$leitung) {
            continue;
        }
        $an = box($r['analyse']);
        $liste[] = [
            'id' => $r['id'], 'nr' => (int) $r['nr'], 'status' => $r['status'], 'eigene' => $r['owner_id'] === $ich['id'], 'ownerId' => $r['owner_id'],
            'analyse' => wahr($an) ? $an : new stdClass(), 'privat' => box($r['privat']),
            'labor' => ($leitung || $r['owner_id'] === $ich['id'] || wahr($hinweise['labor'] ?? null) || wahr($meine[$r['id']] ?? null)) ? box($r['labor']) : null,
            'hatLabor' => wahr($r['labor']), 'poolId' => $r['pool_id'],
            'muster' => kurs_muster($r, $pool_info, $quelle),
            'abgaben' => $abgaben[$r['id']] ?? 0, 'meineAbgabe' => $meine[$r['id']] ?? null,
        ];
    }
    $ma = box($k['meta_analyse']);
    json_ende([
        'kurs' => ['id' => $k['id'], 'meta' => ['analyse' => wahr($ma) ? $ma : new stdClass(), 'privat' => box($k['meta_privat'])], 'updatedAt' => $k['updated_at'],
            'consentVersion' => $k['consent_version']],
        'hinweise' => (object) $hinweise,
        'ich' => ['id' => $ich['id'], 'rolle' => $ich['rolle'], 'fotoBytes' => $foto_bytes, 'fotoLimit' => foto_limit($ich['email_hmac'], max_foto_total()),
            'consentVersion' => $ich['consent_version'], 'consentAktuell' => KURS_CONSENT_VERSION],
        'linkBekannt' => wahr($k['link_enc']),
        'teilnehmende' => $teilnehmende,
        'proben' => $liste,
        'retentionDays' => retention_days(),
    ]);
}

function kurs_muster(array $r, array $pool_info, array $quelle): ?array
{
    $pid = $r['pool_id'];
    if ($pid && isset($pool_info[$pid])) {
        return ['poolId' => $pid, 'sammlung' => $pool_info[$pid]['sammlung'], 'art' => 'uebernommen'];
    }
    $q = $quelle[$r['id']] ?? null;
    return $q ? ['poolId' => $q['id'], 'sammlung' => $q['sammlung'], 'art' => 'quelle'] : null;
}

/** Für den Scan eines Etiketts: leer (→ erfassen) oder erfasst (→ beurteilen). */
function r_kurs_probe_status(string $kurs_id, string $probe_id): void
{
    $ich = kurs_session_oder_404($kurs_id);
    $r = zeile('SELECT status, owner_id, nr FROM kurs_proben WHERE kurs_id = ? AND id = ?', [$kurs_id, $probe_id]);
    if (!$r) {
        fehler('NOT_FOUND', 404);
    }
    json_ende(['status' => $r['status'], 'eigene' => $r['owner_id'] === $ich['id'], 'nr' => (int) $r['nr']]);
}

// --- Kursleitung: Meta, Hinweise, Etiketten ------------------------------------------------------
function r_kurs_meta(string $kurs_id): void
{
    $body = body_obj();
    $an = feld_obj($body, 'analyse');
    $pv = feld($body, 'privat');
    if (!ist_objekt($an) || array_diff(schluessel($an), ['datum', 'hinweise', 'beitragen']) || !check_privat($pv)) {
        fehler('REJECTED_CONTENT', 422);
    }
    if (property_exists($an, 'beitragen') && !is_bool($an->beitragen)) {
        fehler('REJECTED_CONTENT', 422);
    }
    if (wahr(feld($an, 'datum')) && !preg_match(DATE_RE, py_str($an->datum))) {
        fehler('REJECTED_CONTENT', 422);
    }
    $h = feld($an, 'hinweise');
    if ($h !== null) {
        $ok = ist_objekt($h) && !array_diff(schluessel($h), HINWEIS_KEYS);
        foreach ($ok ? get_object_vars($h) : [] as $v) {
            $ok = $ok && is_bool($v);
        }
        if (!$ok) {
            fehler('REJECTED_CONTENT', 422);
        }
    }
    if (!kurs_leitung($kurs_id)) {
        fehler('NOT_FOUND', 404);
    }
    q('UPDATE kurse SET meta_analyse = ?, meta_privat = ?, updated_at = ? WHERE id = ?',
        [py_json($an), wahr($pv) ? py_json($pv) : null, jetzt_iso(), $kurs_id]);
    json_ende(['status' => 'ok']);
}

/** Bestehendes Mitglied stimmt geänderten Datenschutzhinweisen zu. */
function r_kurs_zustimmung(string $kurs_id): void
{
    if (!kurs_consent_ok(body_obj())) {
        fehler('CONSENT_REQUIRED', 400);
    }
    $ich = kurs_session_oder_404($kurs_id);
    q('UPDATE kurs_teilnehmende SET consent_version = ?, consent_at = ? WHERE id = ?', [KURS_CONSENT_VERSION, jetzt_iso(), $ich['id']]);
    json_ende(['status' => 'ok']);
}

/** Kursmitglied hinterlegt das Link-Geheimnis (für Kurse ohne Hinterlegung beim Anlegen). */
function r_kurs_link(string $kurs_id): void
{
    kurs_session_oder_404($kurs_id);
    if (!kurs_link_speichern($kurs_id, feld(body_obj(), 'secret'))) {
        fehler('REJECTED_CONTENT', 422);
    }
    json_ende(['status' => 'ok']);
}

// --- Meine Kurse: per E-Mail alle eigenen Kurse wiederfinden ---------------------------------------
function r_meine_kurse_code(): void
{
    rate_hit('meine_code', 10, 3600);
    $email = body_email(body_obj());
    if (!email_ok($email)) {
        fehler('BAD_REQUEST', 400);
    }
    if (wert('SELECT 1 FROM kurs_teilnehmende WHERE email_hmac = ? LIMIT 1', [email_hmac($email)])) {
        code_senden('meine', $email, 'Meine Kurse'); // sonst still: keine Auskunft, ob eine Adresse bekannt ist
    }
    json_ende(['status' => 'sent']);
}

function r_meine_kurse(): void
{
    rate_hit('meine_list', 20, 3600);
    $body = body_obj();
    $email = body_email($body);
    if (!email_ok($email) || !code_pruefen('meine', $email, feld($body, 'code'))) {
        fehler('CODE_INVALID', 400);
    }
    $out = [];
    $ohne = 0;
    $rows = q("SELECT t.id AS tid, t.rolle, k.id AS kid, k.link_enc, k.meta_privat, k.meta_analyse FROM kurs_teilnehmende t "
        . "JOIN kurse k ON k.id = t.kurs_id WHERE t.email_hmac = ? AND k.status = 'aktiv'", [email_hmac($email)])->fetchAll();
    foreach ($rows as $r) {
        $secret = $r['link_enc'] ? text_dec($r['link_enc'], 'kurs-link') : null;
        if (!$secret) {
            $ohne++;
            continue;
        }
        $mp = json_decode($r['meta_privat'] ?: '{}', false);
        $titel = $mp instanceof stdClass && is_string(feld($mp, 'titel')) ? $mp->titel : null;
        $out[] = ['kursId' => $r['kid'], 'rolle' => $r['rolle'], 'ichId' => $r['tid'], 'secret' => $secret, 'titel' => $titel,
            'session' => kurs_neue_session($r['tid'], $r['kid'])];
    }
    json_ende(['kurse' => $out, 'ohneLink' => $ohne]);
}

/** Reserviert N leere Proben (fortlaufende Nummern) für den Etikettendruck. */
function r_kurs_etiketten(string $kurs_id): void
{
    $n = feld(body_obj(), 'anzahl');
    if ($n === true) {
        $n = 1; // Python: True ist eine ganze Zahl
    }
    if (!is_int($n) || $n < 1 || $n > 105) {
        fehler('BAD_REQUEST', 400);
    }
    if (!kurs_leitung($kurs_id)) {
        fehler('NOT_FOUND', 404);
    }
    if ((int) wert('SELECT COUNT(*) FROM kurs_proben WHERE kurs_id = ?', [$kurs_id]) + $n > MAX_PROBEN) {
        fehler('ZU_VIELE_PROBEN', 409);
    }
    $start = (int) wert('SELECT naechste_nr FROM kurse WHERE id = ?', [$kurs_id]);
    $out = [];
    for ($i = 0; $i < $n; $i++) {
        $pid = zufall_id(9);
        q("INSERT INTO kurs_proben (kurs_id, id, nr, sort, status, updated_at) VALUES (?, ?, ?, ?, 'leer', ?)", [$kurs_id, $pid, $start + $i, $start + $i, jetzt_iso()]);
        $out[] = ['id' => $pid, 'nr' => $start + $i];
    }
    q('UPDATE kurse SET naechste_nr = ? WHERE id = ?', [$start + $n, $kurs_id]);
    kurs_touch($kurs_id);
    json_ende(['proben' => $out]);
}

function check_erfassung($an, $pv): bool
{
    return ist_objekt($an) && !array_diff(schluessel($an), ['typ']) && in_array(feld($an, 'typ'), FUTTERARTEN, true) && check_privat($pv);
}

/** Ersterfassung einer leeren Probe (erste Person wird Besitzer) bzw. Änderung durch Besitzer/Kursleitung.
 *  Die Kursleitung kann Proben auch ohne Etikett direkt anlegen. */
function r_kurs_probe_erfassen(string $kurs_id, string $probe_id): void
{
    $body = body_obj();
    $an = feld_obj($body, 'analyse');
    $pv = feld($body, 'privat');
    $lab = feld($body, 'labor');
    if (!preg_match(ID_RE, $probe_id) || !check_erfassung($an, $pv) || !check_privat($lab)) {
        fehler('REJECTED_CONTENT', 422);
    }
    $lab_json = wahr($lab) ? py_json($lab) : null;
    $pool_id = feld($body, 'poolId');
    if ($pool_id !== null) {
        if (!preg_match(ID_RE, py_str($pool_id)) || !pool_eintrag(py_str($pool_id))) {
            fehler('POOL_UNBEKANNT', 404);
        }
        $pool_id = py_str($pool_id);
    }
    $ich = kurs_session_oder_404($kurs_id);
    $r = zeile('SELECT * FROM kurs_proben WHERE kurs_id = ? AND id = ?', [$kurs_id, $probe_id]);
    if ($r === null) {
        if ($ich['rolle'] !== 'leitung') {
            fehler('NOT_FOUND', 404);
        }
        if ((int) wert('SELECT COUNT(*) FROM kurs_proben WHERE kurs_id = ?', [$kurs_id]) >= MAX_PROBEN) {
            fehler('ZU_VIELE_PROBEN', 409);
        }
        $nr = (int) wert('SELECT naechste_nr FROM kurse WHERE id = ?', [$kurs_id]);
        q("INSERT INTO kurs_proben (kurs_id, id, nr, sort, status, owner_id, analyse, privat, labor, pool_id, updated_at) VALUES (?, ?, ?, ?, 'erfasst', ?, ?, ?, ?, ?, ?)",
            [$kurs_id, $probe_id, $nr, $nr, $ich['id'], py_json($an), wahr($pv) ? py_json($pv) : null, $lab_json, $pool_id, jetzt_iso()]);
        q('UPDATE kurse SET naechste_nr = ? WHERE id = ?', [$nr + 1, $kurs_id]);
    } else {
        if ($r['status'] === 'erfasst' && $r['owner_id'] !== $ich['id'] && $ich['rolle'] !== 'leitung') {
            fehler('BEREITS_ERFASST', 409);
        }
        if ($r['status'] === 'erfasst' && analyse_typ($r['analyse']) !== $an->typ
            && wert('SELECT 1 FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ?', [$kurs_id, $probe_id])) {
            fehler('TYP_FEST', 409); // Futterart nach ersten Abgaben nicht mehr änderbar
        }
        q("UPDATE kurs_proben SET status = 'erfasst', owner_id = ?, analyse = ?, privat = ?, labor = ?, updated_at = ? WHERE kurs_id = ? AND id = ?",
            [$r['owner_id'] ?: $ich['id'], py_json($an), wahr($pv) ? py_json($pv) : null, $lab_json, jetzt_iso(), $kurs_id, $probe_id]);
    }
    kurs_touch($kurs_id);
    json_ende(['status' => 'ok']);
}

function r_kurs_probe_loeschen(string $kurs_id, string $probe_id): void
{
    if (!kurs_leitung($kurs_id)) {
        fehler('NOT_FOUND', 404);
    }
    q('DELETE FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ?', [$kurs_id, $probe_id]);
    foreach (q('SELECT id FROM kurs_fotos WHERE kurs_id = ? AND probe_id = ?', [$kurs_id, $probe_id])->fetchAll(PDO::FETCH_COLUMN) as $fid) {
        kurs_foto_loeschen($kurs_id, $fid);
    }
    q('DELETE FROM kurs_proben WHERE kurs_id = ? AND id = ?', [$kurs_id, $probe_id]);
    kurs_touch($kurs_id);
    json_ende(['status' => 'deleted']);
}

// --- Beurteilungen -----------------------------------------------------------------------------
function r_kurs_abgeben(string $kurs_id, string $probe_id): void
{
    $roh = (string) file_get_contents('php://input', false, null, 0, MAX_RECORD_BYTES + 1);
    if (strlen($roh) > MAX_RECORD_BYTES) {
        fehler('TOO_LARGE', 413);
    }
    try {
        $body = json_decode($roh, false, 64, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
    } catch (JsonException $e) {
        fehler('BAD_JSON', 400);
    }
    if (!ist_objekt($body)) {
        fehler('BAD_JSON', 400); // Python: AttributeError beim .get → BAD_JSON
    }
    $data = feld($body, 'data');
    if (wahr($data) && !ist_objekt($data)) {
        throw new RuntimeException('data ist kein Objekt'); // Python: AttributeError → 500
    }
    $an = wahr($data) ? feld_obj($data, 'analyse') : new stdClass();
    $id = feld($an, 'id', '');
    if (!ist_objekt($an) || !preg_match(ID_RE, py_str($id)) || !is_string($id) || !check_record($id, $data)) {
        fehler('REJECTED_CONTENT', 422);
    }
    $ich = kurs_session_oder_404($kurs_id);
    $kp = zeile('SELECT analyse, status FROM kurs_proben WHERE kurs_id = ? AND id = ?', [$kurs_id, $probe_id]);
    if (!$kp || $kp['status'] !== 'erfasst') {
        fehler('NOT_FOUND', 404);
    }
    if (analyse_typ($kp['analyse']) !== feld($an, 'typ')) {
        fehler('FALSCHER_TYP', 422);
    }
    if (wert('SELECT 1 FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ? AND teilnehmer_id = ?', [$kurs_id, $probe_id, $ich['id']])) {
        fehler('BEREITS_ABGEGEBEN', 409);
    }
    $pv = feld($data, 'privat');
    q('INSERT INTO kurs_beurteilungen (kurs_id, probe_id, teilnehmer_id, analyse, privat, abgegeben_at) VALUES (?, ?, ?, ?, ?, ?)',
        [$kurs_id, $probe_id, $ich['id'], py_json($an), wahr($pv) ? py_json($pv) : null, jetzt_iso()]);
    kurs_touch($kurs_id);
    json_ende(['status' => 'abgegeben']);
}

function r_kurs_vergleich(string $kurs_id, string $probe_id): void
{
    $ich = kurs_session_oder_404($kurs_id);
    $eigene = wert('SELECT 1 FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ? AND teilnehmer_id = ?', [$kurs_id, $probe_id, $ich['id']]);
    if ($ich['rolle'] !== 'leitung' && !$eigene) {
        fehler('ERST_EIGENE_ABGEBEN', 403);
    }
    $rows = q('SELECT teilnehmer_id, analyse, privat, abgegeben_at FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ?', [$kurs_id, $probe_id])->fetchAll();
    $pid = wert('SELECT pool_id FROM kurs_proben WHERE kurs_id = ? AND id = ?', [$kurs_id, $probe_id]);
    $referenzen = [];
    if ($pid) {
        $d = pool_eintrag($pid);
        $referenzen = $d instanceof stdClass ? feld($d, 'referenzen', []) : [];
    }
    json_ende(['beurteilungen' => array_map(fn ($r) => ['teilnehmerId' => $r['teilnehmer_id'], 'analyse' => box($r['analyse']), 'privat' => box($r['privat']),
        'abgegebenAt' => $r['abgegeben_at']], $rows), 'referenzen' => $referenzen]);
}

// --- Fotos der Ersterfassung --------------------------------------------------------------------
function r_kurs_foto_hochladen(string $kurs_id, string $foto_id): void
{
    $probe_id = arg('probe');
    $art = arg('art');
    $zweck = arg('zu', 'probe');
    if (!preg_match(FOTO_ID_RE, $foto_id) || !preg_match(ID_RE, $probe_id) || !in_array($art, ['futter', 'labor'], true) || !in_array($zweck, ['probe', 'beurteilung'], true)) {
        fehler('BAD_REQUEST', 400);
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_FOTO_BYTES) {
        fehler('TOO_LARGE', 413);
    }
    $daten = bild_body();
    if (strlen($daten) > MAX_FOTO_BYTES || strlen($daten) < 100 || !bild_typ(substr($daten, 0, 12))) {
        fehler('REJECTED_CONTENT', 422);
    }
    $ich = kurs_session_oder_404($kurs_id);
    $kp = zeile('SELECT owner_id, status FROM kurs_proben WHERE kurs_id = ? AND id = ?', [$kurs_id, $probe_id]);
    if (!$kp) {
        fehler('NOT_FOUND', 404);
    }
    // Fotos zur Probe: Besitzer/Kursleitung. Fotos zur eigenen Beurteilung: alle Kursmitglieder.
    if ($zweck === 'probe' && !in_array($kp['owner_id'], [null, $ich['id']], true) && $ich['rolle'] !== 'leitung') {
        fehler('NOT_FOUND', 404);
    }
    if ($zweck === 'beurteilung' && $kp['status'] !== 'erfasst') {
        fehler('NOT_FOUND', 404);
    }
    $alt = zeile('SELECT bytes, teilnehmer_id FROM kurs_fotos WHERE kurs_id = ? AND id = ?', [$kurs_id, $foto_id]);
    if ($alt && $alt['teilnehmer_id'] !== $ich['id']) {
        fehler('NOT_FOUND', 404);
    }
    $belegt = (int) wert('SELECT COALESCE(SUM(bytes), 0) FROM kurs_fotos WHERE kurs_id = ? AND teilnehmer_id = ? AND id != ?', [$kurs_id, $ich['id'], $foto_id]);
    $limit = foto_limit($ich['email_hmac'], max_foto_total()); // Zusatz-Kontingent (Antrag) für die verknüpfte Adresse
    if ($belegt + strlen($daten) > $limit) {
        fehler('QUOTA', 409, ['bytes' => $belegt, 'limit' => $limit, 'bereich' => 'kurs']);
    }
    if (!foto_platz_frei(strlen($daten) - ($alt ? (int) $alt['bytes'] : 0))) {
        fehler('SERVER_VOLL', 507);
    }
    datei_ablegen(kurs_foto_pfad($kurs_id, $foto_id), $daten);
    q('INSERT INTO kurs_fotos (kurs_id, id, teilnehmer_id, probe_id, art, bytes, created_at, zweck) VALUES (?, ?, ?, ?, ?, ?, ?, ?) '
        . 'ON DUPLICATE KEY UPDATE bytes = VALUES(bytes)', [$kurs_id, $foto_id, $ich['id'], $probe_id, $art, strlen($daten), jetzt_iso(), $zweck]);
    kurs_touch($kurs_id);
    json_ende(['status' => 'ok']);
}

/** Sichtbar für: Hochladende, Kursleitung, alle Kursmitglieder falls als Hilfestellung freigegeben (nur Fotos zur Probe),
 *  sonst nach eigener Abgabe der betreffenden Probe. */
function r_kurs_foto_lesen(string $kurs_id, string $foto_id): void
{
    if (!preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('BAD_REQUEST', 400);
    }
    $ich = kurs_session_oder_404($kurs_id);
    $f = zeile('SELECT * FROM kurs_fotos WHERE kurs_id = ? AND id = ?', [$kurs_id, $foto_id]);
    $pool_quelle = null;
    if (!$f) {
        // Foto einer aus dem Pool übernommenen Probe (keine Kopie)
        foreach (q('SELECT id, pool_id FROM kurs_proben WHERE kurs_id = ? AND pool_id IS NOT NULL', [$kurs_id])->fetchAll() as $kp) {
            $d = pool_eintrag($kp['pool_id']);
            foreach (($d instanceof stdClass && is_array(feld($d, 'fotos'))) ? $d->fotos : [] as $pf) {
                if (feld($pf, 'id') === $foto_id) {
                    $f = ['teilnehmer_id' => null, 'art' => feld($pf, 'art'), 'probe_id' => $kp['id'], 'zweck' => 'probe'];
                    $pool_quelle = $kp['pool_id'];
                    break 2;
                }
            }
        }
    }
    if (!$f) {
        fehler('NOT_FOUND', 404);
    }
    $h = kurs_hinweise($kurs_id);
    $frei = $f['teilnehmer_id'] === $ich['id'] || $ich['rolle'] === 'leitung'
        || ($f['zweck'] === 'probe' && (($f['art'] === 'futter' && wahr($h['foto'] ?? null)) || ($f['art'] === 'labor' && wahr($h['labor'] ?? null))))
        || wert('SELECT 1 FROM kurs_beurteilungen WHERE kurs_id = ? AND probe_id = ? AND teilnehmer_id = ?', [$kurs_id, $f['probe_id'], $ich['id']]);
    if (!$frei) {
        fehler('ERST_EIGENE_ABGEBEN', 403);
    }
    if ($pool_quelle) {
        pool_foto_senden($pool_quelle, $foto_id);
    }
    bild_senden(kurs_foto_pfad($kurs_id, $foto_id));
}

function r_kurs_foto_loeschen(string $kurs_id, string $foto_id): void
{
    $ich = kurs_session($kurs_id);
    $f = $ich ? zeile('SELECT teilnehmer_id FROM kurs_fotos WHERE kurs_id = ? AND id = ?', [$kurs_id, $foto_id]) : null;
    if (!$f || ($f['teilnehmer_id'] !== $ich['id'] && $ich['rolle'] !== 'leitung')) {
        fehler('NOT_FOUND', 404);
    }
    kurs_foto_loeschen($kurs_id, $foto_id);
    json_ende(['status' => 'deleted']);
}

// --- Name, Austreten, Entfernen, Löschen ----------------------------------------------------------
function r_kurs_name(string $kurs_id): void
{
    $pv = feld(body_obj(), 'name');
    $ok = ist_objekt($pv) && schluessel($pv) === ['name'] && is_string($pv->name);
    if ($ok) {
        $n = mb_strlen(py_strip($pv->name));
        $ok = $n > 0 && $n <= 80 && check_privat($pv);
    }
    if (!$ok) {
        fehler('REJECTED_CONTENT', 422);
    }
    $ich = kurs_session_oder_404($kurs_id);
    q('UPDATE kurs_teilnehmende SET name_privat = ? WHERE id = ?', [py_json($pv), $ich['id']]);
    kurs_touch($kurs_id);
    json_ende(['status' => 'ok']);
}

function r_kurs_person_loeschen(string $kurs_id, string $tid): void
{
    $ich = kurs_session($kurs_id);
    if (!$ich || ($ich['id'] !== $tid && $ich['rolle'] !== 'leitung')) {
        fehler('NOT_FOUND', 404);
    }
    $ziel = zeile('SELECT rolle FROM kurs_teilnehmende WHERE id = ? AND kurs_id = ?', [$tid, $kurs_id]);
    if (!$ziel) {
        fehler('NOT_FOUND', 404);
    }
    if ($ziel['rolle'] === 'leitung') {
        fehler('LEITUNG_LOESCHT_KURS', 409);
    }
    foreach (q('SELECT id FROM kurs_fotos WHERE kurs_id = ? AND teilnehmer_id = ?', [$kurs_id, $tid])->fetchAll(PDO::FETCH_COLUMN) as $fid) {
        kurs_foto_loeschen($kurs_id, $fid);
    }
    // Erfasste Proben bleiben dem Kurs erhalten (ohne Besitzer); Fotos und Abgaben der Person werden gelöscht (Fremdschlüssel)
    q('UPDATE kurs_proben SET owner_id = NULL WHERE kurs_id = ? AND owner_id = ?', [$kurs_id, $tid]);
    q('DELETE FROM kurs_teilnehmende WHERE id = ?', [$tid]);
    kurs_touch($kurs_id);
    json_ende(['status' => 'deleted']);
}

function r_kurs_loeschen(string $kurs_id): void
{
    if (!kurs_leitung($kurs_id)) {
        fehler('NOT_FOUND', 404);
    }
    kurs_entfernen($kurs_id);
    json_ende(['status' => 'deleted']);
}

function r_kurs_config(): void
{
    json_ende(['consentVersion' => KURS_CONSENT_VERSION, 'retentionDays' => retention_days(), 'hinweiseDefault' => HINWEIS_DEFAULT,
        'fotoLimitMb' => intdiv(max_foto_total(), 1024 * 1024), 'mail' => konfig('SMTP_HOST', '') !== '' || konfig('SMTP_FROM', '') !== '']);
}
