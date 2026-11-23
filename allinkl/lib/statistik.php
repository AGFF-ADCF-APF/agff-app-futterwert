<?php
/**
 * Anonyme Beiträge und regionaler Vergleich – portiert aus v2_statistik.py.
 * Vergleiche erst ab K_MIN Beiträgen je Gruppe (k-Anonymität).
 */
declare(strict_types=1);

const BEITRAG_CONSENT_VERSION = '2026-10-s1';
const K_MIN = 5;
const KURZ_RE = '/^[A-Za-z0-9_.-]{0,16}$/D';
const WERTE = ['nel', 'nev', 'apde', 'apdn', 'rp', 'rf', 'ndf', 'zucker', 'staerke'];
const LABOR = ['nel', 'nev', 'apde', 'apdn', 'rp', 'ts', 'rf', 'ndf', 'adf', 'zucker', 'ra', 'ph', 'milchsaeure', 'essigsaeure', 'buttersaeure'];
const ZONEN = [['h1', 'unter 600 m', 0, 600], ['h2', '600–1000 m', 600, 1000], ['h3', '1000–1400 m', 1000, 1400], ['h4', 'über 1400 m', 1400, 5000]];

function zahl_in($v, float $lo, float $hi): bool
{
    return (is_int($v) || is_float($v)) && $v >= $lo && $v <= $hi;
}

/** Strikte Whitelist wie v2_statistik.pruefen. Liefert bereinigtes Array (für json) oder null. */
function beitrag_pruefen($d): ?array
{
    $erlaubt = ['typ', 'plz', 'hoehe', 'jahr', 'monat', 'aufwuchs', 'bestand', 'stadium', 'klasse', 'punkte', 'antworten', 'rad', 'werte', 'labor', 'quelle', 'n'];
    if (!ist_objekt($d) || !in_array(feld($d, 'typ'), FUTTERARTEN, true) || array_diff(schluessel($d), $erlaubt)) {
        return null;
    }
    $plz = feld($d, 'plz');  // Python: str(d.get('plz') or '') – Zahlen ohne Nachkommastellen gelten, alles andere nicht
    $plz = is_string($plz) ? $plz : (is_int($plz) && $plz !== 0 ? (string) $plz : (wahr($plz) ? 'x' : ''));
    if (!preg_match('/^[1-9]\d{3}$/D', $plz)) {
        return null;
    }
    $out = ['typ' => $d->typ, 'plz' => $plz];
    if (feld($d, 'quelle') !== null) {
        if (!in_array($d->quelle, ['eigen', 'kurs'], true)) {
            return null;
        }
        $out['quelle'] = $d->quelle;
    }
    if (feld($d, 'n') !== null) {
        if (!(is_int($d->n) && $d->n >= 0 && $d->n <= 500)) {
            return null;
        }
        $out['n'] = $d->n;
    }
    if (feld($d, 'hoehe') !== null) {
        if (!zahl_in($d->hoehe, 0, 4000)) {
            return null;
        }
        $out['hoehe'] = (int) (py_round($d->hoehe / 100.0, 0) * 100);
    }
    if (!(zahl_in(feld($d, 'jahr'), 2000, 2100) && zahl_in(feld($d, 'monat'), 1, 12))) {
        return null;
    }
    $out['jahr'] = (int) $d->jahr;
    $out['monat'] = (int) $d->monat;
    foreach (['aufwuchs', 'bestand', 'stadium', 'klasse'] as $k) {
        if (feld($d, $k) !== null) {
            if (!is_string($d->$k) || !preg_match(KURZ_RE, $d->$k)) {
                return null;
            }
            $out[$k] = $d->$k;
        }
    }
    if (feld($d, 'punkte') !== null) {
        if (!zahl_in($d->punkte, 0, 60)) {
            return null;
        }
        $out['punkte'] = $d->punkte;
    }
    foreach (['antworten', 'rad'] as $teil) {
        $x = feld($d, $teil);
        $x = wahr($x) ? $x : new stdClass();
        if (!ist_objekt($x) || count(get_object_vars($x)) > 30) {
            return null;
        }
        $clean = new stdClass();
        foreach (get_object_vars($x) as $k => $v) {
            if (!preg_match(KURZ_RE, (string) $k)) {
                return null;
            }
            if (is_bool($v) || $v === null || zahl_in($v, -1e5, 1e5) || (is_string($v) && preg_match(KURZ_RE, $v))) {
                $clean->$k = $v;
            } else {
                return null;
            }
        }
        $out[$teil] = $clean;
    }
    foreach (['werte' => WERTE, 'labor' => LABOR] as $teil => $keys) {
        $x = feld($d, $teil);
        $x = wahr($x) ? $x : new stdClass();
        if (!ist_objekt($x) || array_diff(schluessel($x), $keys)) {
            return null;
        }
        foreach (get_object_vars($x) as $v) {
            if (!zahl_in($v, 0, 2000)) {
                return null;
            }
        }
        if (count(get_object_vars($x))) {
            $out[$teil] = $x;
        }
    }
    return $out;
}

