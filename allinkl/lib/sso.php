<?php
/**
 * Admin-Anmeldung mit dem AGFF-Konto (SSO agff-familie, client «futter», Ed25519) – portiert aus v2_zentral.py.
 * Admin-Sitzung nur mit Recht «futter.admin» und starker Anmeldung (stark_bis). Admin-Passwort bleibt Rückfall.
 */
declare(strict_types=1);

const SITZUNG_COOKIE = 'agff_v2_admin';
const STATE_COOKIE = 'agff_v2_anmeldung';
const SITZUNG_DAUER = 8 * 3600;
const SSO_TOLERANZ = 30;
const SSO_HOECHSTALTER = 300;

function sso_zentral_url(): string
{
    return rtrim((string) konfig('SSO_URL', konfig('ZENTRAL_URL', 'https://graswachstum.ch')), '/');
}

function sso_issuer(): string
{
    return rtrim((string) konfig('SSO_ISSUER', sso_zentral_url()), '/');
}

function sso_client(): string
{
    return (string) konfig('SSO_CLIENT', 'futter');
}

function sso_schluessel(): ?string
{
    $roh = trim((string) konfig('SSO_PUBLIC_KEY', ''));
    if ($roh === '') {
        return null;
    }
    $b = base64_decode($roh, true);
    return ($b !== false && strlen($b) === 32) ? $b : null;
}

function sso_eingerichtet(): bool
{
    return sso_schluessel() !== null;
}

/** Cookie nur für den Pfad dieser App (/futter/ bzw. /wiese/), nicht für die ganze Subdomain. Auf dev COOKIE_PFAD '/', damit die
 *  Anmeldung (Rückkehradresse /futter/anmelden/zurueck) auch für /wiese/ gilt. */
function cookie_setzen(string $name, string $wert, int $dauer): void
{
    setcookie($name, $wert, ['expires' => $dauer > 0 ? time() + $dauer : time() - 3600, 'path' => (string) konfig('COOKIE_PFAD', basis_pfad()), 'secure' => ist_https(),
        'httponly' => true, 'samesite' => 'Lax']);
}

function ist_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

/** @return array|string  Angaben des Tokens oder Fehlertext für die Person */
function sso_token_pruefen(string $token, string $state, ?int $jetzt = null)
{
    $schluessel = sso_schluessel();
    if ($schluessel === null) {
        return 'Die Anmeldung mit dem AGFF-Konto ist nicht eingerichtet (SSO_PUBLIC_KEY fehlt).';
    }
    $teile = explode('.', $token);
    if (count($teile) !== 3) {
        return 'Anmeldung unlesbar. Bitte nochmals anmelden.';
    }
    [$kopf, $rumpf, $sig] = $teile;
    $k = json_decode((string) b64url_dec($kopf), true);
    $d = json_decode((string) b64url_dec($rumpf), true);
    $signatur = b64url_dec($sig);
    if ($signatur === false || !is_array($k) || !is_array($d) || array_is_list($d) && $d !== [] || ($k['alg'] ?? null) !== 'EdDSA') {
        return is_array($k) && is_array($d) ? 'Anmeldung nicht gültig signiert.' : 'Anmeldung unlesbar. Bitte nochmals anmelden.';
    }
    if (strlen($signatur) !== SODIUM_CRYPTO_SIGN_BYTES || !sodium_crypto_sign_verify_detached($signatur, $kopf . '.' . $rumpf, $schluessel)) {
        return 'Anmeldung nicht gültig signiert.';
    }
    $jetzt = $jetzt ?? time();
    if (($d['aud'] ?? null) !== sso_client() || rtrim((string) ($d['iss'] ?? ''), '/') !== sso_issuer()) {
        return 'Anmeldung für eine andere App oder von einem anderen Aussteller.';
    }
    $exp = $d['exp'] ?? null;
    $iat = $d['iat'] ?? null;
    if (!is_int($exp) || !is_int($iat) || $exp + SSO_TOLERANZ < $jetzt || $iat > $jetzt + SSO_TOLERANZ || $iat + SSO_HOECHSTALTER < $jetzt) {
        return 'Anmeldung abgelaufen. Bitte nochmals anmelden.';
    }
    if ($state === '' || !hash_equals($state, (string) ($d['state'] ?? ''))) {
        return 'Anmeldung gehört nicht zu diesem Browser. Bitte nochmals anmelden.';
    }
    $jti = (string) ($d['jti'] ?? '');
    if (strlen($jti) < 16) {
        return 'Anmeldung unvollständig. Bitte nochmals anmelden.';
    }
    q('DELETE FROM zentral_ausweise WHERE expires_at < ?', [$jetzt - SSO_HOECHSTALTER]);
    if (wert('SELECT 1 FROM zentral_ausweise WHERE jti = ?', [$jti])) {
        return 'Anmeldung wurde schon verwendet. Bitte nochmals anmelden.';
    }
    q('INSERT INTO zentral_ausweise (jti, expires_at) VALUES (?, ?)', [$jti, $exp]);
    return $d;
}

