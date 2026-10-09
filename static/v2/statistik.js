/* Futter v2 – anonyme Beiträge, regionaler Vergleich und Hinweis «sicher speichern».
 *
 * Beitrag (nur mit Einwilligung, je Probe abschaltbar): PLZ, Höhe (100 m), Monat/Jahr, Futterart,
 * Bestand/Stadium, Antworten, geschätzte Werte, Laborwerte. Keine Namen, Betriebe, Parzellen, Notizen, Fotos.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  let CONSENT = null;
  const vergleichCache = new Map();
  const timers = new Map();

  async function consentVersion() {
    if (!CONSENT) CONSENT = (await global.FutterIO.api('statistik/config')).consentVersion;
    return CONSENT;
  }
  const b64u = (bytes) => btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const zufall = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));

  /** Darf diese Probe beitragen? (Kursproben nicht – dort gelten die Kursregeln) */
  function erlaubt(p) {
    const A = app(); const pr = A.db.prefs;
    if (!p || p.kursProbeId || !(p.kopf && /^[1-9]\d{3}$/.test(p.kopf.plz || ''))) return false;
    const an = p.anlassId && A.anlassById(p.anlassId);
    if (an && an.kurs) return false;
    const will = p.teilen != null ? p.teilen : !!pr.beitragen;
    return will && !!pr.beitragConsent && A.auswertung(p).vollstaendig;
  }
  function datenFuer(p) {
    const A = app(); const res = A.auswertung(p); const d = new Date(p.kopf.schnitt || p.createdAt);
    const werte = {}; Object.entries(res.werte || {}).forEach(([k, v]) => { if (['nel', 'nev', 'apde', 'apdn', 'rp', 'rf', 'ndf', 'zucker', 'staerke'].includes(k) && typeof v === 'number' && isFinite(v) && v >= 0) werte[k] = Math.round(v * 100) / 100; });
    const antworten = {}; Object.entries(p.antworten || {}).forEach(([k, v]) => { if (k !== 'leitpflanze' && (typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && /^[A-Za-z0-9_.-]{0,16}$/.test(v)))) antworten[k] = v; });
    const o = { typ: p.typ, plz: p.kopf.plz, jahr: d.getFullYear(), monat: d.getMonth() + 1, aufwuchs: p.antworten.aufwuchs, bestand: p.antworten.bestand,
      stadium: p.antworten.stadium, klasse: res.sperre.length ? 'sperre' : (res.klasse ? res.klasse.id : undefined), punkte: res.punkte != null ? res.punkte : undefined,
      antworten, rad: Object.assign({}, res.auswahl), werte, labor: p.labor || undefined };
    if (p.kopf.hoehe) o.hoehe = Number(p.kopf.hoehe);
    Object.keys(o.rad).forEach((k) => { if (!o.rad[k]) delete o.rad[k]; });
    Object.keys(o).forEach((k) => { if (o[k] === undefined) delete o[k]; });
    return o;
  }

  /** Beitrag anlegen/aktualisieren bzw. zurückziehen (verzögert nach Änderungen). */
  function planen(p) {
    if (!p) return;
    clearTimeout(timers.get(p.id));
    timers.set(p.id, setTimeout(() => abgleichen(p).catch(() => {}), 2500));
  }
  async function abgleichen(p) {
    const A = app();
    if (!navigator.onLine) return;
    if (erlaubt(p)) {
      const daten = datenFuer(p); const json = JSON.stringify(daten);
      if (p.beitrag && p.beitrag.stand === json) return;
      const b = p.beitrag || { id: zufall(12), token: zufall(32).slice(0, 43) };
      await global.FutterIO.api('statistik/' + b.id, { method: 'PUT', body: { token: b.token, consent: { version: await consentVersion() }, daten } });
      p.beitrag = { id: b.id, token: b.token, stand: json }; A.save();
    } else if (p.beitrag) {
      await zurueckziehen(p);
    }
  }
  async function zurueckziehen(p) {
    const A = app();
    if (!p.beitrag) return;
    await fetch('api/statistik/' + p.beitrag.id, { method: 'DELETE', headers: { 'X-Beitrag-Token': p.beitrag.token }, credentials: 'omit' });
    delete p.beitrag; A.save();
  }
  async function alleAbgleichen() { for (const p of app().db.proben) { await abgleichen(p).catch(() => {}); } }

  function einwilligung(weiter) {
    const A = app();
    A.sheet('<h2>Proben anonym beitragen?</h2><div class="consent"><p style="margin-top:0">Helfen Sie mit, die Futterqualität in der Schweiz besser zu verstehen – und sehen Sie dafür, wie Ihre Proben im Vergleich zur Region abschneiden.</p><ul>' +
      '<li><b>Übermittelt</b> werden nur: Postleitzahl, Höhe (auf 100 m gerundet), Monat und Jahr, Futterart, Bestand und Stadium, Ihre Antworten in der Beurteilung, die geschätzten Werte und – falls vorhanden – Laborwerte.</li>' +
      '<li><b>Nie übermittelt</b>: Namen, Betrieb, Parzelle, Bezeichnungen, Notizen, Fotos.</li>' +
      '<li>Die Daten werden für <b>anonyme Auswertungen und Publikationen</b> (z. B. Übersichten der AGFF) verwendet. Regionale Vergleiche erscheinen erst ab 5 Proben je Gruppe.</li>' +
      '<li>Sie können jede Probe einzeln ausnehmen und Ihre Beiträge jederzeit zurückziehen – sie werden dann gelöscht.</li></ul>' +
      '<p class="small"><a href="' + A.esc((global.AGFF_V2 || {}).privacyUrl || 'datenschutz') + '" target="_blank" rel="noopener">Datenschutzerklärung</a></p>' +
      '<div class="row"><button class="btn ghost grow" data-close>Nein, danke</button><button class="btn primary grow" id="bJa">Ja, anonym beitragen</button></div></div>', (el) => {
      el.querySelector('#bJa').onclick = async () => {
        A.db.prefs.beitragen = true; A.db.prefs.beitragConsent = await consentVersion().catch(() => '2026-10-s1'); A.save(); A.closeSheet();
        A.toast('Danke! Proben mit PLZ werden anonym beigetragen.'); alleAbgleichen(); if (weiter) weiter();
      };
    });
  }

  // ---------- Regionaler Vergleich ----------
  async function vergleichLaden(p) {
    const key = p.typ + '|' + p.kopf.plz + '|' + (p.antworten.aufwuchs || '');
    const c = vergleichCache.get(key);
    if (c && Date.now() - c.zeit < 600000) return c.d;
    const q = new URLSearchParams({ typ: p.typ, plz: p.kopf.plz }); if (p.antworten.aufwuchs) q.set('aufwuchs', p.antworten.aufwuchs);
    const d = await global.FutterIO.api('statistik/vergleich?' + q.toString());
    vergleichCache.set(key, { zeit: Date.now(), d });
    return d;
  }
  function band(v, verteilung, einheit, dez) {
    const A = app();
    if (!verteilung) return '';
    const lo = Math.min(verteilung.p10, v) - 0.05 * Math.abs(verteilung.p90 - verteilung.p10 || 1); const hi = Math.max(verteilung.p90, v) + 0.05 * Math.abs(verteilung.p90 - verteilung.p10 || 1);
    const pos = (x) => ((x - lo) / (hi - lo || 1)) * 100;
    return '<div style="position:relative;height:26px;margin:6px 0 2px"><div style="position:absolute;top:9px;height:8px;left:' + pos(verteilung.p10) + '%;width:' + (pos(verteilung.p90) - pos(verteilung.p10)) + '%;background:var(--line);border-radius:4px"></div>' +
      '<div style="position:absolute;top:6px;height:14px;left:' + pos(verteilung.p25) + '%;width:' + (pos(verteilung.p75) - pos(verteilung.p25)) + '%;background:var(--brand-soft);border:1px solid var(--brand);border-radius:4px"></div>' +
      '<div style="position:absolute;top:3px;height:20px;width:2px;left:' + pos(verteilung.p50) + '%;background:var(--brand-ink)"></div>' +
      '<div title="Ihre Probe" style="position:absolute;top:2px;width:14px;height:22px;margin-left:-7px;left:' + pos(v) + '%;background:var(--schlecht);border-radius:4px;border:2px solid #fff"></div></div>' +
      '<div class="small muted" style="display:flex;justify-content:space-between"><span>' + A.fmt(verteilung.p10, dez) + '</span><span>Median ' + A.fmt(verteilung.p50, dez) + ' ' + einheit + '</span><span>' + A.fmt(verteilung.p90, dez) + '</span></div>';
  }
  function perzentilText(v, d) {
    if (!d) return '';
    const stufen = [[d.p10, 10], [d.p25, 25], [d.p50, 50], [d.p75, 75], [d.p90, 90]];
    let p = 5; stufen.forEach(([x, q]) => { if (v >= x) p = q; });
    return p >= 50 ? 'höher als etwa ' + p + ' %' : 'tiefer als etwa ' + (100 - p) + ' %';
  }
  function vergleichHtml(p) {
    const A = app(); const esc = A.esc;
    if (!p || p.kursProbeId) return '';
    const res = A.auswertung(p); const w = res.werte || {};
    if (!res.vollstaendig || !w.nel) return '';
    if (!(p.kopf && /^[1-9]\d{3}$/.test(p.kopf.plz || ''))) {
      return '<div class="section-title">Vergleich mit der Region</div><div class="card small">Tragen Sie unter «Probe» die <b>Postleitzahl</b> ein, um diese Probe mit Proben aus Ihrer Region zu vergleichen.</div>';
    }
    if (erlaubt(p) && !p.beitrag) planen(p); // noch nicht übertragen → nachholen
    const key = p.typ + '|' + p.kopf.plz + '|' + (p.antworten.aufwuchs || '');
    const c = vergleichCache.get(key);
    if (!c) { vergleichLaden(p).then(() => A.rerenderDetail(true)).catch(() => {}); return '<div class="section-title">Vergleich mit der Region</div><div class="card small muted">Lade Vergleich …</div>'; }
    const d = c.d; const typ = global.K3.TYPEN[p.typ].titel;
    const gruppe = (g, titel) => {
      if (!g || !g.nel) return '<div style="margin-top:10px"><b>' + titel + '</b><p class="small muted" style="margin:4px 0 0">Noch zu wenige Proben (' + (g ? g.n : 0) + ' von mind. ' + d.kMin + ') für einen Vergleich.</p></div>';
      return '<div style="margin-top:12px"><div class="row"><b class="grow">' + titel + '</b><span class="small muted">n = ' + g.n + '</span></div>' +
        '<p class="small" style="margin:4px 0 0">Ihre NEL-Schätzung (' + A.fmt(w.nel, 2) + ' MJ) ist ' + perzentilText(w.nel, g.nel) + ' der Proben.</p>' + band(w.nel, g.nel, 'MJ NEL', 2) +
        (g.apde && w.apde ? '<p class="small" style="margin:8px 0 0">APDE (' + A.fmt(w.apde, 0) + ' g): ' + perzentilText(w.apde, g.apde) + '</p>' + band(w.apde, g.apde, 'g APDE', 0) : '') + '</div>';
    };
    const pr = A.db.prefs;
    const beitrag = p.beitrag ? '<span class="chip gut">anonym beigetragen</span>' : erlaubt(p) ? '<span class="chip">wird beigetragen …</span>' :
      (!pr.beitragConsent ? '<button class="btn sm" data-act="beitrag-ein">Mitmachen</button>' : '<span class="chip">nicht beigetragen</span>');
    return '<div class="section-title">Vergleich mit der Region</div><div class="card"><div class="row"><span class="grow small">' + esc(typ) + (p.antworten.aufwuchs ? (p.antworten.aufwuchs === '1' ? ', 1. Aufwuchs' : ', Folgeaufwuchs') : '') + ' – anonyme Beiträge anderer Nutzerinnen und Nutzer</span>' + beitrag + '</div>' +
      gruppe(d.region, 'Region (PLZ ' + d.region.plz2 + 'xx)') + gruppe(d.schweiz, 'Ganze Schweiz') +
      '<p class="hint">Balken: 10–90 % der Proben, Kasten: mittlere Hälfte, Strich: Median, rot: Ihre Probe.</p></div>';
  }

  // ---------- Hinweis «sicher speichern» ab 3 Proben ----------
  function speicherHinweis(a, anzahl) {
    const A = app(); const pr = A.db.prefs;
    if (pr.nudgeNie || anzahl < 3 || (a && (a.space || a.kurs))) return '';
    const bis = a ? a.nudgeBis : pr.nudgeEinzelBis;
    if (bis && bis > new Date().toISOString()) return '';
    return '<div class="pad" style="padding-bottom:0"><div class="card" style="border-color:var(--brand);background:var(--brand-soft)"><b>' + anzahl + ' Proben – sicher aufbewahren?</b>' +
      '<p class="small" style="margin:6px 0 10px">Speichern Sie sie verschlüsselt auf dem Server: <b>später wieder abrufen</b>, auf allen Geräten, <b>alle Proben an einem Ort</b>. Nur Sie (und wem Sie den Link geben) können sie lesen.</p>' +
      '<div class="row"><button class="btn primary sm" data-act="nudge-ja" data-id="' + (a ? a.id : '') + '">Sicher speichern</button><button class="btn sm ghost" data-act="nudge-spaeter" data-id="' + (a ? a.id : '') + '">Später</button><button class="btn sm ghost" data-act="nudge-nie">Nicht mehr fragen</button></div></div></div>';
  }

  async function handle(act, t) {
    const A = app(); const pr = A.db.prefs;
    switch (act) {
      case 'beitrag-ein': einwilligung(() => A.render()); return true;
      case 'beitrag-aus': {
        if (!confirm('Anonymes Beitragen ausschalten und alle bisherigen Beiträge vom Server löschen?')) return true;
        pr.beitragen = false; A.save();
        for (const p of A.db.proben) await zurueckziehen(p).catch(() => {});
        A.toast('Beiträge zurückgezogen und gelöscht.'); A.render(); return true;
      }
      case 'nudge-spaeter': {
        const bis = new Date(Date.now() + 14 * 864e5).toISOString();
        const a = t.dataset.id && A.anlassById(t.dataset.id); if (a) a.nudgeBis = bis; else pr.nudgeEinzelBis = bis;
        A.save(); A.render(); return true;
      }
      case 'nudge-nie': pr.nudgeNie = true; A.save(); A.render(); A.toast('Verstanden. Speichern bleibt jederzeit im Menü des Anlasses möglich.'); return true;
      case 'nudge-ja': {
        let a = t.dataset.id && A.anlassById(t.dataset.id);
        if (!a) {
          // Einzelproben in einem Anlass «Meine Proben» bündeln
          a = A.db.anlaesse.find((x) => x.titel === 'Meine Proben' && !x.kurs);
          if (!a) { a = { id: A.uid(), titel: 'Meine Proben', createdAt: A.now(), updatedAt: A.now() }; A.db.anlaesse.push(a); }
          A.db.proben.filter((p) => !p.anlassId).forEach((p) => { p.anlassId = a.id; });
          A.save(); A.go('#/a/' + a.id);
        }
        setTimeout(() => A.sheetConsent(a), 80);
        return true;
      }
      default: return false;
    }
  }

  global.addEventListener('online', () => { if (app()) alleAbgleichen(); });
  global.Statistik = { erlaubt, planen, abgleichen, alleAbgleichen, zurueckziehen, einwilligung, vergleichHtml, speicherHinweis, handle };
})(window);