/** round() wie Python: richtig gerundet nach dem exakten Binärwert, bei exakten Hälften zur geraden Zahl.
 *  printf rundet in glibc genauso (PHPs round() rundet dagegen «vor» und weicht z. B. bei 5.675 ab). */
function py_round(float $x, int $stellen): float
{
    return (float) sprintf('%.' . $stellen . 'F', $x);
}

/** math.fsum / statistics.fmean: exakt gerundete Summe (Shewchuk, wie CPython msum). */
function fsum(array $werte): float
{
    $teile = [];
    foreach ($werte as $x) {
        $x = (float) $x;
        $neu = [];
        foreach ($teile as $y) {
            if (abs($x) < abs($y)) {
                [$x, $y] = [$y, $x];
            }
            $hi = $x + $y;
            $lo = $y - ($hi - $x);
            if ($lo != 0.0) {
                $neu[] = $lo;
            }
            $x = $hi;
        }
        $neu[] = $x;
        $teile = $neu;
    }
    // Teilsummen von oben her zusammenzählen mit Korrektur für halbe Einheiten (wie CPython)
    $n = count($teile);
    if ($n === 0) {
        return 0.0;
    }
    $hi = $teile[--$n];
    $lo = 0.0;
    while ($n > 0) {
        $x = $hi;
        $y = $teile[--$n];
        $hi = $x + $y;
        $yr = $hi - $x;
        $lo = $y - $yr;
        if ($lo != 0.0) {
            break;
        }
    }
    if ($n > 0 && (($lo < 0 && $teile[$n - 1] < 0) || ($lo > 0 && $teile[$n - 1] > 0))) {
        $y = $lo * 2;
        $x = $hi + $y;
        $yr = $x - $hi;
        if ($y == $yr) {
            $hi = $x;
        }
    }
    return $hi;
}

/** statistics.quantiles(..., method='inclusive') */
function quantile(array $s, int $n): array
{
    $m = count($s) - 1;
    $out = [];
    for ($i = 1; $i < $n; $i++) {
        $j = intdiv($i * $m, $n);
        $delta = $i * $m - $j * $n;
        $out[] = ($s[$j] * ($n - $delta) + ($s[$j + 1] ?? $s[$j]) * $delta) / $n;
    }
    return $out;
}

function median(array $s): float
{
    sort($s);
    $n = count($s);
    $h = intdiv($n, 2);
    return $n % 2 ? (float) $s[$h] : ($s[$h - 1] + $s[$h]) / 2;
}

function verteilung(array $werte): ?array
{
    if (count($werte) < K_MIN) {
        return null;
    }
    sort($werte);
    $q10 = quantile($werte, 10);
    $q4 = quantile($werte, 4);
    return ['n' => count($werte), 'p10' => py_round($q10[0], 2), 'p25' => py_round($q4[0], 2), 'p50' => py_round(median($werte), 2),
        'p75' => py_round($q4[2], 2), 'p90' => py_round($q10[8], 2), 'mittel' => py_round(fsum($werte) / count($werte), 2)];
}

function werte_von(array $daten, string $teil, string $k): array
{
    $r = [];
    foreach ($daten as $d) {
        if (isset($d[$teil]) && is_array($d[$teil]) && array_key_exists($k, $d[$teil])) {
            $r[] = $d[$teil][$k];
        }
    }
    return $r;
}

function klassen_zaehlen(array $daten): stdClass
{
    $kl = new stdClass();
    foreach ($daten as $d) {
        if (!empty($d['klasse'])) {
            $kl->{$d['klasse']} = ($kl->{$d['klasse']} ?? 0) + 1;
        }
    }
    return $kl;
}

function gruppe(array $daten): array
{
    if (count($daten) < K_MIN) {
        return ['n' => count($daten)];
    }
    $out = ['n' => count($daten)];
    foreach (['nel', 'apde', 'rp'] as $k) {
        $v = verteilung(werte_von($daten, 'werte', $k));
        if ($v) {
            $out[$k] = $v;
        }
    }
    $lab = verteilung(werte_von($daten, 'labor', 'nel'));
    if ($lab) {
        $out['laborNel'] = $lab;
    }
    $out['klassen'] = klassen_zaehlen($daten);
    return $out;
}