function sso_methode(array $d): ?string
{
    $amr = is_array($d['amr'] ?? null) ? $d['amr'] : [];
    $namen = ['hwk' => 'Passkey', 'pwd' => 'Passwort', 'otp' => 'E-Mail-Code', 'fed' => 'Microsoft 365', 'mfa' => 'zweiter Faktor'];
    $t = mb_substr(implode(' + ', array_map(fn ($a) => $namen[$a] ?? (string) $a, $amr)), 0, 60);
    return $t === '' ? null : $t;
}

function sso_sitzung(): ?array
{
    $t = (string) ($_COOKIE[SITZUNG_COOKIE] ?? '');
    if (strlen($t) < 20) {
        return null;
    }
    $r = zeile('SELECT sub, name, methode, expires_at FROM zentral_sitzungen WHERE token_hash = ?', [sha($t)]);
    if (!$r || (int) $r['expires_at'] < time()) {
        return null;
    }
    return ['sub' => $r['sub'], 'name' => $r['name'], 'methode' => $r['methode']];
}

function admin_ok(): bool
{
    if (sso_sitzung()) {
        return true;
    }
    $pw = (string) konfig('ADMIN_PASSWORD', '');
    $ok = $pw !== '' && hash_equals($pw, kopfzeile('X-Admin-Pass'));
    if (!$ok) {
        rate_hit('admin_fail', 20, 900);
    }
    return $ok;
}

function sso_seite(string $text, int $status): void
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    $h = fn ($s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    echo '<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>Anmeldung – Futterbeurteilung v2</title><link rel="stylesheet" href="' . $h(basis_pfad() . 'assets/app.css') . '"></head>'
        . '<body><div class="doc"><h1>Anmeldung</h1><p class="alert warn">' . $h($text) . '</p><p><a class="btn" href="' . $h(basis_pfad() . 'admin') . '">Zur Administration</a></p></div></body></html>';
    exit;
}

function r_anmelden(): void
{
    if (!sso_eingerichtet()) {
        sso_seite('Die Anmeldung mit dem AGFF-Konto ist auf diesem Server nicht eingerichtet. Bitte das Admin-Passwort verwenden.', 503);
    }
    $state = zufall_id(24);
    cookie_setzen(STATE_COOKIE, $state, 900);
    $ziel = sso_zentral_url() . '/_konto/sso/extern?' . http_build_query(['client' => sso_client(), 'state' => $state, 'sprache' => 'de', 'stark' => 1]);
    header('Location: ' . $ziel, true, 302);
    exit;
}

function r_anmelden_zurueck(): void
{
    $state = (string) ($_COOKIE[STATE_COOKIE] ?? '');
    $fehler = arg('error');
    if ($fehler !== '') {
        cookie_setzen(STATE_COOKIE, '', 0);
        sso_seite($fehler === 'cancelled' ? 'Anmeldung abgebrochen.' : 'Ihr AGFF-Konto hat keinen Zugang. Bitte bei der Administration von graswachstum.ch melden.', 403);
    }
    if ($state === '' || !hash_equals($state, arg('state'))) {
        sso_seite('Anmeldung gehört nicht zu diesem Browser oder ist abgelaufen. Bitte nochmals anmelden.', 400);
    }
    $d = sso_token_pruefen(arg('token'), $state);
    if (is_string($d)) {
        sso_seite($d, 400);
    }
    $rollen = is_array($d['roles'] ?? null) ? $d['roles'] : [];
    if (!in_array(sso_client() . '.admin', $rollen, true)) {
        sso_seite('Ihr AGFF-Konto hat keinen Zugang zur Administration von Futter v2 (Recht «' . sso_client() . '.admin» auf graswachstum.ch).', 403);
    }
    if (!(is_int($d['stark_bis'] ?? null) && $d['stark_bis'] > time())) {
        sso_seite('Für die Administration braucht es eine starke Anmeldung (Passkey oder zweiter Faktor). Bitte nochmals anmelden.', 403);
    }
    $token = zufall_id(32);
    $jetzt = time();
    q('DELETE FROM zentral_sitzungen WHERE expires_at < ?', [$jetzt]);
    q('INSERT INTO zentral_sitzungen (token_hash, sub, name, methode, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [sha($token), mb_substr((string) ($d['sub'] ?? ''), 0, 120), mb_substr((string) ($d['name'] ?? ''), 0, 120), sso_methode($d), $jetzt, $jetzt + SITZUNG_DAUER]);
    cookie_setzen(SITZUNG_COOKIE, $token, SITZUNG_DAUER);
    cookie_setzen(STATE_COOKIE, '', 0);
    header('Location: ' . basis_pfad() . 'admin', true, 303);
    exit;
}

function r_admin_ich(): void
{
    $s = sso_sitzung();
    json_ende(['angemeldet' => (bool) $s, 'name' => $s['name'] ?? null, 'methode' => $s['methode'] ?? null, 'zentral' => sso_eingerichtet()]);
}

function r_abmelden(): void
{
    $t = (string) ($_COOKIE[SITZUNG_COOKIE] ?? '');
    if ($t !== '') {
        q('DELETE FROM zentral_sitzungen WHERE token_hash = ?', [sha($t)]);
    }
    cookie_setzen(SITZUNG_COOKIE, '', 0);
    json_ende(['ok' => true]);
}
