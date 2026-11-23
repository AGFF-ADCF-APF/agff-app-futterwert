<?php
/**
 * Probenpool für Kursleitende – portiert aus v2_pool.py.
 *
 * Kursleitende stellen ausgewählte Kursproben (Beschreibung, Region, Laborwerte, Fotos, anonyme Referenz-Beurteilungen)
 * in einen gemeinsamen Pool; andere Kursleitende übernehmen sie in eigene Kurse. Einträge mit dem Serverschlüssel
 * verschlüsselt, Zugriff nur mit Kursleitungs-Sitzung (Kopfzeilen X-Kurs-Id, X-Kurs-Session). Öffentliche Sammlungen
 * zeigen nur die extrahierten Werte, keine Fotos.
 */
declare(strict_types=1);

const MAX_POOL_EINTRAEGE = 2000;
const LABOR_KEYS = ['ts', 'nel', 'nev', 'apde', 'apdn', 'rp', 'rf', 'ra', 'ndf', 'adf', 'zucker', 'ph', 'milchsaeure', 'essigsaeure', 'buttersaeure'];
const SAMMLUNG_RE = '/^[A-Za-zÀ-ÿ0-9 ._\/()–-]{1,60}$/u';
const OEFFENTLICH_FELDER = ['typ', 'titel', 'beschreibung', 'quelle', 'schnitt', 'schnittNr', 'bestand', 'konservierung', 'hoehenstufe', 'region', 'labor', 'sammlung'];

function pool_dir(string $pool_id): string
{
    return foto_dir() . '/pool/' . $pool_id;
}

/** Kursleitungs-Sitzung aus beliebigem Kurs. Liefert den E-Mail-HMAC oder null. */
function pool_leitung(): ?string
{
    $kurs_id = kopfzeile('X-Kurs-Id');
    $tok = kopfzeile('X-Kurs-Session');
    if (!preg_match(ID_RE, $kurs_id) || !preg_match(TOKEN_RE, $tok)) {
        return null;
    }
    $eh = wert("SELECT t.email_hmac FROM kurs_sessions s JOIN kurs_teilnehmende t ON t.id = s.teilnehmer_id "
        . "WHERE s.token_hash = ? AND s.kurs_id = ? AND s.expires_at > ? AND t.rolle = 'leitung'", [sha($tok), $kurs_id, microtime(true)]);
    if (!$eh) {
        rate_hit('auth_fail', 60, 600);
        return null;
    }
    return (string) $eh;
}

/** isinstance(v, (int, float)) and not bool and lo <= v <= hi */
function pool_num($v, float $lo, float $hi): bool
{
    return (is_int($v) || is_float($v)) && $v >= $lo && $v <= $hi;
}

function pool_text($v, int $n): bool
{
    return $v === null || (is_string($v) && mb_strlen($v) <= $n);
}

