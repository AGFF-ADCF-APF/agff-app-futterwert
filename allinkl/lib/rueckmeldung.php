<?php
/**
 * Rückmeldung zur Beta – portiert aus v2_rueckmeldung.py. Anonym: Daumen, Text (verschlüsselt), App, Build, Datum.
 */
declare(strict_types=1);

const RM_AAD = 'agff-rueckmeldung';

function rm_aufraeumen(): void
{
    q('DELETE FROM rueckmeldungen WHERE datum < ?', [gmdate('Y-m-d', time() - retention_days() * 86400)]);
}

function r_rueckmeldung(): void
{
    rate_hit('rueckmeldung', 10, 3600);
    $b = json_body();
    if (!ist_objekt($b)) {
        fehler('BAD_REQUEST', 400);
    }
    $daumen = feld($b, 'daumen');
    $app = in_array(feld($b, 'app'), ['futter', 'wiese'], true) ? $b->app : 'futter';
    $text = feld($b, 'text');
    $text = wahr($text) ? $text : '';
    $build = feld($b, 'build');
    $build = is_string($build) && preg_match('/^[A-Za-z0-9.-]{1,16}$/D', $build) ? $build : null;
    if (!in_array($daumen, ['hoch', 'runter'], true) || !is_string($text) || mb_strlen($text) > 2000) {
        fehler('BAD_REQUEST', 400);
    }
    $text = trim($text);
    rm_aufraeumen();
    q('INSERT INTO rueckmeldungen (id, datum, app, daumen, text_enc, build) VALUES (?, ?, ?, ?, ?, ?)',
        [zufall_id(9), gmdate('Y-m-d'), $app, $daumen, $text !== '' ? text_enc($text, RM_AAD) : null, $build]);
    json_ende(['ok' => true]);
}

function r_admin_rueckmeldungen(): void
{
    if (!admin_ok()) {
        fehler('NOT_FOUND', 404);
    }
    rm_aufraeumen();
    $out = [];
    foreach (q('SELECT * FROM rueckmeldungen ORDER BY datum DESC, nr DESC LIMIT 1000')->fetchAll() as $r) {
        $out[] = ['id' => $r['id'], 'datum' => $r['datum'], 'app' => $r['app'], 'daumen' => $r['daumen'], 'build' => $r['build'],
            'text' => $r['text_enc'] ? text_dec($r['text_enc'], RM_AAD) : null];
    }
    json_ende(['eintraege' => $out]);
}

function r_admin_rueckmeldung_loeschen(string $rid): void
{
    if (!admin_ok()) {
        fehler('NOT_FOUND', 404);
    }
    q('DELETE FROM rueckmeldungen WHERE id = ?', [$rid]);
    json_ende(['ok' => true]);
}
