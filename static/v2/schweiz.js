/* Futter v2 – «Auswertung Schweiz»: anonyme Beiträge auf der CH-Karte (PLZ-Region) und nach Höhenzone.
 *
 * Datenschutz: Der Server liefert Kennwerte nur für Gruppen ab 5 Beiträgen (k-Anonymität); kleinere Gruppen
 * erscheinen nur als Anzahl. Regionen = erste zwei Ziffern der PLZ (Mittelpunkt aus dem amtlichen Ortschaftenverzeichnis).
 * Höhenzonen sind eine Näherung über die Höhe (Tal < 600 m, Hügel 600–800 m, Berg ≥ 800 m), nicht die amtlichen Zonen.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  let geo = null;
  const zustand = { typ: 'alle', seit: 0, kennwert: 'nel', region: null, daten: null, laedt: false };

  // Farbskala NEL (MJ/kg TS): tief → orange, hoch → grün
  function farbe(nel) {
    if (nel == null) return '#b9c6c0';
    const t = Math.max(0, Math.min(1, (nel - 5.0) / 1.6));
    const a = [233, 119, 46], m = [224, 172, 43], b = [47, 158, 95];
    const mix = (x, y, u) => x.map((v, i) => Math.round(v + (y[i] - v) * u));
    const c = t < 0.5 ? mix(a, m, t * 2) : mix(m, b, (t - 0.5) * 2);
    return 'rgb(' + c.join(',') + ')';
  }
  const fmt = (n, d) => (n == null ? '–' : Number(n).toFixed(d == null ? 2 : d));
  const KLASSE = { gut: 'gut', leicht: 'leicht fehlerhaft', stark: 'stark fehlerhaft', problem: 'problematisch', sperre: 'nicht verfüttern' };

  async function laden() {
    const A = app();
    zustand.laedt = true;
    try {
      if (!geo) geo = await (await fetch('assets/geo-ch.json?v=' + ((global.AGFF_V2 || {}).build || ''), { credentials: 'omit' })).json();
      const q = new URLSearchParams({ typ: zustand.typ, seit: String(zustand.seit || 0) });
      zustand.daten = await global.FutterIO.api('statistik/schweiz?' + q.toString());
    } catch (e) { zustand.fehler = e.message || String(e); }
    zustand.laedt = false;
    if (A.route().name === 'schweiz') A.render();
  }

  // ---------- Karte ----------
  function karte(d) {
    const A = app(); const esc = A.esc; const K = d.kMin;
    const eigene = new Set(A.db.proben.map((p) => p.kopf && p.kopf.plz && String(p.kopf.plz).slice(0, 2)).filter(Boolean));
    const reg = Object.entries(d.regionen || {}).filter(([k]) => geo.regionen[k]);
    const maxN = Math.max(1, ...reg.map(([, v]) => v.n));
    const wert = (v) => (zustand.kennwert === 'labor' ? (v.laborNel || {}).p50 : (v.nel || {}).p50);
    const kreise = reg.sort((x, y) => y[1].n - x[1].n).map(([k, v]) => {
      const [x, y] = geo.regionen[k]; const voll = v.n >= K;
      const r = voll ? 5.5 + 8.5 * Math.sqrt(v.n / maxN) : 3;
      const w = voll ? wert(v) : null;
      return '<g class="sw-reg' + (zustand.region === k ? ' aktiv' : '') + '" data-sw-region="' + k + '" tabindex="0" role="button" aria-label="Region ' + k + ': ' + v.n + ' Proben">' +
        '<circle cx="' + x + '" cy="' + y + '" r="' + Math.max(r, 9) + '" fill="transparent"/>' +
        '<circle cx="' + x + '" cy="' + y + '" r="' + r.toFixed(1) + '" fill="' + (voll ? farbe(w) : '#c9d2ce') + '" fill-opacity="' + (voll ? 0.88 : 0.9) + '" stroke="' + (zustand.region === k ? '#17221e' : '#fff') + '" stroke-width="' + (zustand.region === k ? 2 : 1) + '"/>' +
        (voll && r > 7.5 ? '<text x="' + x + '" y="' + (y + 0.5) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (r > 11 ? 7 : 5.8) + '" font-weight="700" fill="#fff">' + (w != null ? fmt(w, 1) : v.n) + '</text>' : '') + '</g>';
    }).join('');
    const ringe = [...eigene].filter((k) => geo.regionen[k]).map((k) => { const [x, y] = geo.regionen[k]; return '<circle cx="' + x + '" cy="' + y + '" r="3" fill="none" stroke="#0f7f74" stroke-width="1.6" stroke-dasharray="2 1.5"/>'; }).join('');
    const L = 240; // Legende unter der Karte
    const legende = [5.0, 5.4, 5.8, 6.2, 6.6].map((n, i) => '<rect x="' + (8 + i * 26) + '" y="' + L + '" width="24" height="7" rx="2" fill="' + farbe(n) + '"/><text x="' + (20 + i * 26) + '" y="' + (L + 15) + '" text-anchor="middle" font-size="6.5" fill="#4b5a54">' + fmt(n, 1) + '</text>').join('');
    return '<svg class="sw-karte" viewBox="0 0 360 262" role="img" aria-label="Schweizer Karte mit Proben nach PLZ-Region">' +
      geo.umriss.map((p) => '<path d="' + p + '" fill="#eef4f0" stroke="#9fb3aa" stroke-width="0.8"/>').join('') +
      kreise + '<g pointer-events="none">' + ringe + '</g>' +
      legende + '<text x="142" y="' + (L + 6) + '" font-size="6.5" fill="#4b5a54">' + (zustand.kennwert === 'labor' ? 'NEL Labor' : 'NEL geschätzt') + ' (Median, MJ/kg TS)</text>' +
      '<circle cx="146" cy="' + (L + 14) + '" r="3" fill="#c9d2ce"/><text x="152" y="' + (L + 16.5) + '" font-size="6.5" fill="#4b5a54">weniger als ' + K + ' Proben – nur Anzahl</text>' +
      (eigene.size ? '<circle cx="262" cy="' + (L + 14) + '" r="3" fill="none" stroke="#0f7f74" stroke-width="1.4" stroke-dasharray="2 1.5"/><text x="268" y="' + (L + 16.5) + '" font-size="6.5" fill="#4b5a54">Ihre Regionen</text>' : '') +
      '</svg>';
  }

  function regionDetail(d) {
    const A = app(); const esc = A.esc; const k = zustand.region;
    if (!k || !d.regionen[k]) return '<p class="hint">Region antippen für Details.</p>';
    const v = d.regionen[k]; const g = geo.regionen[k] || [];
    let h = '<div class="card sw-detail"><div class="row"><b class="grow">PLZ ' + esc(k) + 'xx · ' + esc(g[2] || '') + ' (' + esc(g[3] || '') + ')</b><span class="chip">' + v.n + ' Proben</span></div>';
    if (v.n < d.kMin) return h + '<p class="small muted" style="margin:6px 0 0">Kennwerte erst ab ' + d.kMin + ' Proben – zum Schutz der Betriebe.</p></div>';
    h += kennzeilen(v) + '</div>';
    return h;
  }
  function kennzeilen(v) {
    const kl = v.klassen || {}; const total = Object.values(kl).reduce((s, n) => s + n, 0);
    const farben = { gut: 'var(--gut)', leicht: 'var(--mittel)', stark: 'var(--schlecht)', problem: 'var(--kritisch)', sperre: 'var(--kritisch)' };
    return '<div class="kpis" style="margin-top:8px"><div class="kpi"><div class="l">NEL geschätzt</div><div class="v">' + fmt(v.nel && v.nel.p50) + ' <small>MJ</small></div><div class="d muted">' + (v.nel ? fmt(v.nel.p25) + '–' + fmt(v.nel.p75) + ' (mittlere Hälfte)' : '') + '</div></div>' +
      '<div class="kpi"><div class="l">NEL Labor</div><div class="v">' + fmt(v.laborNel && v.laborNel.p50) + ' <small>MJ</small></div><div class="d muted">' + (v.laborNel ? v.laborNel.n + ' mit Labor' : 'zu wenig Laborwerte') + '</div></div></div>' +
      (total ? '<div class="sw-klassen" title="Qualitätsklassen">' + Object.entries(kl).map(([k, n]) => '<span style="flex:' + n + ';background:' + (farben[k] || 'var(--offen)') + '" title="' + (KLASSE[k] || k) + ': ' + n + '"></span>').join('') + '</div><p class="small muted" style="margin:4px 0 0">' + Object.entries(kl).map(([k, n]) => (KLASSE[k] || k) + ' ' + n).join(' · ') + (v.kurs ? ' · davon ' + v.kurs + ' aus Kursen' : '') + '</p>' : '');
  }

  // ---------- Höhenzonen ----------
  function hoehenGrafik(d) {
    const H = 2600, y = (m) => 20 + (1 - m / H) * 210; // 0 m → y=230, 2600 m → y=20
    const zonen = [['tal', 0, 600, '#dcefdc', 'Talgebiet'], ['huegel', 600, 800, '#eef0cf', 'Hügelgebiet'], ['berg', 800, H, '#efe4d6', 'Berggebiet']];
    const zinfo = Object.fromEntries((d.zonen || []).map((z) => [z.id, z]));
    let s = '<svg class="sw-hoehe" viewBox="0 0 360 246" role="img" aria-label="Proben nach Höhenzone mit Höhenskala">';
    zonen.forEach(([id, lo, hi, fill]) => { s += '<rect x="40" y="' + y(hi) + '" width="316" height="' + (y(lo) - y(hi)) + '" fill="' + fill + '"/>'; });
    // stilisierte Landschaft: Tal – Hügel – Berge mit Schnee
    s += '<path d="M40 ' + y(420) + ' C70 ' + y(430) + ' 95 ' + y(470) + ' 120 ' + y(650) + ' S150 ' + y(760) + ' 170 ' + y(700) + ' S195 ' + y(900) + ' 215 ' + y(1250) + ' L245 ' + y(2050) + ' L262 ' + y(1700) + ' L288 ' + y(2450) + ' L312 ' + y(1900) + ' L330 ' + y(2150) + ' L356 ' + y(1500) + ' L356 230 L40 230 Z" fill="#7aa98a" fill-opacity=".55"/>';
    s += '<path d="M238 ' + y(1850) + ' L245 ' + y(2050) + ' L252 ' + y(1880) + ' Z M280 ' + y(2200) + ' L288 ' + y(2450) + ' L297 ' + y(2220) + ' Z M324 ' + y(2000) + ' L330 ' + y(2150) + ' L337 ' + y(2010) + ' Z" fill="#fff"/>';
    // Skala
    for (let m = 0; m <= 2500; m += 500) s += '<line x1="34" x2="40" y1="' + y(m) + '" y2="' + y(m) + '" stroke="#74837d"/><text x="31" y="' + (y(m) + 2.5) + '" text-anchor="end" font-size="7" fill="#4b5a54">' + m + '</text>';
    s += '<text x="8" y="14" font-size="7" fill="#4b5a54">m ü. M.</text>';
    [600, 800].forEach((m) => { s += '<line x1="40" x2="356" y1="' + y(m) + '" y2="' + y(m) + '" stroke="#74837d" stroke-dasharray="3 2" stroke-width=".7"/>'; });
    // Profil: Balken je 200 m (Länge = Anzahl, Farbe = Median NEL)
    const pmax = Math.max(1, ...(d.profil || []).map((p) => p.n));
    (d.profil || []).forEach((p) => {
      const w = 6 + 120 * (p.n / pmax); const y0 = y(p.von + 200) + 1.5; const hh = y(p.von) - y(p.von + 200) - 3;
      s += '<rect x="44" y="' + y0 + '" width="' + w + '" height="' + hh + '" rx="2" fill="' + farbe(p.nel) + '" fill-opacity=".9"/>' +
        '<text x="' + (48 + w) + '" y="' + (y0 + hh / 2 + 2.5) + '" font-size="6.6" fill="#17221e">' + p.n + (p.nel != null ? ' · ' + fmt(p.nel, 1) + ' MJ' : '') + '</text>';
    });
    // Zonen-Beschriftung rechts
    zonen.forEach(([id, lo, hi, , name]) => {
      const z = zinfo[id] || { n: 0 }; const ym = id === 'berg' ? y(1000) : (y(lo) + y(hi)) / 2;
      s += '<text x="352" y="' + (ym - 1) + '" text-anchor="end" font-size="8" font-weight="700" fill="#17221e">' + name + '</text>' +
        '<text x="352" y="' + (ym + 8) + '" text-anchor="end" font-size="6.8" fill="#17221e">' + z.n + ' Proben' + (z.nel ? ' · NEL ' + fmt(z.nel.p50, 1) : '') + '</text>';
    });
    return s + '</svg>';
  }

  function render() {
    const A = app(); const esc = A.esc; const d = zustand.daten;
    if (!d && !zustand.laedt) setTimeout(laden, 0);
    const jahr = new Date().getFullYear();
    const seg = (name, opts) => '<div class="seg sm" role="group">' + opts.map(([v, t]) => '<button data-sw="' + name + '" data-val="' + v + '" aria-pressed="' + (String(zustand[name]) === String(v)) + '">' + t + '</button>').join('') + '</div>';
    let h = '<div class="bar"><a class="icon-btn back-btn hide-wide" href="#/" aria-label="Zurück">' + A.I.back + '</a><h2>Auswertung Schweiz<span class="sub">Anonyme Beiträge aus Betrieben und Kursen</span></h2></div><div class="wizard sw">' +
      '<div class="stack" style="gap:8px">' + seg('typ', [['alle', 'Alle'], ['heu', 'Dürrfutter'], ['gras', 'Grassilage'], ['mais', 'Mais'], ['gruen', 'Grünfutter'], ['gps', 'GPS']]) +
      '<div class="row" style="gap:8px">' + seg('seit', [[0, 'Alle Jahre'], [jahr - 1, 'ab ' + (jahr - 1)], [jahr, jahr]]) + seg('kennwert', [['nel', 'Schätzung'], ['labor', 'Labor']]) + '</div></div>';
    if (zustand.fehler && !d) return h + '<div class="alert info" style="margin-top:14px">Auswertung nicht verfügbar: ' + esc(zustand.fehler) + '</div></div>';
    if (!d || !geo) return h + '<div class="card small muted" style="margin-top:14px">Lade Auswertung …</div></div>';
    h += '<div class="kpis" style="margin-top:14px"><div class="kpi"><div class="l">Beiträge</div><div class="v">' + d.n + '</div><div class="d muted">' + (d.gesamt.kurs ? d.gesamt.kurs + ' aus Kursen' : '') + '</div></div>' +
      '<div class="kpi"><div class="l">NEL geschätzt (Median)</div><div class="v">' + fmt(d.gesamt.nel && d.gesamt.nel.p50) + ' <small>MJ</small></div></div>' +
      '<div class="kpi"><div class="l">NEL Labor (Median)</div><div class="v">' + fmt(d.gesamt.laborNel && d.gesamt.laborNel.p50) + ' <small>MJ</small></div></div></div>';
    h += '<div class="section-title">Nach PLZ-Region</div><div class="card sw-karte-box">' + karte(d) + '</div>' + regionDetail(d);
    h += '<div class="section-title">Nach Höhenzone</div><div class="card">' + hoehenGrafik(d) +
      '<p class="small muted" style="margin:6px 0 0">Balken: Anzahl Proben je 200 m Höhe, Farbe = Median NEL (ab ' + d.kMin + ' Proben). Zonen als Näherung über die Höhe: Tal unter 600 m, Hügel 600–800 m, Berg ab 800 m – nicht die amtlichen Zonen des Produktionskatasters.' + (d.ohneHoehe ? ' ' + d.ohneHoehe + ' Proben ohne Höhenangabe.' : '') + '</p></div>';
    h += '<div class="sw-zonen">' + (d.zonen || []).map((z) => '<div class="card"><b>' + esc(z.name) + '</b> <span class="small muted">' + (z.bis >= 5000 ? 'ab ' + z.von : z.von + '–' + z.bis) + ' m · ' + z.n + ' Proben</span>' +
      (z.n >= d.kMin ? kennzeilen(z) : '<p class="small muted" style="margin:6px 0 0">Kennwerte ab ' + d.kMin + ' Proben.</p>') + '</div>').join('') + '</div>';
    h += '<p class="small muted">Nur Proben, deren Beitrag freigegeben wurde (Einstellungen bzw. Kurs). Gruppen unter ' + d.kMin + ' Proben zeigen nur die Anzahl. Kursproben zählen einmal (Median der Beurteilungen). ' + esc(geo.quelle) + '.</p></div>';
    return h;
  }

  /** Klicks auf Filter und Regionen (vom globalen Handler weitergereicht). */
  function handle(t) {
    const A = app();
    const r = t.closest('[data-sw-region]');
    if (r) { zustand.region = zustand.region === r.dataset.swRegion ? null : r.dataset.swRegion; A.render(); return true; }
    const b = t.closest('[data-sw]');
    if (b) {
      const k = b.dataset.sw; const v = b.dataset.val; zustand[k] = k === 'seit' ? Number(v) : v;
      if (k === 'kennwert') { A.render(); return true; }
      zustand.daten = null; zustand.region = null; A.render(); return true;
    }
    return false;
  }

  global.Schweiz = { render, handle, laden, farbe };
})(window);
