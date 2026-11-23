<?php
/**
 * E-Mail: Einmal-Codes und Versand – portiert aus v2_mail.py.
 * Versand auf all-inkl über PHP mail() (lokales sendmail des Web-PHP); im Testmodus (V2_MAIL_DRYRUN_FILE)
 * landet die Nachricht als JSON-Zeile in einer Datei – gleiches Format wie Flask, damit der Prüfstand Codes lesen kann.
 */
declare(strict_types=1);

const CODE_TTL = 15 * 60;
const CODE_ATTEMPTS = 5;

function code_erzeugen(string $zweck, string $email, ?int $ttl = null): string
{
    rate_hit('code_mail:' . email_hmac($email), 5, 3600);
    $code = sprintf('%06d', random_int(0, 999999));
    q('INSERT INTO email_codes (zweck, email_hmac, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0) '
        . 'ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), attempts = 0',
        [$zweck, email_hmac($email), sha($zweck . '|' . $code), microtime(true) + ($ttl ?: CODE_TTL)]);
    return $code;
}

/** true bei korrektem Code (dann verbraucht). Nach 5 Fehlversuchen wird der Code gelöscht. */
function code_pruefen(string $zweck, string $email, $code): bool
{
    $code = trim($code === null ? '' : py_str($code));
    if (!preg_match('/^\d{6}$/', $code)) {
        return false;
    }
    $eh = email_hmac($email);
    $c = zeile('SELECT * FROM email_codes WHERE zweck = ? AND email_hmac = ?', [$zweck, $eh]);
    if (!$c || (float) $c['expires_at'] < microtime(true)) {
        return false;
    }
    if (!hash_equals($c['code_hash'], sha($zweck . '|' . $code))) {
        if ((int) $c['attempts'] + 1 >= CODE_ATTEMPTS) {
            q('DELETE FROM email_codes WHERE zweck = ? AND email_hmac = ?', [$zweck, $eh]);
        } else {
            q('UPDATE email_codes SET attempts = attempts + 1 WHERE zweck = ? AND email_hmac = ?', [$zweck, $eh]);
        }
        return false;
    }
    q('DELETE FROM email_codes WHERE zweck = ? AND email_hmac = ?', [$zweck, $eh]);
    return true;
}

