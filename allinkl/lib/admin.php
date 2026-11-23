<?php
/**
 * Freischaltung der Kursleitung und Betriebs-Administration – portiert aus v2_admin.py.
 *
 * Wer einen Kurs anlegen darf (immer mit bestätigter E-Mail-Adresse):
 *   1. Adresse/Domain auf der Freigabeliste (V2_KURSLEITUNG_DOMAINS, V2_KURSLEITUNG_EMAILS oder vom Betreiber freigeschaltet)
 *   2. gültiger Einladungscode
 * Alle anderen können einen Antrag stellen; der Betreiber entscheidet auf der Admin-Seite.
 */
declare(strict_types=1);

const EINLADUNG_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function foto_gesamt_bytes(): int
{
    return (int) konfig('V2_FOTO_GESAMT_MB', 5000) * 1024 * 1024;
}

function kl_domains(): array
{
    $d = [];
    foreach (explode(',', (string) konfig('V2_KURSLEITUNG_DOMAINS', '')) as $x) {
        if (trim($x) !== '') {
            $d[ltrim(mb_strtolower(trim($x)), '@')] = true;
        }
    }
    return array_keys($d);
}

function kl_adressen(): array
{
    $d = [];
    foreach (explode(',', (string) konfig('V2_KURSLEITUNG_EMAILS', '')) as $x) {
        if (trim($x) !== '') {
            $d[email_norm($x)] = true;
        }
    }
    return array_keys($d);
}

function darf_kurs_anlegen(string $email): bool
{
    $email = email_norm($email);
    $teile = explode('@', $email);
    if (in_array(end($teile), kl_domains(), true) || in_array($email, kl_adressen(), true)) {
        return true;
    }
    return wert('SELECT status FROM kursleitende WHERE email_hmac = ?', [email_hmac($email)]) === 'frei';
}

/** ''.join(ch for ch in str(code or '').upper() if ch.isalnum()) */
function einladung_norm($code): string
{
    $s = wahr($code) ? py_str($code) : '';
    return (string) preg_replace('/[^\p{L}\p{N}]/u', '', mb_strtoupper($s));
}

function einladung_zeile(string $c): ?array
{
    return zeile('SELECT * FROM einladungen WHERE code_hash = ?', [sha('einladung|' . $c)]);
}

function einladung_gueltig($code): bool
{
    $c = einladung_norm($code);
    if (mb_strlen($c) < 8) {
        return false;
    }
    $r = einladung_zeile($c);
    return $r && !$r['revoked'] && (int) $r['uses'] < (int) $r['max_uses'] && (float) $r['expires_at'] > microtime(true);
}

/** Nach bestätigter E-Mail: Code verbrauchen und Adresse freischalten. */
function einladung_einloesen(string $code, string $email): bool
{
    $r = einladung_zeile(einladung_norm($code));
    if (!$r || $r['revoked'] || (int) $r['uses'] >= (int) $r['max_uses'] || (float) $r['expires_at'] < microtime(true)) {
        return false;
    }
    q('UPDATE einladungen SET uses = uses + 1 WHERE code_hash = ?', [$r['code_hash']]);
    q("INSERT INTO kursleitende (email_hmac, email_enc, status, via, created_at, decided_at) VALUES (?, ?, 'frei', 'einladung', ?, ?) "
        . "ON DUPLICATE KEY UPDATE status = 'frei', via = 'einladung', decided_at = VALUES(decided_at)",
        [email_hmac($email), email_enc($email), jetzt_iso(), jetzt_iso()]);
    return true;
}

/** str(b.get(k) or '').strip()[:n] */
function text_feld(stdClass $b, string $k, int $n): string
{
    $v = feld($b, $k);
    return py_kurz(py_strip(wahr($v) ? py_str($v) : ''), $n);
}

// --- Antrag stellen ------------------------------------------------------------------------------
/** Prüft, ob eine Adresse Kurse anlegen darf (nur ja/nein). */
function r_kl_status(): void
{
    rate_hit('kl_status', 30, 3600);
    $email = body_email(body_obj());
    if (!email_ok($email)) {
        fehler('BAD_REQUEST', 400);
    }
    json_ende(['frei' => darf_kurs_anlegen($email)]);
}