function kennwerte(array $daten): array
{
    $out = ['n' => count($daten)];
    if (count($daten) < K_MIN) {
        return $out;
    }
    $v = verteilung(werte_von($daten, 'werte', 'nel'));
    if ($v) {
        $out['nel'] = $v;
    }
    $lab = verteilung(werte_von($daten, 'labor', 'nel'));
    if ($lab) {
        $out['laborNel'] = $lab;
    }
    $out['klassen'] = klassen_zaehlen($daten);
    $out['kurs'] = count(array_filter($daten, fn ($d) => ($d['quelle'] ?? null) === 'kurs'));
    return $out;
}

function dekodiere_daten(string $json): array
{
    return json_decode($json, true, 64, JSON_THROW_ON_ERROR);
}

// --- Routen ----------------------------------------------------------------------------------
function r_beitrag_speichern(string $bid): void
{
    rate_hit('beitrag', 200, 3600);
    $body = json_body();
    $body = wahr($body) ? $body : new stdClass();
    $tok = feld($body, 'token', '');
    if (!preg_match(ID_RE, $bid) || !is_string($tok) || !preg_match(TOKEN_RE, $tok)) {
        fehler('BAD_REQUEST', 400);
    }
    $consent = feld($body, 'consent');
    $consent = wahr($consent) ? $consent : new stdClass();
    if (feld($consent, 'version') !== BEITRAG_CONSENT_VERSION) {
        fehler('CONSENT_REQUIRED', 400, ['consentVersion' => BEITRAG_CONSENT_VERSION]);
    }
    $d = beitrag_pruefen(feld($body, 'daten'));
    if ($d === null) {
        fehler('REJECTED_CONTENT', 422);
    }
    $alt = zeile('SELECT token_hash FROM futter_beitraege WHERE id = ?', [$bid]);
    if ($alt && !hash_equals($alt['token_hash'], sha($tok))) {
        fehler('NOT_FOUND', 404);
    }
    $jetzt = jetzt_iso();
    q('INSERT INTO futter_beitraege (id, token_hash, typ, plz, region, jahr, aufwuchs, daten, consent_version, created_at, updated_at) '
        . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE typ = VALUES(typ), plz = VALUES(plz), region = VALUES(region), '
        . 'jahr = VALUES(jahr), aufwuchs = VALUES(aufwuchs), daten = VALUES(daten), consent_version = VALUES(consent_version), updated_at = VALUES(updated_at)',
        [$bid, sha($tok), $d['typ'], $d['plz'], substr($d['plz'], 0, 2), $d['jahr'], $d['aufwuchs'] ?? null, json_text($d), BEITRAG_CONSENT_VERSION, $jetzt, $jetzt]);
    json_ende(['status' => 'ok']);
}

function r_beitrag_loeschen(string $bid): void
{
    $tok = kopfzeile('X-Beitrag-Token');
    $alt = zeile('SELECT token_hash FROM futter_beitraege WHERE id = ?', [$bid]);
    if ($alt && preg_match(TOKEN_RE, $tok) && hash_equals($alt['token_hash'], sha($tok))) {
        q('DELETE FROM futter_beitraege WHERE id = ?', [$bid]);
    }
    json_ende(['status' => 'deleted']);
}

function r_vergleich(): void
{
    rate_hit('vergleich', 300, 3600);
    $typ = arg('typ');
    $plz = arg('plz');
    $aufwuchs = arg('aufwuchs');
    if (!in_array($typ, FUTTERARTEN, true) || !preg_match('/^[1-9]\d{3}$/D', $plz)) {
        fehler('BAD_REQUEST', 400);
    }
    $seit = arg('seit', '0');
    if (!preg_match('/^\s*[+-]?\d+\s*$/D', $seit === '' ? '0' : $seit)) {
        throw new RuntimeException('seit ungültig'); // Python: int() → ValueError → 500
    }
    $jahr_min = (int) ($seit === '' ? '0' : $seit);
    $sql = 'SELECT daten FROM futter_beitraege WHERE typ = ? AND (jahr >= ? OR ? = 0)';
    $par = [$typ, $jahr_min, $jahr_min];
    if (in_array($aufwuchs, ['1', 'f'], true)) {
        $sql .= ' AND aufwuchs = ?';
        $par[] = $aufwuchs;
    }
    $region = array_map('dekodiere_daten', q($sql . ' AND region = ?', array_merge($par, [substr($plz, 0, 2)]))->fetchAll(PDO::FETCH_COLUMN));
    $schweiz = array_map('dekodiere_daten', q($sql, $par)->fetchAll(PDO::FETCH_COLUMN));
    json_ende(['region' => gruppe($region) + ['plz2' => substr($plz, 0, 2)], 'schweiz' => gruppe($schweiz), 'kMin' => K_MIN]);
}

