/* Futter v2 – Auswahl für den PDF-Export («Warenkorb»): Musterproben aus dem Pool, Kursproben und eigene Proben
 * sammeln und als Zusammenstellung mit Laborwerten und Sinnenprüfung exportieren. Gespeichert nur auf diesem Gerät.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const esc = (s) => app().esc(s);
  const fmt = (v, d) => (v == null || v === '' ? '–' : app().fmt(v, d));
  const KEY = 'agffV2Auswahl';
  const MAX = 40;

  const lesen = () => { try { const z = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(z) ? z.filter((x) => x && ['pool', 'kurs', 'probe'].includes(x.art)).slice(0, MAX) : []; } catch (e) { return []; } };
  let L = lesen();
  const merken = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) { /* privat */ } };
  const schluessel = (x) => x.art + ':' + (x.art === 'kurs' ? x.aid + '/' + x.kp : x.id);
  const hat = (x) => L.some((y) => schluessel(y) === schluessel(x));

  function knopf(item, gross) {
    const drin = hat(item);
    return '<button type="button" class="btn ' + (gross ? '' : 'sm ') + 'ghost aw-knopf' + (drin ? ' drin' : '') + '" data-aw="toggle" data-aw-item="' + esc(JSON.stringify(item)) + '">' + (drin ? '✓ In der PDF-Auswahl' : '+ Zur PDF-Auswahl') + '</button>';
  }
  function pille() {
    let el = document.getElementById('aw-pille');
    if (!L.length) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('button'); el.id = 'aw-pille'; el.type = 'button'; el.className = 'aw-pille'; el.dataset.aw = 'oeffnen'; document.body.appendChild(el); }
    el.textContent = 'PDF-Auswahl (' + L.length + ')';
  }
  function knoepfeAuffrischen() {
    document.querySelectorAll('[data-aw="toggle"]').forEach((b) => {
      let it = null; try { it = JSON.parse(b.dataset.awItem); } catch (e) { return; }
      const drin = hat(it); b.classList.toggle('drin', drin); b.textContent = drin ? '✓ In der PDF-Auswahl' : '+ Zur PDF-Auswahl';
    });
    pille();
  }

  function sheet() {
    const A = app();
    A.sheet('<h2>PDF-Auswahl</h2><p class="small muted" style="margin-top:0">Zusammenstellung mit Angaben, Laborwerten und Sinnenprüfung. Nur auf diesem Gerät gespeichert.</p>' +
      (L.length ? '<ul class="list aw-liste">' + L.map((x, i) => '<li><span class="aw-art">' + ({ pool: 'Muster', kurs: 'Kurs', probe: 'Eigene' }[x.art]) + '</span><span class="grow">' + esc(x.titel || '') + '</span><button class="icon-btn" data-aw="weg" data-i="' + i + '" aria-label="Entfernen">✕</button></li>').join('') + '</ul>'
        : '<p class="muted">Noch nichts ausgewählt. Mit «+ Zur PDF-Auswahl» bei Musterproben, Kursproben oder im Menü einer eigenen Probe hinzufügen.</p>') +
      '<div class="row" style="margin-top:12px">' + (L.length ? '<button class="btn ghost grow" data-aw="leeren">Leeren</button><button class="btn primary grow" data-aw="pdf">PDF erstellen</button>' : '<button class="btn ghost grow" data-close>Schliessen</button>') + '</div><p class="hint" id="awMsg"></p>');
  }

  // ---------- Daten sammeln ----------
  const median = (a) => { const v = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  function sinnenZeile(probe, name) {
    const res = app().auswertung(probe); const w = res.werte || {};
    return { name, klasse: res.sperre && res.sperre.length ? 'Nicht verfüttern' : (res.klasse ? res.klasse.label : 'unvollständig'), punkte: res.punkte, bs: app().bestandStadium(probe) || '', nel: w.nel, apde: w.apde, rp: w.rp, voll: res.vollstaendig };
  }
  async function sammeln(x) {
    const A = app();
    if (x.art === 'pool') {
      const e = await global.PoolOeffentlich.eintrag(x.id); if (!e) return null;
      return { titel: e.titel, muster: true, quelle: (e.sammlung ? 'Musterprobe «' + e.sammlung + '»' : 'Musterprobe') + (e.quelle ? ' · ' + e.quelle : ''), typ: e.typ,
        fakten: [['Schnittdatum', e.schnitt && A.dateCH(e.schnitt)], ['Schnitt', e.schnittNr], ['Konservierung', e.konservierung], ['Bestand', e.bestand], ['Region', (e.region || {}).plz], ['Höhe', e.hoehenstufe]],
        beschreibung: e.beschreibung, labor: e.labor || null, sinnen: [], sinnenHinweis: 'Im öffentlichen Probenpool sind keine Beurteilungen enthalten.' };
    }
    if (x.art === 'kurs') {
      const d = await global.Kurs.exportDaten(x.aid, x.kp); if (!d) return null;
      const kp = d.kp; const so = kp.standort || {};
      return { titel: kp.bez || ('Probe Nr. ' + kp.nr), muster: !!kp.muster, quelle: 'Kurs «' + d.kurs + '», Nr. ' + kp.nr + (kp.muster && kp.muster.sammlung ? ' · Muster «' + kp.muster.sammlung + '»' : ''), typ: kp.typ,
        fakten: [['Schnittdatum', kp.schnitt && A.dateCH(kp.schnitt)], ['Schnitt', kp.schnittNr], ['Konservierung', kp.konservierung], ['Bestand', kp.botanik], ['Region', so.plz], ['Höhe', kp.hoehenstufe || (so.hoehe ? so.hoehe + ' m ü. M.' : '')]],
        beschreibung: kp.notiz, labor: kp.labor || null,
        sinnen: d.sinnen.map((s, i) => sinnenZeile(s.probe, s.ich ? 'eigene' : (s.name && /^Referenz/.test(s.name) ? s.name : 'Beurteilung ' + (i + 1)))),
        sinnenHinweis: d.gesperrt ? 'Die Beurteilungen der anderen sind erst nach der eigenen Abgabe sichtbar.' : '' };
    }
    const p = A.probeById(x.id); if (!p) return null; const k = p.kopf || {};
    return { titel: k.bez || 'Probe', muster: !!p.muster, quelle: 'Eigene Probe' + (k.herkunft ? ' · ' + k.herkunft : ''), typ: p.typ,
      fakten: [['Schnittdatum', k.schnitt && A.dateCH(k.schnitt)], ['Region', k.plz], ['Höhe', k.hoehe ? k.hoehe + ' m ü. M.' : '']],
      beschreibung: k.notiz, labor: p.labor || null, sinnen: [sinnenZeile(p, k.beurteiler || 'eigene')], sinnenHinweis: '' };
  }

  // ---------- PDF ----------
  async function pdf() {
    const A = app(); const IO = global.FutterIO; const msg = document.getElementById('awMsg');
    if (msg) msg.textContent = 'Stelle zusammen …';
    const daten = [];
    const fehlt = [];
    for (const x of L) { try { const d = await sammeln(x); if (d) daten.push(d); else fehlt.push(x.titel); } catch (e) { fehlt.push(x.titel + ' (' + e.message + ')'); } }
    if (fehlt.length) A.toast('Nicht gefunden: ' + fehlt.join(', '));
    if (!daten.length) { A.toast('Keine Daten gefunden.'); return; }
    await IO.loadScript('assets/vendor/jspdf.umd.min.js');
    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4' }); const T = (s) => IO.pdfText(String(s == null ? '' : s));
    const W = global.PoolOeffentlich.WERTE; const typ = (t) => (global.K3.TYPEN[t] || {}).titel || t;
    let y = 16;
    const neueSeite = (h) => { if (y + h > 282) { doc.addPage(); y = 16; } };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(T('Zusammenstellung Futterproben'), 14, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text(T(daten.length + ' Proben · erstellt am ' + new Date().toLocaleDateString('de-CH') + ' · Futterbeurteilung v2 (AGFF)'), 14, y); doc.setTextColor(0); y += 8;
    // Übersicht
    const sp = [14, 70, 98, 116, 132, 148, 162, 186];
    doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    ['Probe', 'Futterart', 'NEL Lab', 'APDE Lab', 'RP Lab', 'Sinnen n', 'Klasse (häufigste)', 'NEL Schätz.'].forEach((h, i) => doc.text(T(h), sp[i], y)); y += 1.5; doc.line(14, y, 196, y); y += 4; doc.setFont('helvetica', 'normal');
    daten.forEach((d) => {
      neueSeite(6);
      const l = d.labor || {}; const kl = {}; d.sinnen.forEach((s) => { kl[s.klasse] = (kl[s.klasse] || 0) + 1; });
      const haeufig = Object.entries(kl).sort((a, b) => b[1] - a[1])[0];
      const zellen = [(d.muster ? '[Muster] ' : '') + d.titel, typ(d.typ), fmt(l.nel, 1), fmt(l.apde, 0), fmt(l.rp, 0), String(d.sinnen.length), haeufig ? haeufig[0] : '–', fmt(median(d.sinnen.map((s) => s.nel)), 2)];
      zellen.forEach((c, i) => doc.text(T(doc.splitTextToSize(T(c), (sp[i + 1] || 200) - sp[i] - 1)[0]), sp[i], y)); y += 5;
    });
    y += 4;
    // Einzelne Proben
    daten.forEach((d) => {
      neueSeite(40);
      doc.setDrawColor(200); doc.line(14, y, 196, y); y += 6;
      if (d.muster) { doc.setFillColor(91, 63, 196); doc.roundedRect(14, y - 4, 17, 5.5, 1, 1, 'F'); doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('MUSTER', 15.6, y); doc.setTextColor(0); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(T(d.titel), d.muster ? 33 : 14, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90); doc.text(T(typ(d.typ) + ' · ' + d.quelle), 14, y); doc.setTextColor(0); y += 5;
      const f = d.fakten.filter((x) => x[1]);
      if (f.length) { doc.setFontSize(9); f.forEach((x, i) => { doc.text(T(x[0] + ': ' + x[1]), 14 + (i % 2) * 91, y + Math.floor(i / 2) * 4.6); }); y += Math.ceil(f.length / 2) * 4.6 + 1; }
      if (d.beschreibung) { const z = doc.splitTextToSize(T(d.beschreibung), 182); neueSeite(z.length * 4); doc.setFontSize(8.5); doc.text(z, 14, y); y += z.length * 3.8 + 1; }
      const lab = d.labor ? W.filter(([k]) => d.labor[k] != null) : [];
      if (lab.length) {
        neueSeite(8 + Math.ceil(lab.length / 3) * 4.6);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(T('Laborwerte'), 14, y); y += 4.6; doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        lab.forEach(([k, n, u, dg], i) => { doc.text(T(n + ': ' + fmt(d.labor[k], dg) + (u ? ' ' + u : '')), 14 + (i % 3) * 61, y + Math.floor(i / 3) * 4.4); });
        y += Math.ceil(lab.length / 3) * 4.4 + 2;
      }
      neueSeite(10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(T('Sinnenprüfung' + (d.sinnen.length ? ' (' + d.sinnen.length + ')' : '')), 14, y); y += 4.6; doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      if (d.sinnen.length) {
        const ks = [14, 44, 96, 112, 150, 166, 182];
        doc.setTextColor(90); ['', 'Klasse', 'Punkte', 'Bestand / Stadium', 'NEL', 'APDE', 'RP'].forEach((h, i) => doc.text(T(h), ks[i], y)); doc.setTextColor(0); y += 4;
        d.sinnen.forEach((s) => { neueSeite(5); [s.name, s.klasse, s.punkte == null ? '–' : String(s.punkte), s.bs, fmt(s.nel, 2), fmt(s.apde, 0), fmt(s.rp, 0)].forEach((c, i) => doc.text(T(doc.splitTextToSize(T(c), (ks[i + 1] || 200) - ks[i] - 1)[0]), ks[i], y)); y += 4.2; });
        if (d.sinnen.length > 1) { doc.setFont('helvetica', 'bold'); doc.text(T('Median'), 14, y); doc.text(T(fmt(median(d.sinnen.map((s) => s.nel)), 2)), 150, y); doc.text(T(fmt(median(d.sinnen.map((s) => s.apde)), 0)), 166, y); doc.setFont('helvetica', 'normal'); y += 4.2; }
      }
      if (d.sinnenHinweis || !d.sinnen.length) { doc.setTextColor(110); doc.text(T(d.sinnenHinweis || 'Keine Beurteilung vorhanden.'), 14, y); doc.setTextColor(0); y += 4.4; }
      y += 3;
    });
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(130); doc.text(T('Laborwerte gemäss Prüfbericht bzw. Erfassung; Schätzung nach AGFF-Merkblättern K3a/K3b/K3c. Seite ' + i + '/' + n), 14, 291); doc.setTextColor(0); }
    const blob = doc.output('blob'); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'Futterproben_Zusammenstellung.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (msg) msg.textContent = 'PDF erstellt (' + daten.length + ' Proben).';
  }

  function handle(e) {
    const t = e.target.closest('[data-aw]'); if (!t) return false;
    const w = t.dataset.aw;
    if (w === 'toggle') {
      let it = null; try { it = JSON.parse(t.dataset.awItem); } catch (er) { return true; }
      if (hat(it)) L = L.filter((y) => schluessel(y) !== schluessel(it));
      else { if (L.length >= MAX) { app().toast('Höchstens ' + MAX + ' Proben.'); return true; } L.push(it); }
      merken(); knoepfeAuffrischen(); return true;
    }
    if (w === 'oeffnen') { sheet(); return true; }
    if (w === 'weg') { L.splice(Number(t.dataset.i), 1); merken(); pille(); sheet(); return true; }
    if (w === 'leeren') { if (confirm('Auswahl leeren?')) { L = []; merken(); pille(); app().closeSheet(); } return true; }
    if (w === 'pdf') { pdf().catch((er) => app().toast(er.message)); return true; }
    return false;
  }

  global.Auswahl = { knopf, handle, pille, oeffnen: sheet, anzahl: () => L.length, _sammeln: sammeln, _liste: () => L };
  if (document.readyState !== 'loading') setTimeout(pille, 0); else document.addEventListener('DOMContentLoaded', pille);
})(window);