function mail_senden(string $an, string $betreff, string $text, ?string $html = null): void
{
    $datei = (string) konfig('V2_MAIL_DRYRUN_FILE', '');
    if ($datei !== '') { // nur für automatische Tests
        preg_match('/\b(\d{6})\b/', $text, $m);
        $ml = preg_match('/(\S*)#login=([A-Za-z0-9_.-]+)/', $text, $l);
        file_put_contents($datei, json_encode(['to' => $an, 'betreff' => $betreff, 'code' => $m[1] ?? null,
            'login' => $ml ? $l[2] : null, 'loginBase' => $ml ? $l[1] : null], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        return;
    }
    $absender = (string) konfig('SMTP_FROM', konfig('SMTP_USER', ''));
    if ($absender === '' || !email_ok($absender) || !email_ok($an)) {
        error_log('futter-v2 MAIL: Absender nicht konfiguriert – nicht versendet');
        return;
    }
    $text .= "\n-- \nAGFF Futterbeurteilung v2 · app.graswachstum.ch\nDiese Nachricht wurde automatisch versendet. Bitte nicht antworten.\n";
    $kopf = ['From' => mb_encode_mimeheader('Futterbeurteilung', 'UTF-8', 'Q') . ' <' . $absender . '>', 'Auto-Submitted' => 'auto-generated',
        'MIME-Version' => '1.0'];
    if ($html === null) {
        $kopf['Content-Type'] = 'text/plain; charset=UTF-8';
        $kopf['Content-Transfer-Encoding'] = '8bit';
        $rumpf = $text;
    } else {
        $grenze = 'agff-' . bin2hex(random_bytes(12));
        $kopf['Content-Type'] = 'multipart/alternative; boundary="' . $grenze . '"';
        $rumpf = "--$grenze\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text))
            . "--$grenze\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html))
            . "--$grenze--\r\n";
    }
    if (!mail($an, mb_encode_mimeheader($betreff, 'UTF-8', 'Q'), $rumpf, $kopf, '-f' . $absender)) {
        error_log('futter-v2 MAIL: Versand fehlgeschlagen');
    }
}

/** $link: Basis-URL, an die der Code angehängt wird (Bestätigung per Antippen, 48 h gültig). */
function code_senden(string $zweck, string $email, string $wozu, ?string $link = null): void
{
    if ($link) {
        $code = code_erzeugen($zweck, $email, 48 * 3600);
        mail_senden(email_norm($email), 'Bitte E-Mail-Adresse bestätigen',
            "Bitte bestätigen Sie Ihre E-Mail-Adresse für die Futterbeurteilung ($wozu).\n\n"
            . "Link auf dem Gerät antippen, mit dem Sie mitmachen:\n$link$code\n\n"
            . "Oder den Code in der App eingeben:  $code\n\n"
            . "Der Link ist 48 Stunden gültig. Nach der Bestätigung finden Sie Ihre Proben auch auf anderen Geräten wieder.\n\n"
            . "Falls Sie sich nicht angemeldet haben, können Sie diese E-Mail ignorieren.\n");
        return;
    }
    $code = code_erzeugen($zweck, $email);
    mail_senden(email_norm($email), 'Ihr Bestätigungscode: ' . $code,
        "Ihr Code für die Futterbeurteilung ($wozu) lautet:\n\n    $code\n\n"
        . "Der Code ist 15 Minuten gültig. Geben Sie ihn in der App ein.\n\n"
        . "Falls Sie keinen Code angefordert haben, können Sie diese E-Mail ignorieren.\n");
}

/** Anmelde-E-Mail: Code (15 Minuten) und Anmelde-Knopf (Link 24 Monate gültig, widerrufbar). */
function login_senden(string $email, string $code, string $link, string $produkt = 'Futterbeurteilung'): void
{
    $text = "Ihr Anmeldecode für AGFF $produkt:\n\n    $code\n\nDer Code ist 15 Minuten gültig.\n\n"
        . "Oder direkt anmelden (auf diesem Gerät antippen):\n$link\n\n"
        . 'Der Anmelde-Link bleibt 24 Monate gültig, damit Sie sich später wieder anmelden können. '
        . 'Behandeln Sie diese E-Mail wie einen Schlüssel: nicht weiterleiten. '
        . "In der App unter «Daten › Konto» können Sie Links und Geräte jederzeit widerrufen.\n\n"
        . "Falls Sie sich nicht anmelden wollten, können Sie diese E-Mail ignorieren.\n";
    $h = fn ($x) => htmlspecialchars($x, ENT_QUOTES, 'UTF-8');
    $l = $h($link);
    $html = '<!doctype html><html><body style="margin:0;background:#f2f5f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2925">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">'
        . '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:14px;padding:24px" cellpadding="0" cellspacing="0"><tr><td>'
        . '<p style="margin:0 0 4px;font-size:13px;color:#5b6b66">AGFF ' . $h($produkt) . '</p>'
        . '<h1 style="margin:0 0 18px;font-size:20px">Anmelden</h1>'
        . '<p style="margin:0 0 8px;font-size:14px">Ihr Code (15 Minuten gültig):</p>'
        . '<div style="font-size:34px;letter-spacing:10px;font-weight:700;font-family:Menlo,Consolas,monospace;background:#e3f1ea;color:#0f5a43;border-radius:10px;padding:14px 0;text-align:center;-webkit-user-select:all;user-select:all">' . $h($code) . '</div>'
        . '<p style="margin:6px 0 22px;font-size:12px;color:#5b6b66;text-align:center">Code antippen bzw. doppelklicken und kopieren – die App fügt ihn mit «Einfügen» ein.</p>'
        . '<p style="margin:0 0 10px;font-size:14px">Oder ohne Code direkt anmelden:</p>'
        . '<p style="margin:0 0 18px;text-align:center"><a href="' . $l . '" style="display:inline-block;background:#1f8a4c;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:12px">In der App anmelden</a></p>'
        . '<p style="margin:0 0 8px;font-size:12px;color:#5b6b66">Der Anmelde-Knopf bleibt <b>24 Monate</b> gültig – so können Sie sich später auf jedem Gerät wieder anmelden. '
        . 'Behandeln Sie diese E-Mail wie einen Schlüssel und leiten Sie sie nicht weiter. Widerrufen: in der App unter «Daten › Konto».</p>'
        . '<p style="margin:0;font-size:12px;color:#5b6b66">Falls Sie sich nicht anmelden wollten, ignorieren Sie diese E-Mail.</p>'
        . '</td></tr></table></td></tr></table></body></html>';
    mail_senden(email_norm($email), 'Anmeldecode: ' . $code, $text, $html);
}

function admin_adresse(): ?string
{
    $a = (string) konfig('V2_ADMIN_MAIL', konfig('SMTP_FROM', ''));
    return $a !== '' ? $a : null;
}
