"""Prüfstand für den Datenumzug (allinkl/skripte/umzug.sh --lokal|--dev).

    docker exec -i futter-port-ref python3 -I - fuellen < allinkl/test/umzug_testdaten.py > tokens.json   (im Flask-Container)
    python3 -I allinkl/test/umzug_testdaten.py vergleichen tokens.json [FLASK_URL] [PHP_URL]               (auf dem Host)

«fuellen» schreibt erfundene Daten in ALLE übernommenen Tabellen der Flask-Referenz (mit dem Test-Schlüssel des
Prüfstands, über die Funktionen der App) samt Fotos und gibt die Zugangs-Tokens als JSON aus. Nach dem Umzug stellt
«vergleichen» dieselben Anfragen an Flask (alter Schlüssel) und PHP (neuer Schlüssel) und vergleicht die Antworten:
Konto (Adresse, Foto-Limit aus foto_quota, Antrag), Konto-Daten und -Foto, Kurs (Adressen, Proben, Link), Pool
(eigen = creator_hmac neu berechnet, Daten neu verschlüsselt), Gruppen-Beitritt per Code (beitritt_hmac), Freigabe mit Foto.
Keine echten Daten.
"""
import json
import sys


def fuellen():
    import base64
    import os
    import secrets
    import sqlite3
    sys.path.insert(0, '/app')
    os.chdir('/work')
    import app  # noqa: F401 – legt alle Tabellen an
    import v2_mail as M
    from v2_api import _sha, _code_hmac, V2_DB_PATH, FOTO_DIR, CONSENT_VERSION

    jetzt = '2026-11-20T10:00:00+00:00'
    tok = lambda: secrets.token_urlsafe(32)[:43]  # noqa: E731
    fid = lambda: secrets.token_urlsafe(12)[:16]  # noqa: E731
    jpeg = lambda n: b'\xff\xd8\xff\xe0' + secrets.token_bytes(n) + b'\xff\xd9'  # noqa: E731
    out = {}
    c = sqlite3.connect(V2_DB_PATH)
    c.execute('PRAGMA foreign_keys = ON')

    def foto(rel, inhalt):
        p = os.path.join(FOTO_DIR, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(inhalt)

    # Konto mit Sitzung, Daten, Foto, Zusatz-Speicher und offenem Antrag
    em = 'anna.umzug@example.org'
    kid, kt = 'konto' + secrets.token_hex(4), tok()
    c.execute('INSERT INTO konten (id, email_hmac, email_enc, cloud_futter, cloud_wiese, consent_version, consent_at, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?,?)',
              (kid, M.email_hmac(em), M.email_enc(em), 1, 0, 'k1', jetzt, jetzt, jetzt))
    c.execute('INSERT INTO konto_sessions (id, konto_id, token_hash, via, geraet, created_at, last_used, expires_at) VALUES (?,?,?,?,?,?,?,?)',
              ('s' + secrets.token_hex(5), kid, _sha('konto|' + kt), 'code', 'Testgerät', jetzt, jetzt, 4102444800))
    c.execute('INSERT INTO konto_links (id, email_hmac, email_enc, secret_hash, created_at, expires_at, used_at, revoked) VALUES (?,?,?,?,?,?,?,?)',
              ('l' + secrets.token_hex(5), M.email_hmac(em), M.email_enc(em), _sha('link|x'), jetzt, 4102444800, None, 0))
    daten = json.dumps({'id': 'probe1', 'typ': 'heu', 'notiz': 'Test ä'})
    c.execute('INSERT INTO konto_daten (konto_id, app, id, data, bytes, client_updated_at, updated_at) VALUES (?,?,?,?,?,?,?)',
              (kid, 'futter', 'probe1', daten, len(daten), jetzt, jetzt))
    kf = fid()
    bild = jpeg(3000)
    c.execute('INSERT INTO konto_fotos (konto_id, id, app, bytes, created_at) VALUES (?,?,?,?,?)', (kid, kf, 'futter', len(bild), jetzt))
    foto(f'konto_{kid}/{kf}.bin', bild)
    c.execute('INSERT INTO foto_quota (email_hmac, mb, decided_at) VALUES (?,?,?)', (M.email_hmac(em), 250, jetzt))
    c.execute("INSERT INTO quota_antraege (id, email_hmac, email_enc, bereich, wunsch_mb, text_enc, status, created_at) VALUES (?,?,?,?,?,?,'offen',?)",
              ('a' + secrets.token_hex(5), M.email_hmac(em), M.email_enc(em), 'konto', 500, M.text_enc('Bitte mehr Platz – ü', b'quota'), jetzt))
    out['konto'] = {'token': kt, 'foto': kf}

    # Kursleitung, Kurs mit Leitung und Teilnehmerin, Probe, Beurteilung, Foto, Link
    el, et = 'leitung.umzug@example.org', 'tn.umzug@example.org'
    c.execute("INSERT INTO kursleitende (email_hmac, email_enc, name_enc, org_enc, text_enc, status, via, created_at, decided_at) VALUES (?,?,?,?,?,'frei','antrag',?,?)",
              (M.email_hmac(el), M.email_enc(el), M.text_enc('Lea Leitung', b'kl'), M.text_enc('Schule X', b'kl'), M.text_enc('Kurs im Mai', b'kl'), jetzt, jetzt))
    kurs = 'kurs' + secrets.token_hex(4)
    c.execute("INSERT INTO kurse (id, join_hash, status, meta_analyse, meta_privat, consent_version, naechste_nr, created_at, updated_at, link_enc) VALUES (?,?,'aktiv',?,?,?,?,?,?,?)",
              (kurs, _sha(tok()), json.dumps({'titel': 'Umzugskurs'}), json.dumps({'ort': 'Zollikofen'}), 'kurs-1', 2, jetzt, jetzt, M.text_enc(tok(), b'kurs-link')))
    pl, pt = 'p' + secrets.token_hex(5), 'p' + secrets.token_hex(5)
    for pid, em_, rolle, name in ((pl, el, 'leitung', None), (pt, et, 'teilnehmer', json.dumps({'n': 'Tina'}))):
        c.execute('INSERT INTO kurs_teilnehmende (id, kurs_id, email_hmac, email_enc, name_privat, rolle, consent_version, consent_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
                  (pid, kurs, M.email_hmac(em_), M.email_enc(em_), name, rolle, 'kurs-1', jetzt, jetzt))
    ohne = 'p' + secrets.token_hex(5)  # Person ohne Adresse
    c.execute("INSERT INTO kurs_teilnehmende (id, kurs_id, email_hmac, email_enc, name_privat, rolle, consent_version, consent_at, created_at) VALUES (?,?,NULL,NULL,NULL,'teilnehmer',?,?,?)",
              (ohne, kurs, 'kurs-1', jetzt, '2026-11-20T10:00:01+00:00'))
    lt, tt = tok(), tok()
    for t_, pid in ((lt, pl), (tt, pt)):
        c.execute('INSERT INTO kurs_sessions (token_hash, teilnehmer_id, kurs_id, expires_at) VALUES (?,?,?,?)', (_sha(t_), pid, kurs, 4102444800))
    probe = 'probe' + secrets.token_hex(3)
    c.execute("INSERT INTO kurs_proben (kurs_id, id, nr, sort, status, owner_id, analyse, privat, labor, updated_at, pool_id) VALUES (?,?,1,0,'erfasst',?,?,?,?,?,NULL)",
              (kurs, probe, pl, json.dumps({'typ': 'heu'}), json.dumps({'bez': 'Wiese A'}), json.dumps({'nel': 5.6}), jetzt))
    c.execute('INSERT INTO kurs_beurteilungen (kurs_id, probe_id, teilnehmer_id, analyse, privat, abgegeben_at) VALUES (?,?,?,?,?,?)',
              (kurs, probe, pt, json.dumps({'typ': 'heu', 'antworten': {'a': 1}}), None, jetzt))
    kfo = fid()
    bild = jpeg(2000)
    c.execute("INSERT INTO kurs_fotos (kurs_id, id, teilnehmer_id, probe_id, art, bytes, created_at, zweck) VALUES (?,?,?,?,'jpeg',?,?,'probe')",
              (kurs, kfo, pt, probe, len(bild), jetzt))
    foto(f'k_{kurs}/{kfo}.bin', bild)
    c.execute("INSERT INTO kurse (id, join_hash, status, pending_email_hmac, pending_einladung, consent_version, created_at, updated_at) VALUES (?,?,'pending',?,NULL,'kurs-1',?,?)",
              ('kurs' + secrets.token_hex(4), _sha(tok()), M.email_hmac('niemand@example.org'), jetzt, jetzt))  # Adresse nirgends sonst → ohne Zuordnung
    out['kurs'] = {'id': kurs, 'leitung': lt, 'tn': tt, 'foto': kfo}

    # Pool-Eintrag der Leitung mit Foto
    pool = 'pool' + secrets.token_hex(4)
    pd = {'typ': 'heu', 'bez': 'Musterheu', 'sammlung': 'Umzug', 'fotos': []}
    pfo = fid()
    bild = jpeg(1500)
    pd['fotos'].append({'id': pfo})
    c.execute('INSERT INTO pool_proben (id, creator_hmac, typ, daten_enc, created_at, sammlung, oeffentlich, quelle_kurs, quelle_probe) VALUES (?,?,?,?,?,?,?,?,?)',
              (pool, M.email_hmac(el), 'heu', M.text_enc(json.dumps(pd, ensure_ascii=False), b'pool'), jetzt, 'Umzug', 1, kurs, probe))
    c.execute('INSERT INTO pool_fotos (pool_id, id, bytes) VALUES (?,?,?)', (pool, pfo, len(bild)))
    foto(f'pool/{pool}/{pfo}.bin', bild)
    out['pool'] = {'id': pool, 'foto': pfo}

    # Freigabe (Gruppe) mit Eintrag, Foto und Beitrittscode
    sp, rt, wt = 'space' + secrets.token_hex(4), tok(), tok()
    code = 'ABCD2345'
    c.execute('INSERT INTO e2e_spaces (id, read_hash, write_hash, epoch, consent_version, consent_at, created_at, updated_at, owner_email_hmac, owner_email_enc, beitritt_hmac, beitritt_enc) '
              'VALUES (?,?,?,1,?,?,?,?,?,?,?,?)',
              (sp, _sha(rt), _sha(wt), CONSENT_VERSION, '2026-11-24T08:00:00+00:00', '2026-11-24T08:00:00+00:00', '2026-11-24T08:00:00+00:00', M.email_hmac(em), M.email_enc(em),
               _code_hmac(code), M.text_enc(json.dumps({'code': code, 'secret': wt}), b'gruppe-beitritt')))
    c.execute('INSERT INTO e2e_records (space_id, id, analyse, privat, client_updated_at, updated_at) VALUES (?,?,?,?,?,?)',
              (sp, 'rec1', json.dumps({'id': 'rec1', 'typ': 'heu'}), json.dumps({'ct': base64.b64encode(b'x').decode()}), jetzt, jetzt))
    sfo = fid()
    bild = jpeg(1000)
    c.execute('INSERT INTO e2e_fotos (space_id, id, bytes, created_at) VALUES (?,?,?,?)', (sp, sfo, len(bild), jetzt))
    foto(f'{sp}/{sfo}.bin', bild)
    out['space'] = {'id': sp, 'read': rt, 'code': code, 'foto': sfo}

    c.execute("INSERT INTO rueckmeldungen (id, datum, app, daumen, text_enc, build) VALUES (?,?,?,?,?,?)",
              ('r' + secrets.token_hex(5), '2026-11-21', 'futter', 'hoch', M.text_enc('Umzug klappt – «gut»', b'agff-rueckmeldung'), 'b1-94'))
    c.commit()
    print(json.dumps(out))


def vergleichen(datei, flask='http://127.0.0.1:5098/v2/', php='http://127.0.0.1:5097/futter/'):
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from vertrag import anfrage, norm
    t = json.load(open(datei))
    k, ku, po, sp = t['konto'], t['kurs'], t['pool'], t['space']
    faelle = [
        ('konto', 'GET', 'api/konto', None, {'X-Konto': k['token']}),
        ('konto/daten', 'GET', 'api/konto/daten/futter', None, {'X-Konto': k['token']}),
        ('konto/foto', 'GET', 'api/konto/fotos/' + k['foto'], None, {'X-Konto': k['token']}),
        ('kurs (Leitung)', 'GET', 'api/kurse/' + ku['id'], None, {'X-Kurs-Session': ku['leitung']}),
        ('kurs (Teilnehmerin)', 'GET', 'api/kurse/' + ku['id'], None, {'X-Kurs-Session': ku['tn']}),
        ('pool', 'GET', 'api/pool', None, {'X-Kurs-Id': ku['id'], 'X-Kurs-Session': ku['leitung']}),
        ('pool/foto', 'GET', f"api/pool/{po['id']}/fotos/{po['foto']}", None, {'X-Kurs-Id': ku['id'], 'X-Kurs-Session': ku['leitung']}),
        ('freigabe', 'GET', 'api/spaces/' + sp['id'], None, {'X-Read-Token': sp['read']}),
        ('freigabe/foto', 'GET', f"api/spaces/{sp['id']}/fotos/{sp['foto']}", None, {'X-Read-Token': sp['read']}),
        ('gruppe beitreten', 'POST', 'api/gruppen/beitreten', {'code': sp['code']}, {}),
    ]
    gleich = 0
    for name, m, pfad, body, kopf in faelle:
        a, b = anfrage(flask, m, pfad, body, kopf), anfrage(php, m, pfad, body, kopf)
        ja = a.status == b.status == 200 and (norm(a.json) == norm(b.json) if a.json is not None else a.roh == b.roh)
        gleich += ja
        print(('gleich     ' if ja else 'VERSCHIEDEN') + f'  {name}  (Flask {a.status}, PHP {b.status})')
        if not ja and a.json is not None:
            print('   Flask:', json.dumps(norm(a.json), ensure_ascii=False)[:600])
            print('   PHP:  ', json.dumps(norm(b.json), ensure_ascii=False)[:600])
    print(f'{gleich}/{len(faelle)} gleich')
    sys.exit(0 if gleich == len(faelle) else 1)


if __name__ == '__main__':
    if sys.argv[1:2] == ['fuellen']:
        fuellen()
    elif sys.argv[1:2] == ['vergleichen']:
        vergleichen(*sys.argv[2:])
    else:
        sys.exit(__doc__)