/** Whitelist der Pool-Daten. Bereinigte Daten (stdClass) oder null. */
function pool_pruefen($d): ?stdClass
{
    if (!ist_objekt($d) || !in_array(feld($d, 'typ'), FUTTERARTEN, true)) {
        return null;
    }
    foreach (['titel' => 120, 'beschreibung' => 1000, 'quelle' => 200] as $k => $n) {
        if (!pool_text(feld($d, $k), $n)) {
            return null;
        }
    }
    $titel = py_strip(wahr(feld($d, 'titel')) ? $d->titel : '');
    $out = new stdClass();
    $out->typ = $d->typ;
    $out->titel = $titel !== '' ? $titel : 'Probe';
    $out->beschreibung = wahr(feld($d, 'beschreibung')) ? $d->beschreibung : '';
    $out->quelle = wahr(feld($d, 'quelle')) ? $d->quelle : '';
    // Zusatzangaben (z. B. aus dem Laborbericht): Schnitt-Nr., Bestand, Konservierung, Höhenstufe
    foreach (['schnittNr' => 30, 'bestand' => 80, 'konservierung' => 80, 'hoehenstufe' => 30] as $k => $n) {
        if (!pool_text(feld($d, $k), $n)) {
            return null;
        }
        if (wahr(feld($d, $k))) {
            $out->$k = py_strip($d->$k);
        }
    }
    if (feld($d, 'sammlung') !== null) {
        if (!is_string($d->sammlung) || !preg_match(SAMMLUNG_RE, py_strip($d->sammlung))) {
            return null;
        }
        $out->sammlung = py_strip($d->sammlung);
    }
    if (feld($d, 'oeffentlich') !== null) {
        if (!is_bool($d->oeffentlich)) {
            return null;
        }
        $out->oeffentlich = $d->oeffentlich;
    }
    if (wahr(feld($d, 'schnitt'))) {
        if (!preg_match(DATE_RE, py_str($d->schnitt))) {
            return null;
        }
        $out->schnitt = $d->schnitt;
    }
    $reg = feld($d, 'region');
    if (wahr($reg)) {
        if (!ist_objekt($reg) || array_diff(schluessel($reg), ['plz', 'ort', 'hoehe']) || !pool_text(feld($reg, 'ort'), 80) || !pool_text(feld($reg, 'hoehe'), 6)) {
            return null;
        }
        if (wahr(feld($reg, 'plz')) && !preg_match('/^[1-9]\d{3}$/', py_str($reg->plz))) { // PLZ bleibt für nationale Auswertungen
            return null;
        }
        $r = new stdClass();
        foreach (get_object_vars($reg) as $k => $v) {
            if (wahr($v)) {
                $r->$k = $v;
            }
        }
        $out->region = $r;
    }
    $lab = feld($d, 'labor');
    if (wahr($lab)) {
        if (!ist_objekt($lab) || array_diff(schluessel($lab), LABOR_KEYS)) {
            return null;
        }
        foreach (get_object_vars($lab) as $v) {
            if (!pool_num($v, 0, 2000)) {
                return null;
            }
        }
        $out->labor = $lab;
    }
    $fotos = feld($d, 'fotos');
    $fotos = wahr($fotos) ? $fotos : [];
    if (!ist_liste($fotos) || count($fotos) > 8) {
        return null;
    }
    $out->fotos = [];
    foreach ($fotos as $f) {
        $key = feld($f, 'key');
        if (!ist_objekt($f) || !preg_match(FOTO_ID_RE, py_str(feld($f, 'id', ''))) || !in_array(feld($f, 'art'), ['futter', 'labor'], true)
            || ($key !== null && !preg_match('/^[A-Za-z0-9_-]{43}$/', py_str($key))) || !in_array(feld($f, 'mime'), ['image/webp', 'image/jpeg'], true)) {
            return null;
        }
        $x = new stdClass();
        foreach (['id', 'art', 'key', 'mime', 'w', 'h', 'ger'] as $k) {
            if (property_exists($f, $k) && (!in_array($k, ['w', 'h'], true) || pool_num($f->$k, 1, 10000)) && ($k !== 'ger' || in_array($f->$k, ['auto', 'manuell'], true))) {
                $x->$k = $f->$k;
            }
        }
        $out->fotos[] = $x;
    }
    $refs = feld($d, 'referenzen');
    $refs = wahr($refs) ? $refs : [];
    if (!ist_liste($refs) || count($refs) > 20) {
        return null;
    }
    $out->referenzen = [];
    foreach ($refs as $r) {
        $an = ist_objekt($r) ? feld($r, 'analyse') : null;
        $id = feld($an, 'id', '');
        if (!wahr($an) || !ist_objekt($an) || !preg_match(ID_RE, py_str($id)) || !is_string($id) || !check_record($id, (object) ['analyse' => $an])
            || !pool_text(feld($r, 'label'), 40)) {
            return null;
        }
        $label = wahr(feld($r, 'label')) ? $r->label : 'Referenz';
        $out->referenzen[] = (object) ['label' => py_kurz(py_strip($label), 40), 'analyse' => $an];
    }
    return $out;
}

/** Entschlüsselter Pool-Eintrag (stdClass) oder null. */
function pool_eintrag(string $pool_id)
{
    $enc = wert('SELECT daten_enc FROM pool_proben WHERE id = ?', [$pool_id]);
    if ($enc === null) {
        return null;
    }
    $d = json_decode(text_dec($enc, 'pool') ?? 'null', false, 512, JSON_BIGINT_AS_STRING);
    return $d;
}

function pool_speichern(string $pool_id, string $creator_hmac, stdClass $d, ?string $quelle_kurs = null, ?string $quelle_probe = null): void
{
    q('INSERT INTO pool_proben (id, creator_hmac, typ, daten_enc, created_at, sammlung, oeffentlich, quelle_kurs, quelle_probe) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) '
        . 'ON DUPLICATE KEY UPDATE typ = VALUES(typ), daten_enc = VALUES(daten_enc), sammlung = VALUES(sammlung), oeffentlich = VALUES(oeffentlich), '
        . 'quelle_kurs = COALESCE(VALUES(quelle_kurs), quelle_kurs), quelle_probe = COALESCE(VALUES(quelle_probe), quelle_probe)',
        [$pool_id, $creator_hmac, $d->typ, text_enc(py_json($d, false), 'pool'), jetzt_iso(), feld($d, 'sammlung'), wahr(feld($d, 'oeffentlich')) ? 1 : 0, $quelle_kurs, $quelle_probe]);
}