function r_kl_antrag_code(): void
{
    rate_hit('kl_antrag', 10, 3600);
    $email = body_email(body_obj());
    if (!email_ok($email)) {
        fehler('BAD_REQUEST', 400);
    }
    code_senden('antrag', $email, 'Antrag Kursleitung');
    json_ende(['status' => 'sent']);
}

function r_kl_antrag(): void
{
    $b = body_obj();
    $email = body_email($b);
    if (!email_ok($email) || feld(feld_obj($b, 'consent'), 'accepted') !== true) {
        fehler('BAD_REQUEST', 400);
    }
    $name = text_feld($b, 'name', 120);
    $org = text_feld($b, 'org', 200);
    $text = text_feld($b, 'text', 1000);
    if ($name === '') {
        fehler('NAME_FEHLT', 400);
    }
    if (!code_pruefen('antrag', $email, feld($b, 'code'))) {
        fehler('CODE_INVALID', 400);
    }
    $eh = email_hmac($email);
    $frei = darf_kurs_anlegen($email);
    if (wert('SELECT status FROM kursleitende WHERE email_hmac = ?', [$eh]) === 'frei') {
        json_ende(['status' => 'frei']);
    }
    q("INSERT INTO kursleitende (email_hmac, email_enc, name_enc, org_enc, text_enc, status, via, created_at) VALUES (?, ?, ?, ?, ?, ?, 'antrag', ?) "
        . 'ON DUPLICATE KEY UPDATE name_enc = VALUES(name_enc), org_enc = VALUES(org_enc), text_enc = VALUES(text_enc), status = VALUES(status), created_at = VALUES(created_at)',
        [$eh, email_enc($email), text_enc($name, 'kl'), text_enc($org, 'kl'), text_enc($text, 'kl'), $frei ? 'frei' : 'antrag', jetzt_iso()]);
    if (!$frei && admin_adresse()) {
        mail_senden(admin_adresse(), 'Neuer Antrag Kursleitung',
            $name . ' (' . ($org !== '' ? $org : 'ohne Organisation') . ") möchte Kurse anlegen.\n\n"
            . 'Bitte auf der Admin-Seite entscheiden: ' . app_url() . "admin\n");
    }
    json_ende(['status' => $frei ? 'frei' : 'antrag']);
}

/** Öffentliche Adresse der App mit Schrägstrich am Ende (für Links in E-Mails). */
function app_url(): string
{
    $u = (string) konfig('V2_PUBLIC_URL', '');
    return $u !== '' ? $u : 'https://' . host() . basis_pfad();
}

// --- Administration (zentrale Anmeldung oder Admin-Passwort) ----------------------------------------
function admin_oder_404(): void
{
    if (!admin_ok()) {
        fehler('NOT_FOUND', 404);
    }
}

function r_admin_uebersicht(): void
{
    admin_oder_404();
    $kl = q("SELECT * FROM kursleitende ORDER BY status = 'antrag' DESC, created_at DESC")->fetchAll();
    $inv = q('SELECT hinweis, notiz, max_uses, uses, expires_at, revoked, created_at, code_hash FROM einladungen ORDER BY created_at DESC')->fetchAll();
    $stat = [
        'freigaben' => (int) wert('SELECT COUNT(*) FROM e2e_spaces'),
        'kurse' => (int) wert("SELECT COUNT(*) FROM kurse WHERE status = 'aktiv'"),
        'teilnehmende' => (int) wert('SELECT COUNT(*) FROM kurs_teilnehmende'),
        'fotoBytes' => foto_bytes_gesamt(),
        'pool' => (int) wert('SELECT COUNT(*) FROM pool_proben'),
        'fotoLimit' => foto_gesamt_bytes(),
    ];
    $dec = fn ($v) => $v ? text_dec($v, 'kl') : null;
    $domains = kl_domains();
    sort($domains, SORT_STRING);
    json_ende([
        'kursleitende' => array_map(fn ($r) => ['id' => $r['email_hmac'], 'email' => email_dec($r['email_enc']), 'name' => $dec($r['name_enc']),
            'org' => $dec($r['org_enc']), 'text' => $dec($r['text_enc']), 'status' => $r['status'], 'via' => $r['via'],
            'createdAt' => $r['created_at'], 'decidedAt' => $r['decided_at']], $kl),
        'einladungen' => array_map(fn ($r) => ['id' => substr($r['code_hash'], 0, 16), 'hinweis' => $r['hinweis'], 'notiz' => $r['notiz'],
            'max' => (int) $r['max_uses'], 'uses' => (int) $r['uses'], 'expiresAt' => (float) $r['expires_at'], 'revoked' => (bool) $r['revoked'],
            'createdAt' => $r['created_at']], $inv),
        'domains' => $domains, 'adressen' => count(kl_adressen()), 'statistik' => $stat,
    ]);
}

