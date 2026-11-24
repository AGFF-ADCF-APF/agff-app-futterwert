"""Browser-Test der Umzugsseite (Plan Abschnitt 4): alte Adresse (Flask, Port 5099, V2_UMZUG_ZIEL) → neue (PHP, 5097, UMZUG_QUELLE).

Aufruf über allinkl/test/umzug_browser.sh (startet die Container und Playwright). Prüft:
  1. Alte Adresse ohne Daten → sofortige Weiterleitung, Pfad-Rest und #… bleiben.
  2. Mit Daten → Hinweis, «Daten mitnehmen» öffnet /futter/umzug, Übergabe per postMessage, Bestätigung, Probe + Foto +
     übrige Einstellung kommen an, alte Seite merkt sich den Umzug und leitet danach weiter.
"""
import sys

from playwright.sync_api import sync_playwright

ALT = 'http://127.0.0.1:5099/v2/'
NEU = 'http://127.0.0.1:5097/futter/'
fehler = []


def pruefe(bedingung, text):
    print(('ok    ' if bedingung else 'FEHLER') + '  ' + text)
    if not bedingung:
        fehler.append(text)


with sync_playwright() as p:
    b = p.chromium.launch()

    # 1. ohne Daten: weiterleiten
    ctx = b.new_context()
    s = ctx.new_page()
    s.goto(ALT + '#/kurs/abc123')
    s.wait_for_url(NEU + '**', timeout=15000)
    pruefe(s.url == NEU + '#/kurs/abc123', f'ohne Daten weitergeleitet: {s.url}')
    ctx.close()

    # 2. mit Daten: mitnehmen
    ctx = b.new_context()
    # Daten vor dem ersten Laden (sonst leitet die alte Adresse sofort weiter)
    ctx.add_init_script("if (location.port === '5099' && !localStorage.getItem('agffV2Laborberichte')) localStorage.setItem('agffV2Laborberichte', JSON.stringify([{ id: 'lb1', titel: 'Test' }]));")
    alt = ctx.new_page()
    alt.goto(ALT)
    alt.wait_for_function('window.__app && window.Fotos')
    pid, fid = alt.evaluate('''async () => {
        const A = window.__app; const pr = A.neueProbe('heu', null, {}); pr.kopf.bez = 'Umzugsprobe';
        const id = window.Fotos.neueId();
        const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 20, 20);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
        await window.Fotos.ablegen(id, pr.id, blob);
        pr.fotos = [{ id, art: 'futter', w: 40, h: 30, bytes: blob.size, mime: blob.type, createdAt: new Date().toISOString() }];
        A.touchProbe(pr); A.save();
        await new Promise((r) => setTimeout(r, 400));
        return [pr.id, id];
    }''')
    alt.reload()
    alt.wait_for_selector('#umzLos', timeout=15000)
    pruefe(True, 'Hinweis «Die App ist umgezogen» erscheint')
    with ctx.expect_page() as neu_info:
        alt.click('#umzLos')
    neu = neu_info.value
    neu.wait_for_selector('#umzJa', timeout=20000)
    pruefe('1 Proben' in neu.inner_text('#sheet-root'), 'Neue Adresse zeigt «1 Proben» zur Bestätigung')
    neu.click('#umzJa')
    neu.wait_for_selector('#umzWeiter', timeout=20000)
    da = neu.evaluate('''async (a) => {
        const db = JSON.parse(localStorage.getItem('agffV2') || '{}');
        const probe = (db.proben || []).find((x) => x.id === a[0]);
        const foto = await window.Fotos.blob(a[1]);
        return { probe: !!probe, bez: probe && probe.kopf.bez, foto: !!foto, labor: localStorage.getItem('agffV2Laborberichte') };
    }''', [pid, fid])
    pruefe(da['probe'] and da['bez'] == 'Umzugsprobe', 'Probe auf der neuen Adresse')
    pruefe(da['foto'], 'Foto (IndexedDB) auf der neuen Adresse')
    pruefe(da['labor'] and 'lb1' in da['labor'], 'übrige Einstellung (Laborberichte) übernommen')
    alt.wait_for_selector('text=Umzug abgeschlossen', timeout=10000)
    pruefe(bool(alt.evaluate("localStorage.getItem('agffV2Umgezogen')")), 'alte Adresse merkt sich den Umzug')
    alt.goto('about:blank')
    alt.goto(ALT + '#/liste')
    alt.wait_for_url(NEU + '**', timeout=15000)
    pruefe(alt.url == NEU + '#/liste', f'danach Weiterleitung trotz Daten: {alt.url}')
    b.close()

print(f'{len(fehler)} Fehler')
sys.exit(1 if fehler else 0)