function pool_loeschen_ganz(string $pool_id): void
{
    q('DELETE FROM pool_proben WHERE id = ?', [$pool_id]);
    if (preg_match(ID_RE, $pool_id)) {
        ordner_loeschen(pool_dir($pool_id));
    }
}

function pool_foto_senden(string $pool_id, string $foto_id): void
{
    bild_senden(pool_dir($pool_id) . '/' . $foto_id . '.bin');
}

function pool_oeffentlich_daten(stdClass $d): stdClass
{
    $out = new stdClass();
    foreach (OEFFENTLICH_FELDER as $k) {
        if (property_exists($d, $k)) {
            $out->$k = $d->$k;
        }
    }
    $out->fotos = []; // öffentlich nur die extrahierten Werte – keine Laborberichte, keine Fotos
    return $out;
}

// --- Pool lesen / anlegen / löschen --------------------------------------------------------------
function r_pool_liste(): void
{
    $ich = pool_leitung();
    if (!$ich) {
        fehler('NOT_FOUND', 404);
    }
    $out = [];
    foreach (q('SELECT id, creator_hmac, created_at FROM pool_proben ORDER BY created_at DESC')->fetchAll() as $r) {
        $d = pool_eintrag($r['id']);
        if (wahr($d)) {
            $out[] = ['id' => $r['id'], 'eigen' => $r['creator_hmac'] === $ich, 'createdAt' => $r['created_at'], 'daten' => $d];
        }
    }
    $sammlungen = q('SELECT DISTINCT sammlung FROM pool_proben WHERE sammlung IS NOT NULL ORDER BY sammlung')->fetchAll(PDO::FETCH_COLUMN);
    json_ende(['eintraege' => $out, 'sammlungen' => $sammlungen]);
}

function r_pool_speichern(string $pool_id): void
{
    $ich = pool_leitung();
    if (!$ich || !preg_match(ID_RE, $pool_id)) {
        fehler('NOT_FOUND', 404);
    }
    rate_hit('pool_put', 60, 3600);
    $body = body_obj();
    $d = pool_pruefen(feld($body, 'daten'));
    if ($d === null) {
        fehler('REJECTED_CONTENT', 422);
    }
    $qk = feld($body, 'quelleKurs');
    $qp = feld($body, 'quelleProbe');
    if (($qk !== null && !preg_match(ID_RE, py_str($qk))) || ($qp !== null && !preg_match(ID_RE, py_str($qp)))) {
        fehler('REJECTED_CONTENT', 422);
    }
    $alt = wert('SELECT creator_hmac FROM pool_proben WHERE id = ?', [$pool_id]);
    if ($alt !== null && $alt !== $ich) {
        fehler('NOT_FOUND', 404);
    }
    if ($alt === null && (int) wert('SELECT COUNT(*) FROM pool_proben') >= MAX_POOL_EINTRAEGE) {
        fehler('POOL_VOLL', 409);
    }
    pool_speichern($pool_id, $ich, $d, $qk === null ? null : py_str($qk), $qp === null ? null : py_str($qp));
    json_ende(['status' => 'ok']);
}

function r_pool_loeschen(string $pool_id): void
{
    $ich = pool_leitung();
    $r = wert('SELECT creator_hmac FROM pool_proben WHERE id = ?', [$pool_id]);
    if (!$ich || $r === null || $r !== $ich) {
        fehler('NOT_FOUND', 404);
    }
    pool_loeschen_ganz($pool_id);
    json_ende(['status' => 'deleted']);
}

// --- Öffentlich: Sammlungen ohne Anmeldung (z. B. «Ernte 2026») -------------------------------------
function r_pool_oeffentlich(): void
{
    rate_hit('pool_pub', 300, 600);
    $out = [];
    foreach (q('SELECT id, created_at FROM pool_proben WHERE oeffentlich = 1 ORDER BY sammlung, created_at')->fetchAll() as $r) {
        $d = pool_eintrag($r['id']);
        if (wahr($d) && ist_objekt($d)) {
            $x = pool_oeffentlich_daten($d);
            $x->id = $r['id'];
            $x->createdAt = $r['created_at'];
            $out[] = $x;
        }
    }
    json_ende(['eintraege' => $out]);
}

