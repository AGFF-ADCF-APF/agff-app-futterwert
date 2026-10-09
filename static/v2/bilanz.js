/* Futter v2 – Grundfutter-Bilanz: Orientierung, keine Ration.
 *
 * Mischung aus eigenen beurteilten Proben (Schätzung oder Labor), Tabellenfutter (Agroscope/AGFF) und Richtwerten
 * für Kraftfutter/Nebenprodukte (editierbar). Zeigt Nährstoffdichte, Bedarfsdeckung und mögliche Leistung für eine
 * Milchkuh oder einen Mastmuni (Bedarf wie Milch-/Mastpotenzial: Agroscope, Grünes Buch), Pansen-N-Bilanz und Hinweise.
 * Bewusst nicht enthalten: Mineralstoffe, Vitamine, Struktur im Detail, Kosten, Herdengruppen – dafür Fütterungsberatung.
 * Gespeichert nur auf diesem Gerät (localStorage).
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const K3 = () => global.K3;
  const KEY = 'agffV2Bilanz';

  // Richtwerte je kg TS (gerundet; bitte mit Lieferschein / feedbase.ch prüfen). kf = Kraftfutter (für den Anteil).
  const RICHTWERTE = [
    { id: 'gerste', name: 'Gerste', ts: 88, nel: 8.1, nev: 8.3, apde: 102, apdn: 80, rf: 50, kf: true },
    { id: 'koernermais', name: 'Körnermais', ts: 88, nel: 8.6, nev: 9.1, apde: 108, apdn: 76, rf: 25, kf: true },
    { id: 'weizen', name: 'Weizen', ts: 88, nel: 8.5, nev: 9.0, apde: 105, apdn: 95, rf: 30, kf: true },
    { id: 'soja', name: 'Sojaextraktionsschrot', ts: 88, nel: 8.6, nev: 9.0, apde: 300, apdn: 350, rf: 65, kf: true },
    { id: 'raps', name: 'Rapsextraktionsschrot', ts: 89, nel: 7.2, nev: 7.4, apde: 170, apdn: 250, rf: 135, kf: true },
    { id: 'schnitzel', name: 'Trockenschnitzel (Zuckerrübe)', ts: 90, nel: 7.4, nev: 7.8, apde: 105, apdn: 65, rf: 190, kf: true },
    { id: 'mlf', name: 'Milchleistungsfutter (Beispiel)', ts: 88, nel: 7.8, nev: 8.2, apde: 110, apdn: 115, rf: 80, kf: true },
    { id: 'prot', name: 'Proteinkonzentrat (Beispiel)', ts: 88, nel: 7.4, nev: 7.7, apde: 230, apdn: 280, rf: 80, kf: true },
  ];
  const FELDER = [['nel', 'NEL', 'MJ', 2], ['nev', 'NEV', 'MJ', 2], ['apde', 'APDE', 'g', 0], ['apdn', 'APDN', 'g', 0], ['rf', 'RF', 'g', 0]];

  function laden() {
    let b = null;
    try { b = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { b = null; }
    if (!b || !Array.isArray(b.teile)) b = { tier: 'kuh', milch: 25, zuwachs: 1200, teile: [] };
    return b;
  }
  let B = laden();
  const merken = () => { try { localStorage.setItem(KEY, JSON.stringify(B)); } catch (e) { /* privat */ } };
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; };
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ---------- Futterquellen ----------
  /** Werte einer eigenen Probe (Labor bevorzugt, falls gewünscht) und TS in %. */
  function probenWerte(p, mitLabor) {
    const A = app(); const res = A.auswertung(p); const w = Object.assign({}, res.werte || {});
    const lab = p.labor || {};
    if (mitLabor) ['nel', 'nev', 'apde', 'apdn', 'rf'].forEach((k) => { if (lab[k] != null) w[k] = lab[k]; });
    let ts = lab.ts != null ? lab.ts : null;
    if (ts == null && p.typ === 'gras') ts = (K3().K3B_TS.find((x) => x.id === p.antworten.ts) || {}).tsWert || 35;
    if (ts == null && p.typ === 'mais') ts = { lt30: 28, 30: 31, 32: 34, 36: 37, gt38: 40 }[p.antworten.ts] || 33;
    if (ts == null) ts = 88;
    return { w, ts, vollstaendig: res.vollstaendig, labor: mitLabor && lab.nel != null };
  }
  function tabelle() { return app().basisTabelle && app().basisTabelle(); }
  function tabellenFutter(kons, aufwuchs, bestand, stadium) {
    const t = tabelle(); const r = t && t[kons] && t[kons][aufwuchs] && t[kons][aufwuchs][bestand] && t[kons][aufwuchs][bestand][String(stadium)];
    if (!r) return null;
    return { nel: r.nel, nev: r.nev, apde: r.apde, apdn: r.apdn, rf: r.rf, ts: r.ts ? Math.round(r.ts / 10) : 88 };
  }
  function maisTabelle() {
    const w = K3().K3C_AUSGANG[0].w; const m = K3().K3C_METRIKEN; const o = {};
    m.forEach((k, i) => { if (w[i] != null) o[k] = w[i]; });
    return { nel: o.nel, nev: o.nev, apde: o.apde, apdn: o.apdn, rf: o.rf, ts: 34 };
  }

  /** Aktuelle Werte eines Bestandteils (eigene Proben werden live nachgeführt). */
  function werteVon(t) {
    if (t.quelle === 'probe') {
      const p = app().probeById(t.probeId); if (!p) return null;
      const v = probenWerte(p, t.labor !== false);
      return Object.assign({}, v.w, { ts: t.ts != null ? t.ts : v.ts });
    }
    return t.w;
  }

  // ---------- Rechnen ----------
  function rechnen() {
    const zeilen = B.teile.map((t) => {
      const w = werteVon(t) || {}; const ts = num(t.ts != null ? t.ts : w.ts) || 88;
      const fs = num(t.kg) || 0; const kgTs = fs * ts / 100;
      return { t, w, ts, fs, kgTs };
    });
    const sumTs = zeilen.reduce((s, z) => s + z.kgTs, 0);
    const summe = {}; const vollst = {};
    FELDER.forEach(([k]) => {
      const mit = zeilen.filter((z) => z.kgTs > 0 && z.w[k] != null);
      summe[k] = mit.reduce((s, z) => s + z.kgTs * z.w[k], 0);
      vollst[k] = mit.reduce((s, z) => s + z.kgTs, 0) >= sumTs - 1e-9;
    });
    const dichte = {}; FELDER.forEach(([k]) => { dichte[k] = sumTs ? summe[k] / sumTs : null; });
    const kfTs = zeilen.filter((z) => z.t.kf).reduce((s, z) => s + z.kgTs, 0);
    const out = { zeilen, sumTs, summe, dichte, vollst, kfAnteil: sumTs ? kfTs / sumTs : 0 };
    const db = app().db.prefs;
    if (B.tier === 'kuh') {
      const kg = Number(db.kuhGewicht) || 630; const sc = Math.pow(kg / 630, 0.75);
      const mNel = 40.5 * sc, mAp = 409 * sc;
      const milch = { nel: (summe.nel - mNel) / 3.14, apde: (summe.apde - mAp) / 50, apdn: (summe.apdn - mAp) / 50 };
      const min = Math.min(milch.nel, milch.apde, milch.apdn);
      const ziel = num(B.milch) || 0;
      out.kuh = { kg, milch, moeglich: Math.max(0, min), limit: min === milch.nel ? 'NEL' : min === milch.apde ? 'APDE' : 'APDN',
        bedarf: { nel: mNel + 3.14 * ziel, apd: mAp + 50 * ziel }, ziel,
        tsRichtwert: [0.022 * kg + 0.1 * ziel, 0.03 * kg + 0.15 * ziel] }; // grobe übliche Spanne
    } else {
      const lg = Math.max(K3().MAST.LG_MIN, Math.min(K3().MAST.LG_MAX, Number(db.mastGewicht) || 400));
      const apd = Math.min(summe.apde, summe.apdn);
      const loese = (f) => { let lo = 0, hi = 2000; if (f(lo) < 0) return null; if (f(hi) >= 0) return hi; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (f(m) >= 0) lo = m; else hi = m; } return lo; };
      const tzwE = loese((t) => summe.nev - K3().mastNevBedarf(lg, t));
      const tzwP = loese((t) => apd - K3().mastApdBedarf(lg, t));
      const ziel = num(B.zuwachs) || 0;
      out.mast = { lg, tzwE, tzwP, moeglich: tzwE == null || tzwP == null ? null : Math.min(tzwE, tzwP), limit: tzwE != null && tzwP != null && tzwP < tzwE ? 'APD' : 'NEV',
        ziel, bedarf: ziel ? { nev: K3().mastNevBedarf(lg, ziel), apd: K3().mastApdBedarf(lg, ziel), ts: K3().mastTsv(lg, ziel) } : null };
    }
    // Hinweise (Orientierung)
    const h = [];
    if (sumTs > 0) {
      const nb = dichte.apdn - dichte.apde;
      if (vollst.apde && vollst.apdn) {
        if (nb < 0) h.push({ ton: 'mittel', t: 'Pansen-Stickstoff knapp: APDN liegt ' + Math.abs(nb).toFixed(0) + ' g/kg TS unter APDE. Die Pansenmikroben bekommen zu wenig abbaubares Protein – eine proteinreichere Komponente (z. B. junges Gras, Rapsschrot) gleicht aus.' });
        else if (nb > 25) h.push({ ton: 'mittel', t: 'Stickstoff-Überschuss im Pansen: APDN liegt ' + nb.toFixed(0) + ' g/kg TS über APDE. Energiereichere Komponenten ergänzen; Milchharnstoff beobachten.' });
        else h.push({ ton: 'gut', t: 'Pansen-Stickstoff ausgeglichen (APDN − APDE = ' + nb.toFixed(0) + ' g/kg TS).' });
      }
      if (out.kfAnteil > 0.4) h.push({ ton: 'schlecht', t: 'Kraftfutter macht ' + Math.round(out.kfAnteil * 100) + ' % der TS aus – Risiko für Pansenübersäuerung. Struktur und Fütterungstechnik mit der Beratung prüfen.' });
      if (vollst.rf && dichte.rf < 170) h.push({ ton: 'mittel', t: 'Rohfaser ' + dichte.rf.toFixed(0) + ' g/kg TS – Richtwert für Milchkühe rund 170–180 g/kg TS. Strukturversorgung prüfen.' });
      if (out.kuh && out.kuh.ziel) {
        const [lo, hi] = out.kuh.tsRichtwert;
        if (sumTs > hi * 1.15) h.push({ ton: 'mittel', t: 'Die eingesetzte TS-Menge (' + sumTs.toFixed(1) + ' kg) liegt über dem, was eine Kuh dieser Leistung üblicherweise frisst. Ist die Menge realistisch?' });
        if (sumTs < lo * 0.85) h.push({ ton: 'mittel', t: 'Die TS-Menge (' + sumTs.toFixed(1) + ' kg) ist eher tief für diese Leistung – fehlt eine Komponente?' });
      }
      if (out.mast && out.mast.bedarf && Math.abs(sumTs - out.mast.bedarf.ts) / out.mast.bedarf.ts > 0.2) h.push({ ton: 'mittel', t: 'Erwarteter TS-Verzehr für diesen Muni und Zuwachs: ca. ' + out.mast.bedarf.ts.toFixed(1) + ' kg – eingesetzt sind ' + sumTs.toFixed(1) + ' kg.' });
      const fehlt = FELDER.filter(([k]) => k !== 'rf' && !vollst[k]).map((f) => f[1]);
      if (fehlt.length) h.push({ ton: 'mittel', t: 'Für ' + fehlt.join(', ') + ' fehlen bei einzelnen Komponenten Werte – die Bilanz ist dort unvollständig.' });
    }
    out.hinweise = h;
    return out;
  }

  // ---------- Darstellung ----------
  function render() {
    const A = app(); const esc = A.esc; const fmt = A.fmt; const r = rechnen();
    const prob = A.db.proben.filter((p) => A.auswertung(p).vollstaendig);
    let h = '<div class="bar"><a class="icon-btn back-btn hide-wide" href="#/" aria-label="Zurück">' + A.I.back + '</a><h2>Grundfutter-Bilanz<span class="sub">Orientierung, keine Ration</span></h2>' +
      '<button class="btn sm" data-bl="pdf">' + A.I.pdf + ' PDF</button></div><div class="wizard bilanz">';
    h += '<div class="alert info" style="margin-bottom:12px">' + A.I.warn + '<div>Die Bilanz zeigt, wie weit Ihr Grundfutter (und allfälliges Kraftfutter) Energie und Protein deckt. <b>Sie ersetzt keine Rationsberechnung</b> – Mineralstoffe, Vitamine, Struktur, Verzehr und Tiergesundheit gehören in die Fütterungsberatung. Das PDF können Sie der Beraterin oder dem Berater mitgeben.</div></div>';
    // Tier
    h += '<section class="q"><h3>Tier</h3><div class="seg" role="group">' + [['kuh', 'Milchkuh'], ['mast', 'Mastmuni']].map(([v, t]) => '<button data-bl="tier" data-val="' + v + '" aria-pressed="' + (B.tier === v) + '">' + t + '</button>').join('') + '</div>' +
      (B.tier === 'kuh'
        ? '<div class="grid2" style="margin-top:10px"><label class="field"><span>Milchleistung (kg/Tag)</span><input class="input" data-blk="milch" inputmode="decimal" value="' + esc(B.milch) + '"></label><label class="field"><span>Gewicht Kuh (kg)</span><input class="input" data-blp="kuhGewicht" inputmode="numeric" value="' + esc(A.db.prefs.kuhGewicht) + '"></label></div>'
        : '<div class="grid2" style="margin-top:10px"><label class="field"><span>Ziel-Tageszuwachs (g)</span><input class="input" data-blk="zuwachs" inputmode="numeric" value="' + esc(B.zuwachs) + '"></label><label class="field"><span>Gewicht Muni (kg)</span><input class="input" data-blp="mastGewicht" inputmode="numeric" value="' + esc(A.db.prefs.mastGewicht) + '"></label></div>') + '</section>';
    // Bestandteile
    h += '<section class="q"><h3>Futter pro Tier und Tag</h3><div class="stack">' + (r.zeilen.length ? r.zeilen.map((z) => {
      const t = z.t; const quelle = t.quelle === 'probe' ? (z.w.nel == null ? 'Probe nicht gefunden' : 'Eigene Probe' + (t.labor !== false && (app().probeById(t.probeId) || {}).labor ? ' · Laborwerte' : ' · Schätzung')) : t.quelle === 'tabelle' ? 'Tabellenwert Agroscope/AGFF' : t.quelle === 'richtwert' ? 'Richtwert – bitte prüfen' : 'Eigene Werte';
      const edit = t.quelle !== 'probe';
      return '<div class="card bl-teil" data-bl-id="' + t.id + '"><div class="row"><b class="grow">' + esc(t.name) + '</b><span class="small muted">' + esc(quelle) + '</span><button class="icon-btn" data-bl="weg" aria-label="Entfernen">×</button></div>' +
        '<div class="grid4" style="margin-top:6px"><label class="field"><span>kg Frischsubstanz</span><input class="input" data-blt="kg" inputmode="decimal" value="' + esc(t.kg != null ? t.kg : '') + '"></label>' +
        '<label class="field"><span>TS %</span><input class="input" data-blt="ts" inputmode="decimal" value="' + esc(t.ts != null ? t.ts : z.ts) + '"></label>' +
        '<div class="field"><span>= kg TS</span><div class="bl-wert">' + fmt(z.kgTs, 1) + '</div></div>' +
        (t.quelle === 'probe' && (app().probeById(t.probeId) || {}).labor ? '<label class="toggle" style="align-self:end"><input type="checkbox" data-blt="labor"' + (t.labor !== false ? ' checked' : '') + '> Labor</label>' : '<span></span>') + '</div>' +
        '<div class="bl-werte">' + FELDER.map(([k, l, u, d]) => edit
          ? '<label><span>' + l + '</span><input class="input sm" data-blw="' + k + '" inputmode="decimal" value="' + esc(z.w[k] != null ? z.w[k] : '') + '"></label>'
          : '<span><span>' + l + '</span><b>' + fmt(z.w[k], d) + '</b></span>').join('') + '<span class="small muted">je kg TS</span></div></div>';
    }).join('') : '<p class="small muted">Noch kein Futter. Fügen Sie unten eigene Proben, Tabellenfutter oder Kraftfutter hinzu.</p>') + '</div>' +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn" data-bl="add-probe"' + (prob.length ? '' : ' disabled title="Noch keine vollständig beurteilten Proben"') + '>+ Eigene Probe</button><button class="btn" data-bl="add-tabelle">+ Tabellenfutter</button><button class="btn" data-bl="add-kf">+ Kraftfutter / Nebenprodukt</button><button class="btn ghost" data-bl="add-eigen">+ Eigene Werte</button></div></section>';
    // Ergebnis
    if (r.sumTs > 0) {
      h += '<div class="section-title">Ergebnis</div><div class="kpis"><div class="kpi"><div class="l">TS gesamt</div><div class="v">' + fmt(r.sumTs, 1) + ' <small>kg</small></div><div class="d muted">Kraftfutter ' + Math.round(r.kfAnteil * 100) + ' %</div></div>' +
        '<div class="kpi"><div class="l">Energiedichte</div><div class="v">' + fmt(B.tier === 'kuh' ? r.dichte.nel : r.dichte.nev, 2) + ' <small>MJ ' + (B.tier === 'kuh' ? 'NEL' : 'NEV') + '</small></div><div class="d muted">je kg TS</div></div>' +
        '<div class="kpi"><div class="l">APDE / APDN</div><div class="v" style="font-size:1.3rem">' + fmt(r.dichte.apde, 0) + ' / ' + fmt(r.dichte.apdn, 0) + '</div><div class="d muted">g je kg TS</div></div></div>';
      if (r.kuh) {
        const k = r.kuh; const vals = [['NEL', k.milch.nel, 'Energie'], ['APDE', k.milch.apde, 'Protein (Energie im Pansen)'], ['APDN', k.milch.apdn, 'Protein (Stickstoff im Pansen)']];
        const max = Math.max(35, k.ziel || 0, ...vals.map((v) => v[1]));
        h += '<div class="card" style="margin-top:12px"><div class="row"><b class="grow">Milch aus dieser Ration</b><span class="kpi-inline"><b style="font-size:1.5rem">' + fmt(k.moeglich, 1) + '</b> kg/Tag</span></div>' +
          '<div class="bars" style="margin-top:10px">' + vals.map(([l, v, t]) => '<div class="b" style="cursor:default" title="' + t + '"><span class="lbl">' + l + (l === k.limit ? ' · begrenzt' : '') + '</span><span class="track"><span class="val" style="width:' + Math.max(0, Math.min(100, (v / max) * 100)) + '%;background:' + (l === k.limit ? 'var(--schlecht)' : 'var(--line-strong)') + '"></span>' +
            (k.ziel ? '<span class="ziel" style="left:' + Math.min(100, (k.ziel / max) * 100) + '%"></span>' : '') + '</span><span class="n">' + fmt(Math.max(0, v), 1) + '</span></div>').join('') + '</div>' +
          (k.ziel ? '<p class="small" style="margin:8px 0 0">Ziel ' + fmt(k.ziel, 0) + ' kg: Bedarf ' + fmt(k.bedarf.nel, 0) + ' MJ NEL (gedeckt ' + Math.round(r.summe.nel / k.bedarf.nel * 100) + ' %) und ' + fmt(k.bedarf.apd, 0) + ' g APD (gedeckt ' + Math.round(Math.min(r.summe.apde, r.summe.apdn) / k.bedarf.apd * 100) + ' %).</p>' : '') +
          '<p class="small muted" style="margin:6px 0 0">Kuh ' + k.kg + ' kg; Erhaltung und 3,14 MJ NEL bzw. 50 g APD je kg Milch (wie Milchbildungspotenzial, Agroscope).</p></div>';
      } else {
        const m = r.mast; const vals = [['NEV', m.tzwE, 'Energie'], ['APD', m.tzwP, 'Protein']]; const max = Math.max(1600, m.ziel || 0, ...vals.map((v) => v[1] || 0));
        h += '<div class="card" style="margin-top:12px"><div class="row"><b class="grow">Zuwachs aus dieser Ration</b><span class="kpi-inline"><b style="font-size:1.5rem">' + (m.moeglich == null ? '–' : m.moeglich >= 2000 ? '> 2000' : fmt(Math.round(m.moeglich / 10) * 10, 0)) + '</b> g/Tag</span></div>' +
          '<div class="bars" style="margin-top:10px">' + vals.map(([l, v]) => '<div class="b" style="cursor:default"><span class="lbl">' + l + (l === m.limit ? ' · begrenzt' : '') + '</span><span class="track"><span class="val" style="width:' + Math.max(0, Math.min(100, ((v || 0) / max) * 100)) + '%;background:' + (l === m.limit ? 'var(--schlecht)' : 'var(--line-strong)') + '"></span>' +
            (m.ziel ? '<span class="ziel" style="left:' + Math.min(100, (m.ziel / max) * 100) + '%"></span>' : '') + '</span><span class="n">' + (v == null ? '< Erh.' : v >= 2000 ? '> 2000' : fmt(Math.round(v / 10) * 10, 0)) + '</span></div>').join('') + '</div>' +
          (m.bedarf ? '<p class="small" style="margin:8px 0 0">Ziel ' + fmt(m.ziel, 0) + ' g: Bedarf ' + fmt(m.bedarf.nev, 0) + ' MJ NEV (gedeckt ' + Math.round(r.summe.nev / m.bedarf.nev * 100) + ' %) und ' + fmt(m.bedarf.apd, 0) + ' g APD (gedeckt ' + Math.round(Math.min(r.summe.apde, r.summe.apdn) / m.bedarf.apd * 100) + ' %).</p>' : '') +
          '<p class="small muted" style="margin:6px 0 0">Muni ' + m.lg + ' kg; Bedarf nach Agroscope, Grünes Buch Kap. 10.</p></div>';
      }
      h += '<div class="stack" style="margin-top:12px">' + r.hinweise.map((x) => '<div class="alert ' + (x.ton === 'gut' ? 'info' : 'warn') + '"><span>' + (x.ton === 'gut' ? '✓' : x.ton === 'schlecht' ? '⚠' : '💡') + '</span><div>' + esc(x.t) + '</div></div>').join('') + '</div>';
    }
    h += '<p class="small muted" style="margin-top:14px">Richtwerte für Kraftfutter und Nebenprodukte sind gerundete Durchschnittswerte – Werte vom Lieferschein oder aus der Schweizerischen Futtermitteldatenbank (feedbase.ch) eintragen, wenn vorhanden. Die Bilanz wird nur auf diesem Gerät gespeichert. <button class="btn sm ghost" data-bl="neu">Neue Bilanz</button></p></div>';
    return h;
  }

  // ---------- Hinzufügen ----------
  function addProbe() {
    const A = app(); const esc = A.esc;
    const liste = A.db.proben.filter((p) => A.auswertung(p).vollstaendig);
    A.sheet('<h2>Eigene Probe hinzufügen</h2><p class="small muted" style="margin-top:0">Nur vollständig beurteilte Proben. Mit Laborwerten wird standardmässig das Labor verwendet.</p><ul class="list">' +
      liste.map((p) => { const r = A.auswertung(p); const a = p.anlassId && A.anlassById(p.anlassId); return '<li><a class="item typ-' + p.typ + '" href="#" data-bl="probe" data-pid="' + p.id + '"><span><span class="t">' + esc((p.kopf && p.kopf.bez) || 'Probe') + '</span><span class="s">' + A.typBadge(p.typ) + ' ' + esc((a ? a.titel + ' · ' : '') + 'NEL ' + A.fmt(r.werte.nel, 2) + (p.labor && p.labor.nel != null ? ' · Labor ' + A.fmt(p.labor.nel, 2) : '')) + '</span></span></a></li>'; }).join('') + '</ul><button class="btn ghost block" data-close>Abbrechen</button>');
  }
  function addTabelle() {
    const A = app(); const K = K3();
    A.sheet('<h2>Tabellenfutter</h2><form id="blTab" class="stack"><label class="field"><span>Futter</span><select class="input" name="kons"><option value="gruen">Grünfutter / Weide</option><option value="heu">Dürrfutter</option><option value="silage">Grassilage</option><option value="mais">Maissilage (K3c, einwandfrei)</option></select></label>' +
      '<div class="grid2"><label class="field"><span>Bestand</span><select class="input" name="bestand">' + K.BESTAENDE.map((b) => '<option value="' + b.id + '">' + b.kurz + ' ' + b.titel + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Aufwuchs</span><select class="input" name="aufwuchs"><option value="1">1. Aufwuchs</option><option value="f">Folgeaufwuchs</option></select></label></div>' +
      '<label class="field"><span>Stadium</span><select class="input" name="stadium">' + [1, 2, 3, 4, 5, 6, 7].map((n) => '<option' + (n === 3 ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<p class="hint" id="blTabInfo"></p><div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Hinzufügen</button></div></form>', (el) => {
      const f = el.querySelector('#blTab');
      const info = () => { const d = Object.fromEntries(new FormData(f)); const w = d.kons === 'mais' ? maisTabelle() : tabellenFutter(d.kons, d.aufwuchs, d.bestand, d.stadium);
        el.querySelector('#blTabInfo').textContent = w ? 'NEL ' + A.fmt(w.nel, 2) + ' MJ · APDE ' + A.fmt(w.apde, 0) + ' g · APDN ' + A.fmt(w.apdn, 0) + ' g je kg TS · TS ' + w.ts + ' %' : 'Für diese Kombination gibt es keinen Tabellenwert.';
        ['bestand', 'aufwuchs', 'stadium'].forEach((n) => { f.querySelector('[name=' + n + ']').disabled = d.kons === 'mais'; }); };
      f.addEventListener('change', info); info();
      f.addEventListener('submit', (e) => {
        e.preventDefault(); const d = Object.fromEntries(new FormData(f));
        const w = d.kons === 'mais' ? maisTabelle() : tabellenFutter(d.kons, d.aufwuchs, d.bestand, d.stadium); if (!w) return;
        const name = d.kons === 'mais' ? 'Maissilage' : ({ gruen: 'Grünfutter', heu: 'Dürrfutter', silage: 'Grassilage' }[d.kons] + ' ' + (K.BESTAND_PLAIN[d.bestand] || d.bestand) + ', ' + (d.aufwuchs === '1' ? '1. Aufw.' : 'Folgeaufw.') + ', St. ' + d.stadium);
        B.teile.push({ id: uid(), quelle: 'tabelle', name, ts: w.ts, kg: null, w: { nel: w.nel, nev: w.nev, apde: w.apde, apdn: w.apdn, rf: w.rf } }); merken(); A.closeSheet(); A.render();
      });
    });
  }
  function addKf() {
    const A = app();
    A.sheet('<h2>Kraftfutter / Nebenprodukt</h2><p class="small muted" style="margin-top:0">Gerundete Richtwerte je kg TS – nach dem Hinzufügen anpassbar (Lieferschein, feedbase.ch).</p><ul class="list">' +
      RICHTWERTE.map((r) => '<li><a class="item" href="#" data-bl="kf" data-kf="' + r.id + '"><span><span class="t">' + A.esc(r.name) + '</span><span class="s">NEL ' + r.nel + ' · APDE ' + r.apde + ' · APDN ' + r.apdn + ' · TS ' + r.ts + ' %</span></span></a></li>').join('') + '</ul><button class="btn ghost block" data-close>Abbrechen</button>');
  }

  // ---------- PDF für die Beratung ----------
  async function pdf() {
    const A = app(); const r = rechnen(); const IO = global.FutterIO;
    await IO.loadScript('assets/vendor/jspdf.umd.min.js');
    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4' }); const T = (s) => IO.pdfText(String(s));
    let y = 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(T('Grundfutter-Bilanz'), 15, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text(T('Orientierung, keine Ration · erstellt ' + new Date().toLocaleDateString('de-CH') + ' mit der AGFF-Futterbeurteilung'), 15, y + 6); doc.setTextColor(20);
    y += 16; doc.setFontSize(10);
    doc.text(T(B.tier === 'kuh' ? 'Milchkuh ' + (r.kuh.kg) + ' kg, Ziel ' + (num(B.milch) || 0) + ' kg Milch/Tag' : 'Mastmuni ' + r.mast.lg + ' kg, Ziel ' + (num(B.zuwachs) || 0) + ' g/Tag'), 15, y); y += 8;
    const kopf = ['Futter', 'kg FS', 'TS %', 'kg TS', 'NEL', 'NEV', 'APDE', 'APDN', 'RF'];
    const xs = [15, 88, 104, 118, 134, 148, 162, 176, 190];
    doc.setFont('helvetica', 'bold'); kopf.forEach((k, i) => doc.text(T(k), xs[i], y)); doc.setFont('helvetica', 'normal'); y += 5;
    r.zeilen.forEach((z) => {
      const v = [z.t.name.slice(0, 40), A.fmt(z.fs, 1), A.fmt(z.ts, 0), A.fmt(z.kgTs, 1), A.fmt(z.w.nel, 2), A.fmt(z.w.nev, 2), A.fmt(z.w.apde, 0), A.fmt(z.w.apdn, 0), A.fmt(z.w.rf, 0)];
      v.forEach((x, i) => doc.text(T(x), xs[i], y)); y += 5;
      doc.setFontSize(7); doc.setTextColor(110); doc.text(T(z.t.quelle === 'probe' ? 'eigene Probe' + (z.t.labor !== false && (A.probeById(z.t.probeId) || {}).labor ? ' (Labor)' : ' (Schätzung)') : z.t.quelle === 'tabelle' ? 'Tabellenwert' : z.t.quelle === 'richtwert' ? 'Richtwert' : 'eigene Werte'), 15, y - 1.5); doc.setFontSize(10); doc.setTextColor(20); y += 2;
    });
    doc.line(15, y, 200, y); y += 5;
    doc.setFont('helvetica', 'bold'); doc.text(T('Total / je kg TS'), 15, y); doc.text(A.fmt(r.sumTs, 1), xs[3], y);
    ['nel', 'nev', 'apde', 'apdn', 'rf'].forEach((k, i) => doc.text(T(A.fmt(r.dichte[k], i < 2 ? 2 : 0)), xs[4 + i], y)); doc.setFont('helvetica', 'normal'); y += 10;
    if (r.kuh) doc.text(T('Milch aus dieser Ration: ' + A.fmt(r.kuh.moeglich, 1) + ' kg/Tag (begrenzt durch ' + r.kuh.limit + '; NEL ' + A.fmt(r.kuh.milch.nel, 1) + ', APDE ' + A.fmt(r.kuh.milch.apde, 1) + ', APDN ' + A.fmt(r.kuh.milch.apdn, 1) + ')'), 15, y);
    else doc.text(T('Zuwachs aus dieser Ration: ' + (r.mast.moeglich == null ? '–' : r.mast.moeglich >= 2000 ? '> 2000' : Math.round(r.mast.moeglich / 10) * 10) + ' g/Tag (begrenzt durch ' + r.mast.limit + ')'), 15, y);
    y += 7; doc.text(T('Kraftfutteranteil: ' + Math.round(r.kfAnteil * 100) + ' % der TS'), 15, y); y += 9;
    r.hinweise.forEach((x) => { const l = doc.splitTextToSize(T('- ' + x.t), 180); doc.text(l, 15, y); y += l.length * 5 + 1; });
    y += 4; doc.setFontSize(8); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(T('Hinweis: Diese Bilanz zeigt die Versorgung mit Energie und Protein als Orientierung. Sie berücksichtigt keine Mineralstoffe, Vitamine, Strukturwirksamkeit, Verzehrsgrenzen im Detail oder Tiergesundheit und ersetzt keine Rationsberechnung durch eine Fütterungsberatung. Richtwerte für Kraftfutter sind gerundete Durchschnittswerte.'), 180), 15, y);
    const blob = doc.output('blob'); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'Grundfutter-Bilanz.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---------- Ereignisse ----------
  function teil(el) { const c = el.closest('[data-bl-id]'); return c && B.teile.find((t) => t.id === c.dataset.blId); }
  function handle(e) {
    const A = app(); const t = e.target.closest('[data-bl]'); if (!t) return false;
    e.preventDefault();
    const a = t.dataset.bl;
    if (a === 'tier') { B.tier = t.dataset.val; merken(); A.render(); }
    if (a === 'weg') { const x = teil(t); B.teile = B.teile.filter((y) => y !== x); merken(); A.render(); }
    if (a === 'add-probe') addProbe();
    if (a === 'add-tabelle') addTabelle();
    if (a === 'add-kf') addKf();
    if (a === 'add-eigen') { B.teile.push({ id: uid(), quelle: 'eigen', name: 'Eigenes Futter', ts: 88, kg: null, kf: false, w: {} }); merken(); A.render(); }
    if (a === 'probe') { const p = A.probeById(t.dataset.pid); if (p) { B.teile.push({ id: uid(), quelle: 'probe', probeId: p.id, name: (p.kopf && p.kopf.bez) || 'Probe', kg: null, labor: true }); merken(); } A.closeSheet(); A.render(); }
    if (a === 'kf') { const r = RICHTWERTE.find((x) => x.id === t.dataset.kf); if (r) { B.teile.push({ id: uid(), quelle: 'richtwert', name: r.name, ts: r.ts, kg: null, kf: true, w: { nel: r.nel, nev: r.nev, apde: r.apde, apdn: r.apdn, rf: r.rf } }); merken(); } A.closeSheet(); A.render(); }
    if (a === 'neu') { if (confirm('Bilanz leeren und neu beginnen?')) { B = { tier: B.tier, milch: B.milch, zuwachs: B.zuwachs, teile: [] }; merken(); A.render(); } }
    if (a === 'pdf') pdf().catch((er) => A.toast('PDF fehlgeschlagen: ' + er.message));
    return true;
  }
  /** Eingaben: Werte übernehmen und Ergebnis neu zeichnen, ohne den Fokus zu verlieren. */
  let timer = null;
  function eingabe(e) {
    const A = app(); const el = e.target;
    if (el.dataset.blk) B[el.dataset.blk] = el.value;
    else if (el.dataset.blp) {
      const v = num(el.value); if (!v) return;
      if (el.dataset.blp === 'mastGewicht' && (v < K3().MAST.LG_MIN || v > K3().MAST.LG_MAX)) return;
      if (el.dataset.blp === 'kuhGewicht' && (v < 300 || v > 1200)) return;
      A.db.prefs[el.dataset.blp] = v; A.save();
    }
    else if (el.dataset.blt) { const x = teil(el); if (!x) return; if (el.dataset.blt === 'labor') x.labor = el.checked; else x[el.dataset.blt] = num(el.value); }
    else if (el.dataset.blw) { const x = teil(el); if (!x) return; x.w = x.w || {}; const v = num(el.value); if (v == null || el.value === '') delete x.w[el.dataset.blw]; else x.w[el.dataset.blw] = v; }
    else return;
    merken();
    clearTimeout(timer);
    timer = setTimeout(() => { // Neu zeichnen, Fokus und Cursor wiederherstellen
      const sel = el.dataset.blw ? '[data-blw="' + el.dataset.blw + '"]' : el.dataset.blt ? '[data-blt="' + el.dataset.blt + '"]' : el.dataset.blk ? '[data-blk="' + el.dataset.blk + '"]' : '[data-blp="' + el.dataset.blp + '"]';
      const id = (el.closest('[data-bl-id]') || {}).dataset; const pos = el.selectionStart;
      const m = document.querySelector('#main'); const st = m.scrollTop; const ws = window.scrollY;
      A.render(); m.scrollTop = st; window.scrollTo(0, ws);
      const neu = document.querySelector((id && id.blId ? '[data-bl-id="' + id.blId + '"] ' : '') + sel);
      if (neu && neu.type !== 'checkbox') { neu.focus(); try { neu.setSelectionRange(pos, pos); } catch (er) { /* egal */ } }
    }, el.type === 'checkbox' ? 0 : 700);
  }

  global.Bilanz = { render, handle, eingabe, rechnen, RICHTWERTE, hinzufuegen: (probeIds) => { probeIds.forEach((id) => { const p = app().probeById(id); if (p && !B.teile.some((t) => t.probeId === id)) B.teile.push({ id: uid(), quelle: 'probe', probeId: id, name: (p.kopf && p.kopf.bez) || 'Probe', kg: null, labor: true }); }); merken(); } };
})(window);
