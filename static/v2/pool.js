/* Futter v2 – Öffentlicher Probenpool (z. B. «Ernte 2026»): für alle ohne Anmeldung.
 * Zeigt nur, was Kursleitende ausdrücklich öffentlich gestellt haben: Angaben zur Probe, Region,
 * Laborwerte, geschwärzte Laborberichte und Futterfotos – keine Beurteilungen, keine Namen.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const esc = (s) => app().esc(s);
  const fmt = (v, d) => app().fmt(v, d);
  let daten = null; let geladen = 0; let laedt = false;

  const WERTE = [
    ['ts', 'Trockensubstanz', '%', 1], ['nel', 'NEL', 'MJ/kg TS', 1], ['nev', 'NEV', 'MJ/kg TS', 1], ['apde', 'APDE', 'g/kg TS', 0], ['apdn', 'APDN', 'g/kg TS', 0],
    ['rp', 'Rohprotein', 'g/kg TS', 0], ['rf', 'Rohfaser', 'g/kg TS', 0], ['ra', 'Rohasche', 'g/kg TS', 0], ['ndf', 'NDF', 'g/kg TS', 0], ['adf', 'ADF', 'g/kg TS', 0],
    ['zucker', 'Zucker', 'g/kg TS', 0], ['ph', 'pH', '', 1], ['milchsaeure', 'Milchsäure', 'g/kg TS', 0], ['essigsaeure', 'Essigsäure', 'g/kg TS', 0], ['buttersaeure', 'Buttersäure', 'g/kg TS', 1],
  ];
  const fotoUrl = (e, f) => 'api/oeffentlich/pool/' + encodeURIComponent(e.id) + '/fotos/' + encodeURIComponent(f.id);

  function laden() {
    if (laedt || (daten && Date.now() - geladen < 60000)) return;
    laedt = true;
    global.FutterIO.api('oeffentlich/pool').then((r) => { daten = r.eintraege || []; geladen = Date.now(); })
      .catch(() => { daten = daten || []; app().toast('Probenpool konnte nicht geladen werden.'); })
      .finally(() => { laedt = false; const rt = app().route(); if (rt.name === 'pool') app().render(); });
  }
  const typ = (t) => (global.K3.TYPEN[t] || {}).titel || t;
  const ort = (e) => [[(e.region || {}).plz, (e.region || {}).ort].filter(Boolean).join(' '), e.hoehenstufe || ((e.region || {}).hoehe ? e.region.hoehe + ' m ü. M.' : '')].filter(Boolean).join(' · ');

  function karte(e) {
    const l = e.labor || {};
    return '<a class="pool-karte" href="#/pool/' + esc(e.id) + '"><div class="pool-kopf">' + app().typBadge(e.typ) + '<b>' + esc(e.titel) + '</b></div>' +
      '<div class="small muted">' + esc([e.schnitt ? app().dateCH(e.schnitt) : '', e.schnittNr ? e.schnittNr + ' Schnitt' : '', e.konservierung].filter(Boolean).join(' · ')) + '</div>' +
      (ort(e) ? '<div class="small muted">' + esc(ort(e)) + '</div>' : '') +
      (l.nel != null || l.rp != null ? '<div class="pool-kpi">' + [['NEL', l.nel, 1, 'MJ'], ['APDE', l.apde, 0, 'g'], ['RP', l.rp, 0, 'g']].filter((x) => x[1] != null).map((x) => '<span><small>' + x[0] + '</small><b>' + fmt(x[1], x[2]) + '</b><small>' + x[3] + '</small></span>').join('') + '</div>' : '') + '</a>';
  }

  function liste() {
    const gruppen = {};
    daten.forEach((e) => { const g = e.sammlung || 'Weitere Proben'; (gruppen[g] = gruppen[g] || []).push(e); });
    const namen = Object.keys(gruppen).sort((a, b) => b.localeCompare(a, 'de'));
    return namen.length ? namen.map((g) => '<section class="q"><h3>' + esc(g) + ' <span class="muted small">(' + gruppen[g].length + ')</span></h3><div class="pool-karten">' + gruppen[g].map(karte).join('') + '</div></section>').join('')
      : '<p class="muted">Noch keine öffentlichen Proben.</p>';
  }

  function detail(e) {
    const l = e.labor || {};
    const zeilen = WERTE.filter(([k]) => l[k] != null).map(([k, n, u, d]) => '<tr><td>' + n + '</td><td class="num"><b>' + fmt(l[k], d) + '</b></td><td class="muted">' + u + '</td></tr>').join('');
    const fakten = [['Futterart', typ(e.typ)], ['Schnittdatum', e.schnitt ? app().dateCH(e.schnitt) : ''], ['Schnitt', e.schnittNr], ['Konservierung', e.konservierung], ['Bestand', e.bestand],
      ['Region', [(e.region || {}).plz, (e.region || {}).ort].filter(Boolean).join(' ')], ['Höhe', e.hoehenstufe || ((e.region || {}).hoehe ? e.region.hoehe + ' m ü. M.' : '')], ['Quelle', e.quelle]].filter((x) => x[1]);
    return '<div class="bar"><a class="icon-btn" href="#/pool" aria-label="Zurück">' + app().I.back + '</a><h2>' + esc(e.titel) + '<span class="sub">' + esc(e.sammlung || 'Probenpool') + '</span></h2></div><div class="pad pool">' +
      '<table class="wi-tab">' + fakten.map(([k, v]) => '<tr><td>' + k + '</td><td>' + esc(v) + '</td></tr>').join('') + '</table>' +
      (e.beschreibung ? '<p>' + esc(e.beschreibung) + '</p>' : '') +
      (zeilen ? '<section class="q"><h3>Laborwerte</h3><table class="wi-tab pool-lab">' + zeilen + '</table></section>' : '') +
      ((e.fotos || []).length ? '<section class="q"><h3>Fotos und Laborbericht</h3><div class="fotos">' + e.fotos.map((f) => '<button type="button" class="foto-thumb" data-pool-foto="' + esc(f.id) + '"><img alt="" loading="lazy" src="' + fotoUrl(e, f) + '"><span class="foto-art">' + (f.art === 'labor' ? 'Labor' : 'Futter') + '</span></button>').join('') + '</div></section>' : '') +
      '<p class="hint">Öffentlicher Probenpool der Futterbeurteilung (AGFF). Laborwerte gemäss Prüfbericht; Laborberichte ohne Namen und Adressen. Selbst beurteilen? Probe im Kurs scannen oder eigene Probe anlegen.</p></div>';
  }

  function render(id) {
    laden();
    if (!daten) return '<div class="bar"><h2>Probenpool</h2></div><div class="pad"><p class="muted">Wird geladen …</p></div>';
    if (id) { const e = daten.find((x) => x.id === id); if (e) return detail(e); }
    return '<div class="bar"><h2>Probenpool<span class="sub">Öffentliche Proben mit Laborwerten</span></h2></div><div class="pad pool">' + liste() +
      '<p class="hint">Hier erscheinen Proben, die Kursleitende ausdrücklich öffentlich gestellt haben – ohne Namen und ohne Beurteilungen.</p></div>';
  }

  function handle(e) {
    const t = e.target.closest('[data-pool-foto]'); if (!t) return false;
    const id = app().route().id; const p = daten && daten.find((x) => x.id === id); const f = p && p.fotos.find((x) => x.id === t.dataset.poolFoto);
    if (f) app().sheet('<h2>' + (f.art === 'labor' ? 'Laborbericht' : 'Futterfoto') + '</h2><img class="foto-gross" alt="" src="' + fotoUrl(p, f) + '"><div class="row" style="margin-top:10px"><a class="btn grow" href="' + fotoUrl(p, f) + '" target="_blank" rel="noopener">In neuem Fenster öffnen</a><button class="btn ghost grow" data-close>Schliessen</button></div>');
    return true;
  }

  global.PoolOeffentlich = { render, handle };
})(window);