function r_pool_oeffentlich_foto(string $pool_id, string $foto_id): void
{
    rate_hit('pool_pub', 300, 600);
    if (!preg_match(ID_RE, $pool_id) || !preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('NOT_FOUND', 404);
    }
    // Öffentliche Einträge zeigen keine Fotos (pool_oeffentlich_daten): immer «nicht gefunden», wie in Flask
    fehler('NOT_FOUND', 404);
}

/** Etikett gescannt: ist diese Kursprobe ein Muster im Pool (Quelle eines Pool-Eintrags)? */
function r_kursprobe_oeffentlich(string $kurs_id, string $probe_id): void
{
    rate_hit('pool_pub', 300, 600);
    if (!preg_match(ID_RE, $kurs_id) || !preg_match(ID_RE, $probe_id)) {
        fehler('NOT_FOUND', 404);
    }
    $r = zeile('SELECT id, sammlung, oeffentlich FROM pool_proben WHERE quelle_kurs = ? AND quelle_probe = ? LIMIT 1', [$kurs_id, $probe_id]);
    json_ende(['pool' => $r ? ['id' => $r['id'], 'sammlung' => $r['sammlung'], 'oeffentlich' => (bool) $r['oeffentlich']] : null]);
}

// --- Fotos -----------------------------------------------------------------------------------------
function r_pool_foto_hochladen(string $pool_id, string $foto_id): void
{
    $ich = pool_leitung();
    if (!$ich || !preg_match(ID_RE, $pool_id) || !preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('NOT_FOUND', 404);
    }
    $daten = bild_body();
    if (strlen($daten) > MAX_FOTO_BYTES || strlen($daten) < 100 || !bild_typ(substr($daten, 0, 12))) {
        fehler('REJECTED_CONTENT', 422);
    }
    $r = wert('SELECT creator_hmac FROM pool_proben WHERE id = ?', [$pool_id]);
    $d = pool_eintrag($pool_id);
    $ids = [];
    foreach (($d instanceof stdClass && is_array(feld($d, 'fotos'))) ? $d->fotos : [] as $f) {
        $ids[] = feld($f, 'id');
    }
    if ($r === null || $r !== $ich || !wahr($d) || !in_array($foto_id, $ids, true)) {
        fehler('NOT_FOUND', 404);
    }
    if (!foto_platz_frei(strlen($daten))) {
        fehler('SERVER_VOLL', 507);
    }
    datei_ablegen(pool_dir($pool_id) . '/' . $foto_id . '.bin', $daten);
    q('INSERT INTO pool_fotos (pool_id, id, bytes) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE bytes = VALUES(bytes)', [$pool_id, $foto_id, strlen($daten)]);
    json_ende(['status' => 'ok']);
}

function r_pool_foto_lesen(string $pool_id, string $foto_id): void
{
    if (!pool_leitung() || !preg_match(ID_RE, $pool_id) || !preg_match(FOTO_ID_RE, $foto_id)) {
        fehler('NOT_FOUND', 404);
    }
    if (!wert('SELECT 1 FROM pool_fotos WHERE pool_id = ? AND id = ?', [$pool_id, $foto_id])) {
        fehler('NOT_FOUND', 404);
    }
    pool_foto_senden($pool_id, $foto_id);
}

// --- Admin: Pool-Einträge entfernen -----------------------------------------------------------------
function r_admin_pool(): void
{
    admin_oder_404();
    $out = [];
    foreach (q('SELECT id, created_at FROM pool_proben ORDER BY created_at DESC')->fetchAll() as $r) {
        $d = pool_eintrag($r['id']);
        $x = new stdClass();
        foreach ($d instanceof stdClass ? get_object_vars($d) : [] as $k => $v) {
            if (in_array($k, ['titel', 'typ', 'quelle', 'beschreibung'], true)) {
                $x->$k = $v;
            }
        }
        $out[] = ['id' => $r['id'], 'createdAt' => $r['created_at'], 'daten' => $x];
    }
    json_ende(['eintraege' => $out]);
}

function r_admin_pool_loeschen(string $pool_id): void
{
    admin_oder_404();
    pool_loeschen_ganz($pool_id);
    json_ende(['status' => 'deleted']);
}