function r_schweiz(): void
{
    rate_hit('schweiz', 300, 3600);
    $typ = arg('typ', 'alle');
    if ($typ !== 'alle' && !in_array($typ, FUTTERARTEN, true)) {
        fehler('BAD_REQUEST', 400);
    }
    $seit = arg('seit', '0');
    $seit = $seit === '' ? '0' : $seit;
    if (!preg_match('/^\s*[+-]?\d+\s*$/D', $seit)) {
        fehler('BAD_REQUEST', 400);
    }
    $seit = (int) $seit;
    $sql = 'SELECT region, daten FROM futter_beitraege WHERE (jahr >= ? OR ? = 0)';
    $par = [$seit, $seit];
    if ($typ !== 'alle') {
        $sql .= ' AND typ = ?';
        $par[] = $typ;
    }
    $alle = [];
    foreach (q($sql, $par)->fetchAll() as $r) {
        $alle[] = [$r['region'], dekodiere_daten($r['daten'])];
    }
    $regionen = [];
    foreach ($alle as [$reg, $d]) {
        $regionen[$reg][] = $d;
    }
    $hat_hoehe = fn ($d) => isset($d['hoehe']);
    $zonen = [];
    foreach (ZONEN as [$zid, $name, $lo, $hi]) {
        $zd = [];
        foreach ($alle as [, $d]) {
            if ($hat_hoehe($d) && $d['hoehe'] >= $lo && $d['hoehe'] < $hi) {
                $zd[] = $d;
            }
        }
        $zonen[] = kennwerte($zd) + ['id' => $zid, 'name' => $name, 'von' => $lo, 'bis' => $hi];
    }
    $profil = [];
    for ($lo = 0; $lo < 2600; $lo += 200) {
        $nel = [];
        $irgendwas = false;
        foreach ($alle as [, $d]) {
            if ($hat_hoehe($d) && $d['hoehe'] >= $lo && $d['hoehe'] < $lo + 200) {
                $irgendwas = true;
                if (isset($d['werte']['nel'])) {
                    $nel[] = $d['werte']['nel'];
                }
            }
        }
        if ($nel || $irgendwas) {
            $profil[] = ['von' => $lo, 'n' => count($nel), 'nel' => count($nel) >= K_MIN ? py_round(median($nel), 2) : null];
        }
    }
    $reg_out = new stdClass();
    foreach ($regionen as $k => $v) {
        $reg_out->{(string) $k} = kennwerte($v);
    }
    $ohne = count(array_filter($alle, fn ($x) => !$hat_hoehe($x[1])));
    json_ende(['n' => count($alle), 'kMin' => K_MIN, 'gesamt' => kennwerte(array_column($alle, 1)), 'regionen' => $reg_out,
        'zonen' => $zonen, 'profil' => $profil, 'ohneHoehe' => $ohne]);
}

function r_statistik_config(): void
{
    json_ende(['consentVersion' => BEITRAG_CONSENT_VERSION, 'kMin' => K_MIN]);
}

function r_admin_statistik_csv(): void
{
    if (!admin_ok()) {
        fehler('NOT_FOUND', 404);
    }
    $spalten = array_merge(['typ', 'plz', 'hoehe', 'jahr', 'monat', 'aufwuchs', 'bestand', 'stadium', 'klasse', 'punkte', 'quelle', 'n'],
        array_map(fn ($k) => 'schaetzung_' . $k, WERTE), array_map(fn ($k) => 'labor_' . $k, LABOR), ['antworten', 'rad']);
    $fh = fopen('php://temp', 'w+');
    fputcsv($fh, $spalten, ';', '"', '');
    foreach (q('SELECT daten FROM futter_beitraege ORDER BY created_at')->fetchAll(PDO::FETCH_COLUMN) as $j) {
        $d = json_decode($j, false);
        $z = [];
        foreach (array_slice($spalten, 0, 12) as $k) {
            $z[] = csv_wert(feld($d, $k, ''));
        }
        foreach (WERTE as $k) {
            $z[] = csv_wert(feld(feld($d, 'werte', new stdClass()), $k, ''));
        }
        foreach (LABOR as $k) {
            $z[] = csv_wert(feld(feld($d, 'labor', new stdClass()), $k, ''));
        }
        $z[] = py_json(feld($d, 'antworten', new stdClass()));
        $z[] = py_json(feld($d, 'rad', new stdClass()));
        fputcsv($fh, $z, ';', '"', '');
    }
    rewind($fh);
    $csv = "\u{FEFF}" . stream_get_contents($fh);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="futter_beitraege.csv"');
    header('Cache-Control: no-store');
    echo $csv;
    exit;
}

function csv_wert($v): string
{
    if ($v === true) {
        return 'True';
    }
    if ($v === false) {
        return 'False';
    }
    if (is_float($v)) {
        return json_encode($v, JSON_PRESERVE_ZERO_FRACTION); // kürzeste exakte Darstellung wie Python repr (5.0, 5.8999999999999995)
    }
    return (string) $v;
}
