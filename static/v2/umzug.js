/* Futter v2 – Umzug der Browserdaten an die neue Adresse (Plan PORTIERUNG-ALL-INKL.md, Abschnitt 4).
 *
 * Derselbe Code läuft auf beiden Seiten; api/umzug sagt, welche Rolle diese Installation hat:
 *   alte Adresse (Flask, apps.graswachstum.ch)  → {ziel: 'https://app.graswachstum.ch'}
 *   neue Adresse (PHP, app.graswachstum.ch)     → {quelle: 'https://apps.graswachstum.ch'}
 * Alte Adresse: ohne Daten in diesem Browser oder nach erfolgreichem Umzug sofort weiterleiten (Pfad und #… bleiben,
 * Kurs-, Freigabe- und QR-Links gelten weiter); sonst Hinweis «Meine Daten mitnehmen». Die alte Seite öffnet dann
 * <ziel>/futter/umzug und übergibt die Sicherung (Proben, Anlässe, Wiese, Fotos, übrige Einstellungen) per postMessage –
 * nur an den festen Ursprung, nur an dieses Fenster. Nichts geht über einen Server.
 * Neue Adresse: nimmt nur vom festen Ursprung und nur von window.opener an, mit Bestätigung; bei gleicher Kennung
 * gewinnt die neuere Fassung (wie «Sicherung wiederherstellen»).
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const FLAG = 'agffV2Umgezogen';
  // In der Sicherung schon enthalten (db, Wiese) oder nicht mitnehmen (Cache, Merker selbst)
  const OHNE = new Set(['agffV2', 'agffV2Basis', 'agffV2Fotopunkte', 'agffV2Referenzen', 'agffV2Aufnahmen', FLAG]);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  };

  function konfig() {
    return fetch('api/umzug', { cache: 'no-store', credentials: 'omit' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  }
  const ursprungOk = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+$|^http:\/\/127\.0\.0\.1:\d+$/.test(u);

  // ---------------- alte Adresse ----------------
  /** /futter/v2/… → /futter/…, /wiese/… → /wiese/… (Rest des Pfads, Suche und #… bleiben) */
  function zielAdresse(ziel) {
    const p = location.pathname;
    const m = /\/wiese\/(.*)$/.exec(p) || null;
    const rest = m ? m[1] : ((/\/v2\/(.*)$/.exec(p) || [])[1] || '');
    return ziel + (m ? '/wiese/' : '/futter/') + rest + location.search + location.hash;
  }
  function hatDaten() {
    const A = app(); const db = A && A.db;
    if (db && (db.proben.length || db.anlaesse.length)) return true;
    return ['agffV2Fotopunkte', 'agffV2Referenzen', 'agffV2Aufnahmen', 'agffV2Laborberichte', 'agffV2Konto']
      .some((k) => { const v = ls.get(k); return v && v !== '[]' && v !== '{}' && v !== 'null'; });
  }
  function weiterleiten(ziel) { location.replace(zielAdresse(ziel)); }

  async function paket() {
    const A = app();
    const s = await A.sicherungErstellen();
    s.ls = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('agffV2') && !OHNE.has(k)) s.ls[k] = localStorage.getItem(k);
      }
    } catch (e) { /* privat */ }
    return s;
  }

  function hinweis(ziel) {
    const A = app(); const esc = A.esc; const host = ziel.replace(/^https?:\/\//, '');
    const band = document.createElement('div'); band.className = 'update-banner umzug-banner';
    band.innerHTML = '<span>Die App ist umgezogen: <b>' + esc(host) + '</b></span><button class="btn sm primary" type="button">Daten mitnehmen</button>';
    band.querySelector('button').addEventListener('click', () => dialog(ziel));
    document.body.appendChild(band);
    dialog(ziel);
  }
  function dialog(ziel) {
    const A = app(); const esc = A.esc; const host = ziel.replace(/^https?:\/\//, '');
    A.sheet('<h2>Die App ist umgezogen</h2><p>Die Futterbeurteilung läuft neu unter <b>' + esc(host) + '</b>. Ihre Proben, Anlässe, Fotos und Einstellungen liegen in diesem Browser und ziehen nicht von selbst mit.</p>' +
      '<p class="small">«Daten mitnehmen» öffnet die neue Adresse und übergibt die Daten direkt von Browser zu Browser – nichts geht über einen Server. Hier bleiben sie erhalten.</p>' +
      '<p class="hint" id="umzMsg"></p><div class="row"><button class="btn ghost grow" data-close>Später</button><button class="btn primary grow" id="umzLos">Daten mitnehmen</button></div>' +
      '<p class="small muted" style="margin-top:10px">Installierte App? Nach dem Umzug die neue Adresse öffnen und dort neu installieren. Rückfall: «Daten» › «Sicherung» herunterladen und auf der neuen Adresse importieren.</p>', (el) => {
      el.querySelector('#umzLos').onclick = () => mitnehmen(ziel, el.querySelector('#umzMsg'), el.querySelector('#umzLos'));
    });
  }
  function mitnehmen(ziel, msg, btn) {
    const A = app();
    const w = global.open(ziel + '/futter/umzug#/umzug', 'agff-umzug');
    if (!w) { msg.textContent = 'Das Fenster wurde blockiert – bitte Pop-ups für diese Seite erlauben.'; return; }
    btn.disabled = true; msg.textContent = 'Neue Adresse wird geöffnet …';
    let gesendet = false;
    const zuhoeren = async (e) => {
      if (e.origin !== ziel || e.source !== w || !e.data || typeof e.data !== 'object') return;
      if (e.data.typ === 'umzug-bereit' && !gesendet) {
        gesendet = true; msg.textContent = 'Daten werden übergeben …';
        try { w.postMessage({ typ: 'umzug-daten', daten: await paket() }, ziel); } catch (er) { msg.textContent = 'Übergabe fehlgeschlagen: ' + er.message; btn.disabled = false; gesendet = false; }
      } else if (e.data.typ === 'umzug-fertig') {
        global.removeEventListener('message', zuhoeren);
        ls.set(FLAG, new Date().toISOString());
        const n = e.data.anzahl || {};
        A.sheet('<h2>Umzug abgeschlossen</h2><p>' + (Number(n.proben) || 0) + ' Proben, ' + (Number(n.anlaesse) || 0) + ' Anlässe und ' + (Number(n.fotos) || 0) + ' Fotos sind auf der neuen Adresse.</p>' +
          '<p class="small">Diese Adresse leitet ab jetzt weiter. Die Daten bleiben hier zur Sicherheit erhalten.</p><div class="row"><a class="btn primary grow" href="' + A.esc(zielAdresse(ziel)) + '">Zur neuen Adresse</a></div>');
      } else if (e.data.typ === 'umzug-abgebrochen') {
        global.removeEventListener('message', zuhoeren);
        msg.textContent = 'Auf der neuen Adresse abgebrochen.'; btn.disabled = false;
      }
    };
    global.addEventListener('message', zuhoeren);
  }

  // ---------------- neue Adresse ----------------
  function annehmen(quelle) {
    const A = app(); const esc = A.esc;
    const opener = global.opener;
    if (!opener) { A.toast('Bitte den Umzug auf der alten Adresse mit «Daten mitnehmen» starten.'); return; }
    A.sheet('<h2>Daten übernehmen</h2><p class="small" id="umzMsg">Warte auf die Daten der alten Adresse …</p><div class="la-laden"></div>');
    let erhalten = false;
    const klopfen = setInterval(() => { try { opener.postMessage({ typ: 'umzug-bereit' }, quelle); } catch (e) { /* zu */ } }, 500);
    setTimeout(() => { if (!erhalten) { clearInterval(klopfen); const m = document.getElementById('umzMsg'); if (m) m.textContent = 'Keine Daten erhalten. Bitte das Fenster schliessen und auf der alten Adresse erneut «Daten mitnehmen» wählen.'; } }, 20000);
    global.addEventListener('message', function zuhoeren(e) {
      if (e.origin !== quelle || e.source !== opener || !e.data || e.data.typ !== 'umzug-daten' || erhalten) return;
      const d = e.data.daten;
      if (!d || d.f !== 'agff-futter-backup' || !d.db) return;
      erhalten = true; clearInterval(klopfen); global.removeEventListener('message', zuhoeren);
      const np = (d.db.proben || []).length; const na = (d.db.anlaesse || []).length; const nf = (d.fotos || []).length;
      const db = A.db; const da = db.proben.length + db.anlaesse.length;
      A.sheet('<h2>Daten übernehmen?</h2><p><b>' + np + ' Proben</b>, <b>' + na + ' Anlässe</b> und <b>' + nf + ' Fotos</b> von ' + esc(quelle.replace(/^https?:\/\//, '')) + '.</p>' +
        (da ? '<p class="small">Auf dieser Adresse sind schon ' + da + ' Einträge. Bei gleicher Kennung gewinnt die neuere Fassung, nichts wird gelöscht.</p>' : '') +
        '<p class="small muted">Die Daten werden nur in diesem Browser gespeichert. Enthält die Schlüssel Ihrer Freigabe-Links.</p>' +
        '<div class="row"><button class="btn ghost grow" id="umzNein">Abbrechen</button><button class="btn primary grow" id="umzJa">Übernehmen</button></div>', (el) => {
        el.querySelector('#umzNein').onclick = () => { try { opener.postMessage({ typ: 'umzug-abgebrochen' }, quelle); } catch (er) { /* zu */ } A.closeSheet(); A.go('#/'); };
        el.querySelector('#umzJa').onclick = async (ev) => {
          ev.target.disabled = true;
          try {
            const anzahl = await A.sicherungEinspielen(d, true);
            // Übrige Einstellungen (Konto-Anmeldung, Laborberichte, Bilanz …) nur, wo hier noch nichts steht
            Object.entries(d.ls && typeof d.ls === 'object' ? d.ls : {}).forEach(([k, v]) => {
              if (/^agffV2[A-Za-z]{0,30}$/.test(k) && !OHNE.has(k) && typeof v === 'string' && v.length < 2000000 && ls.get(k) === null) ls.set(k, v);
            });
            try { opener.postMessage({ typ: 'umzug-fertig', anzahl }, quelle); } catch (er) { /* zu */ }
            A.closeSheet();
            A.sheet('<h2>Umzug abgeschlossen</h2><p>' + anzahl.proben + ' Proben, ' + anzahl.anlaesse + ' Anlässe und ' + anzahl.fotos + ' Fotos übernommen.</p><p class="small">Bitte diese Adresse als Lesezeichen speichern bzw. die App von hier neu installieren.</p><div class="row"><button class="btn primary grow" id="umzWeiter">Zur App</button></div>', (el2) => {
              el2.querySelector('#umzWeiter').onclick = () => { location.replace('./#/'); };
            });
          } catch (er) { A.toast('Übernahme fehlgeschlagen: ' + er.message, { fehler: true }); ev.target.disabled = false; }
        };
      });
    });
  }

  konfig().then((k) => {
    if (ursprungOk(k.ziel)) {
      if (ls.get(FLAG) || !hatDaten()) { weiterleiten(k.ziel); return; }
      hinweis(k.ziel);
    } else if (ursprungOk(k.quelle) && /\/umzug$/.test(location.pathname) && location.hash.startsWith('#/umzug')) {
      annehmen(k.quelle);
    }
  });

  global.Umzug = { _t: { zielAdresse } };
})(window);
