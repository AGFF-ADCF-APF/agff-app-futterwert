<?php
/**
 * Konto (Anmeldung per E-Mail) und Cloud-Speicherung – portiert aus v2_konto.py.
 * Teil 2: nur, was andere Module brauchen (Sitzung, bestätigte Adresse, Foto-Kontingent). Rest folgt in Teil 3.
 */
declare(strict_types=1);

/** Konto der Sitzung aus Kopfzeile «X-Konto» (Zeile mit sid, expires_at und den Konto-Spalten) oder null. */
function konto_sitzung(): ?array
{
    $tok = kopfzeile('X-Konto');
    if (!preg_match(TOKEN_RE, $tok)) {
        return null;
    }
    $s = zeile('SELECT s.id AS sid, s.expires_at, k.* FROM konto_sessions s JOIN konten k ON k.id = s.konto_id WHERE s.token_hash = ?', [sha('konto|' . $tok)]);
    if (!$s || (float) $s['expires_at'] < microtime(true)) {
        rate_hit('konto_fail', 60, 600);
        return null;
    }
    $jetzt = jetzt_iso();
    if (substr((string) $s['last_seen'], 0, 10) !== substr($jetzt, 0, 10)) {
        q('UPDATE konten SET last_seen = ? WHERE id = ?', [$jetzt, $s['id']]);
        q('UPDATE konto_sessions SET last_used = ? WHERE id = ?', [$jetzt, $s['sid']]);
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
    $mb = wert('SELECT mb FROM foto_quota WHERE email_hmac = ?', [$email_hmac]);
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
    foreach (['e2e_fotos', 'kurs_fotos', 'pool_fotos'] as $tab) {
        $t += (int) wert("SELECT COALESCE(SUM(bytes), 0) FROM $tab");
    }
    return $t;
}
