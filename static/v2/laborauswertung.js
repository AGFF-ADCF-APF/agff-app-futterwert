/* Futter v2 – «Laboranalyse auswerten» (Prototyp).
 * Prüfbericht als PDF oder Foto → Proben → Auswertung mit Ampeln, Verhältnissen und Ursachenketten (laborregeln.js).
 * Gespeichert wird nur lokal (Werte und Probenangaben, keine Kunden- oder Adressdaten).
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const esc = (s) => app().esc(s);
  const R = () => global.LaborRegeln;
  const KEY = 'agffV2Laborberichte';
  const MAX = 30;
  const lesen = () => { try { const z = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(z) ? z : []; } catch (e) { return []; } };
  const schreiben = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX))); } catch (e) { app().toast('Speichern im Browser nicht möglich.'); } };
  const zahl = (x, d) => (x == null ? '–' : Number(x).toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const TON = { gut: 'gut', mittel: 'mittel', schlecht: 'schlecht', info: 'offen' };
  const PUNKT = (t) => '<span class="la-punkt ' + (TON[t] || 'offen') + '" aria-label="' + ({ gut: 'gut', mittel: 'mittel', schlecht: 'kritisch', info: 'Hinweis' }[t] || '') + '"></span>';
  const datum = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : (iso || ''); };
  const name = (p, i) => p.meta.name || p.meta.bezeichnung || 'Probe ' + (i + 1);

  // ---------- Seiten ----------
  function render(r) {
    const L = lesen();
    if (r.id) { const b = L.find((x) => x.id === r.id); if (b) return r.i != null && b.proben[r.i] ? probeSeite(b, r.i) : berichtSeite(b); }
    return start(L);
  }
  function start(L) {
    const I = app().I;
    return '<div class="bar"><h2>Laboranalyse auswerten<span class="sub">Prüfbericht fotografieren oder als PDF laden</span></h2></div><div class="pad la">' +
      '<div class="la-hero"><p><b>Bericht erhalten? Gleich einlesen.</b> Die App bewertet jeden Wert mit einer Ampel, prüft wichtige Verhältnisse (z. B. Gärqualität, Pansen-Bilanz, Verschmutzung) und erklärt Ursachen und Massnahmen – ausführlicher als der Postbericht.</p>' +
      '<div class="row"><label class="btn primary grow la-datei">' + I.camera + ' Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-la="datei" hidden></label>' +
      '<label class="btn grow la-datei">' + I.upload + ' PDF oder Bild wählen<input type="file" accept="application/pdf,image/*" data-la="datei" hidden></label></div>' +
      '<p class="small muted" style="margin:8px 0 0">Am besten das PDF vom Labor (alle Proben auf einmal). Fotos: eine Probe pro Bild, gerade und gut beleuchtet.</p></div>' +
      (L.length ? '<section class="q"><h3>Eingelesene Berichte</h3><ul class="list">' + L.map((b) => '<li><a class="item" href="#/labor/' + b.id + '"><span class="avatar" style="background:var(--surface-2)">' + PUNKT(gesamt(b)) + '</span><span style="min-width:0"><span class="t">' + esc(b.titel) + '</span><span class="s">' + esc([b.labor, b.proben.length + (b.proben.length === 1 ? ' Probe' : ' Proben'), 'eingelesen ' + datum(b.at.slice(0, 10))].filter(Boolean).join(' · ')) + '</span></span></a></li>').join('') + '</ul></section>' : '') +
      '<section class="q la-teaser"><h3>Mehr mit anonymem Beitrag (bald)</h3><p class="small">Wer die Werte anonym beiträgt (ohne Name, Betrieb, Ort), sieht, wie die eigene Probe im Vergleich zu anderen Betrieben derselben Region, Höhe und Schnittzeit liegt, und erhält erweiterte Beratungsangebote.</p></section>' +
      '<p class="hint">Prototyp – Bewertungsregeln werden fachlich geprüft. Grundlagen: Zielbereiche des Labors, AGFF-Schlüssel K3b, DLG-Gärqualität, AGRIDEA-Fütterungsplan u. a. (bei jedem Befund unter «Warum?»).</p></div>';
  }
  function gesamt(b) { const rang = { schlecht: 3, mittel: 2, gut: 1 }; return b.proben.reduce((m, p) => { const g = R().auswerten(p).gesamt; return rang[g] > rang[m] ? g : m; }, 'gut'); }

  function berichtSeite(b) {
    const I = app().I;
    return '<div class="bar"><a class="icon-btn" href="#/labor" aria-label="Zurück">' + I.back + '</a><h2>' + esc(b.titel) + '<span class="sub">' + esc([b.labor, b.proben.length + ' Proben'].filter(Boolean).join(' · ')) + '</span></h2>' +
      '<button class="icon-btn" data-la="loeschen" data-id="' + b.id + '" aria-label="Bericht entfernen">✕</button></div><div class="pad la"><ul class="list la-proben">' +
      b.proben.map((p, i) => { const a = R().auswerten(p); const top = a.befunde[0];
        return '<li><a class="item" href="#/labor/' + b.id + '/' + i + '"><span class="avatar" style="background:var(--surface-2)">' + PUNKT(a.gesamt) + '</span><span style="min-width:0"><span class="t">' + esc(name(p, i)) + '</span><span class="s">' + esc([({ silage: 'Silage', duerr: 'Dürrfutter', gruen: 'Frisches Futter' }[a.art]), p.meta.bezeichnung && p.meta.bezeichnung !== p.meta.name ? p.meta.bezeichnung : '', p.meta.schnitt ? p.meta.schnitt + ' Schnitt' : '', top ? top.titel : ''].filter(Boolean).join(' · ')) + '</span></span>' +
          '<span class="meta"><span class="num">' + (p.werte.nel ? zahl(p.werte.nel.v, 1) : '–') + '</span><br><span class="small muted">MJ NEL</span></span></a></li>'; }).join('') + '</ul>' +
      '<p class="hint">Gespeichert nur auf diesem Gerät. Kunden-Nr., Adressen und Standortcode des Berichts werden nicht übernommen.</p></div>';
  }

  function enqHtml(e, L, warum) {
    if (!e) return '';
    const PF = { besser: '<span class="la-enq besser">▲ besser</span>', schlechter: '<span class="la-enq schlechter">▼ schwächer</span>', gleich: '<span class="la-enq">≈ wie Mittel</span>', neutral: '' };
    return '<section class="q"><h3>Vergleich mit dem Schweizer Mittel</h3><p class="small muted" style="margin-top:0">' + esc(e.art) + ', Raufutter-Enquête ' + e.jahr + ' (' + Number(e.n).toLocaleString('de-CH').replace(/[’']/g, '\u2009') + ' Proben)' +
      (e.genau ? '' : ' – neuestes verfügbares Jahr, da das Schnittjahr fehlt oder noch nicht ausgewertet ist') + '</p>' +
      '<div class="tbl-wrap"><table class="wi-tab la-tab"><tr><th>Wert</th><th class="num">Probe</th><th class="num">Mittel CH</th><th class="num">Differenz</th><th></th></tr>' +
      e.zeilen.map((z) => { const [t, u, d] = L[z.k] || [z.k, '', 1]; return '<tr><td>' + esc(t) + '</td><td class="num">' + zahl(z.probe, d) + ' <span class="muted small">' + u + '</span></td><td class="num">' + zahl(z.mittel, d) + '</td><td class="num">' + (z.diff > 0 ? '+' : z.diff < 0 ? '−' : '') + zahl(Math.abs(z.diff), d) + '</td><td class="small">' + PF[z.urteil] + '</td></tr>'; }).join('') +
      '</table></div>' + warum(e.quelle) + '</section>';
  }

  function probeSeite(b, i) {
    const p = b.proben[i]; const a = R().auswerten(p); const I = app().I; const L = R().LABEL;
    const warum = (q) => (q && q.length ? '<details class="la-warum"><summary>Warum?</summary><ul>' + q.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></details>' : '');
    const befund = (x) => '<div class="la-befund ' + x.ton + '"><div class="la-bef-kopf">' + PUNKT(x.ton) + '<b>' + esc(x.titel) + '</b></div><p>' + esc(x.text) + '</p>' +
      (x.ration ? '<p class="small"><b>Für die Ration:</b> ' + esc(x.ration) + '</p>' : '') + (x.naechstes ? (Array.isArray(x.naechstes) ? '<p class="small" style="margin-bottom:2px"><b>Nächstes Mal:</b></p><ul class="small la-mass">' + x.naechstes.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>' : '<p class="small"><b>Nächstes Mal:</b> ' + esc(x.naechstes) + '</p>') : '') + warum(x.quelle) + '</div>';
    const zeile = (k) => { const w = p.werte[k]; if (!w) return ''; const e = a.werte[k]; const [t, u, d] = L[k] || [k, '', 1];
      const ziel = w.ziel ? (w.ziel[0] != null ? zahl(w.ziel[0], d) + '–' : '≤ ') + zahl(w.ziel[1], d) : '';
      return '<tr><td>' + (e ? PUNKT(e.ton) : '') + '</td><td>' + esc(t) + '</td><td class="num"><b>' + (w.kleiner ? '< ' : '') + zahl(w.v, d) + '</b> <span class="muted small">' + u + '</span></td><td class="small muted">' + esc(ziel) + '</td><td class="small">' + esc(e ? e.text : '') + '</td></tr>'; };
    const kopf = [({ silage: 'Silage', duerr: 'Dürrfutter', gruen: 'Frisches Futter' }[a.art]), p.meta.bezeichnung, p.meta.schnitt ? p.meta.schnitt + ' Schnitt' : '', p.meta.schnittdatum ? datum(p.meta.schnittdatum) : '', p.meta.hoehe].filter(Boolean).join(' · ');
    return '<div class="bar"><a class="icon-btn" href="#/labor/' + b.id + '" aria-label="Zurück">' + I.back + '</a><h2>' + esc(name(p, i)) + '<span class="sub">' + esc(kopf) + '</span></h2></div><div class="pad la">' +
      (p.meta.bestand || p.meta.bemerkung ? '<p class="small muted" style="margin-top:0">' + esc([p.meta.bestand, p.meta.bemerkung].filter(Boolean).join(' · ')) + '</p>' : '') +
      '<section class="q"><h3>Das Wichtigste</h3>' + a.befunde.map(befund).join('') + '</section>' +
      (a.verhaeltnisse.length ? '<section class="q"><h3>Verhältnisse und Kennzahlen</h3><table class="wi-tab la-tab">' + a.verhaeltnisse.map((x) => '<tr><td>' + PUNKT(x.ton) + '</td><td>' + esc(x.titel) + '</td><td class="num"><b>' + esc(x.wert) + '</b></td><td class="small">' + esc(x.text) + warum(x.quelle) + '</td></tr>').join('') + '</table></section>' : '') +
      enqHtml(a.enquete, L, warum) +
      R().GRUPPEN.map(([g, ks]) => { const z = ks.map(zeile).join(''); return z ? '<section class="q"><h3>' + esc(g) + '</h3><div class="tbl-wrap"><table class="wi-tab la-tab"><tr><th></th><th>Wert</th><th class="num">Resultat</th><th>Ziel (Labor)</th><th>Bewertung</th></tr>' + z + '</table></div></section>' : ''; }).join('') +
      (p.kommentare && p.kommentare.length ? '<section class="q"><h3>Kommentar des Labors</h3>' + p.kommentare.map((k) => '<p class="small">' + esc(k) + '</p>').join('') + '</section>' : '') +
      '<div class="row" style="margin-top:12px"><button class="btn primary grow" data-la="probe" data-id="' + b.id + '" data-i="' + i + '">' + I.plus + ' Als Probe übernehmen</button><a class="btn grow" href="#/bilanz">Rationscheck</a></div>' +
      '<p class="hint">Prototyp – die Bewertung ersetzt keine Fütterungsberatung. Bei kritischen Befunden die Fachstelle beiziehen.</p></div>';
  }

  // ---------- Einlesen ----------
  function zustimmung() {
    const A = app(); const v = global.LaborOCR && global.LaborOCR.OCR_CONSENT;
    if (A.db.prefs.ocrConsent === v) return Promise.resolve(v);
    return new Promise((ok) => {
      A.sheet('<h2>Bericht einlesen</h2><div class="consent"><ul><li>Der Bericht wird zum Lesen an den Server der App geschickt, <b>nur im Arbeitsspeicher</b> verarbeitet und sofort gelöscht.</li>' +
        '<li>Übernommen werden nur Probenangaben und Messwerte. <b>Kunden-Nr., Name, Adresse und Standortcode</b> werden nicht übernommen.</li><li>Die Auswertung bleibt auf diesem Gerät.</li></ul>' +
        '<div class="row"><button class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow" id="laOk">Einverstanden, einlesen</button></div></div>', (el) => {
        el.querySelector('#laOk').onclick = () => { A.db.prefs.ocrConsent = v; A.save(); A.closeSheet(); ok(v); };
      });
    });
  }
  async function einlesen(file) {
    const A = app();
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { A.toast('Datei zu gross (max. 12 MB).'); return; }
    const v = await zustimmung(); if (!v) return;
    A.sheet('<h2>Bericht wird gelesen …</h2><p class="small">Das dauert bei Fotos bis zu einer halben Minute.</p><div class="la-laden"></div>');
    let r;
    try {
      const res = await fetch('api/labor/bericht', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-OCR-Consent': v }, body: file, credentials: 'omit', cache: 'no-store' });
      r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'HTTP ' + res.status);
    } catch (e) {
      A.closeSheet();
      A.toast({ FORMAT: 'Nur PDF oder Bild (JPEG, PNG, WebP).', TOO_LARGE: 'Datei zu gross.', NICHT_LESBAR: 'Bericht konnte nicht gelesen werden.', BESCHAEFTIGT: 'Server ausgelastet – bitte gleich nochmals.', RATE_LIMITED: 'Zu viele Versuche – bitte später.' }[e.message] || 'Einlesen fehlgeschlagen: ' + e.message);
      return;
    }
    A.closeSheet();
    if (!r.proben || !r.proben.length) { A.toast('Keine Messwerte erkannt. Bitte das PDF vom Labor verwenden oder das Foto gerade und scharf aufnehmen.', { fehler: true }); return; }
    const b = { id: A.uid(), at: new Date().toISOString(), datei: String(file.name || '').slice(0, 80), labor: r.labor || null, quelle: r.quelle,
      titel: (r.labor ? r.labor + ' ' : '') + (r.proben.length > 1 ? r.proben.length + ' Proben' : name(r.proben[0], 0)), proben: r.proben.map(bereinigen).filter(Boolean) };
    const L = lesen(); L.unshift(b); schreiben(L);
    A.go(b.proben.length === 1 ? '#/labor/' + b.id + '/0' : '#/labor/' + b.id);
    A.toast(b.proben.length + (b.proben.length === 1 ? ' Probe' : ' Proben') + ' eingelesen – bitte Werte mit dem Bericht vergleichen.');
  }
  /** Server-Antwort prüfen (nur bekannte Felder, Zahlen, kurze Texte) */
  function bereinigen(p) {
    if (!p || typeof p !== 'object') return null;
    const s = (x, n) => (typeof x === 'string' ? x.slice(0, n) : undefined);
    const meta = {}; ['name', 'bezeichnung', 'belueftung', 'bestand', 'schnitt', 'schnittdatum', 'hoehe', 'bemerkung'].forEach((k) => { const v = s((p.meta || {})[k], 200); if (v) meta[k] = v; });
    const werte = {}; Object.keys(R().LABEL).forEach((k) => { const w = (p.werte || {})[k]; if (!w || typeof w.v !== 'number' || !isFinite(w.v)) return;
      const ziel = Array.isArray(w.ziel) && w.ziel.length === 2 && w.ziel.every((x) => x == null || (typeof x === 'number' && isFinite(x))) ? w.ziel : null;
      werte[k] = { v: w.v, kleiner: !!w.kleiner, mittel: typeof w.mittel === 'number' && isFinite(w.mittel) ? w.mittel : null, ziel }; });
    if (!Object.keys(werte).length) return null;
    return { nr: s(p.nr, 40) || '', meta, werte, kommentare: (Array.isArray(p.kommentare) ? p.kommentare : []).map((k) => s(k, 600)).filter(Boolean).slice(0, 12) };
  }

  function alsProbe(b, i) {
    const A = app(); const p = b.proben[i]; const a = R().auswerten(p);
    const typ = /mais/i.test((p.meta.name || '') + (p.meta.bezeichnung || '')) ? 'mais' : a.art === 'silage' ? 'gras' : 'heu';
    const labor = {}; const map = { bs: 'buttersaeure' };
    ['ts', 'nel', 'nev', 'apde', 'apdn', 'rp', 'rf', 'ra', 'ndf', 'adf', 'zucker', 'ph', 'milchsaeure', 'essigsaeure', 'bs'].forEach((k) => { if (p.werte[k]) labor[map[k] || k] = p.werte[k].v; });
    const pr = A.neueProbe(typ, null, {});
    pr.kopf.bez = name(p, i); if (/^\d{4}-\d{2}-\d{2}$/.test(p.meta.schnittdatum || '')) pr.kopf.schnitt = p.meta.schnittdatum;
    pr.labor = labor; A.touchProbe(pr);
    A.toast('Probe angelegt – Laborwerte sind übernommen. Jetzt die eigene Sinnenprüfung erfassen und vergleichen.');
    A.go('#/p/' + pr.id + '/probe');
  }

  function handle(e) {
    const t = e.target.closest('[data-la]'); if (!t || t.tagName === 'INPUT') return false;
    const A = app();
    if (t.dataset.la === 'loeschen') { if (confirm('Eingelesenen Bericht von diesem Gerät entfernen?')) { schreiben(lesen().filter((x) => x.id !== t.dataset.id)); A.go('#/labor'); } return true; }
    if (t.dataset.la === 'probe') { const b = lesen().find((x) => x.id === t.dataset.id); if (b) alsProbe(b, Number(t.dataset.i)); return true; }
    return false;
  }
  document.addEventListener('change', (e) => { const el = e.target.closest && e.target.closest('input[data-la="datei"]'); if (el) { const f = el.files[0]; el.value = ''; einlesen(f); } });

  global.Laborauswertung = { render, handle, einlesen, probe: (id, i) => { const b = lesen().find((x) => x.id === id); return b && b.proben[i] ? b.proben[i] : null; }, _t: { bereinigen, lesen } };
})(window);