function r_admin_kl_entscheid(string $eh): void
{
    admin_oder_404();
    $status = feld(body_obj(), 'status');
    if (!in_array($status, ['frei', 'abgelehnt', 'loeschen'], true)) {
        fehler('BAD_REQUEST', 400);
    }
    $enc = wert('SELECT email_enc FROM kursleitende WHERE email_hmac = ?', [$eh]);
    if ($enc === null) {
        fehler('NOT_FOUND', 404);
    }
    if ($status === 'loeschen') {
        q('DELETE FROM kursleitende WHERE email_hmac = ?', [$eh]);
    } else {
        q('UPDATE kursleitende SET status = ?, decided_at = ? WHERE email_hmac = ?', [$status, jetzt_iso(), $eh]);
    }
    $email = email_dec($enc);
    if ($email && $status === 'frei') {
        mail_senden($email, 'Freigeschaltet: Kurse anlegen', "Ihr Antrag wurde angenommen. Sie können jetzt in der Futterbeurteilung Kurse anlegen:\n"
            . app_url() . "\n\n"
            . 'Ein Kurs, den Sie vor der Freischaltung angelegt haben, wurde noch nicht gespeichert. '
            . "Bitte unter «Neuer Anlass» → «Kurs» nochmals anlegen – auf demselben Gerät sind Ihre Angaben bereits ausgefüllt.\n");
    } elseif ($email && $status === 'abgelehnt') {
        mail_senden($email, 'Ihr Antrag Kursleitung', "Ihr Antrag, Kurse anzulegen, wurde leider nicht angenommen.\n");
    }
    json_ende(['status' => 'ok']);
}

/** int(b.get(k) or standard), begrenzt; ungültige Zahl → 400 (Flask: ValueError → 500). */
function zahl_feld(stdClass $b, string $k, int $standard, int $lo, int $hi): int
{
    $v = feld($b, $k);
    $n = wahr($v) ? py_int($v) : $standard;
    if ($n === null) {
        fehler('BAD_REQUEST', 400);
    }
    return max($lo, min($hi, $n));
}

function r_admin_einladung_neu(): void
{
    admin_oder_404();
    $b = body_obj();
    $max = zahl_feld($b, 'max', 1, 1, 500);
    $tage = zahl_feld($b, 'tage', 30, 1, 365);
    $code = '';
    for ($i = 0; $i < 12; $i++) {
        $code .= EINLADUNG_ZEICHEN[random_int(0, strlen(EINLADUNG_ZEICHEN) - 1)];
    }
    $notiz = feld($b, 'notiz');
    q('INSERT INTO einladungen (code_hash, hinweis, notiz, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [sha('einladung|' . $code), substr($code, -3), py_kurz(wahr($notiz) ? py_str($notiz) : '', 200), $max, microtime(true) + $tage * 86400, jetzt_iso()]);
    json_ende(['code' => implode('-', str_split($code, 4)), 'max' => $max, 'tage' => $tage]);
}

function r_admin_einladung_sperren(string $cid): void
{
    admin_oder_404();
    q('UPDATE einladungen SET revoked = 1 WHERE SUBSTRING(code_hash, 1, 16) = ?', [$cid]);
    json_ende(['status' => 'ok']);
}
