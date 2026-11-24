/* Futter v2 – Beurteilungsrad als SVG (digitale Fassung der K3-Räder).
 * Innen: Gruppe · Mitte: Beschreibung · Aussen: Ausprägung mit Punkten/Korrektur · Rand: Ankreuz-Kreise.
 */
(function (global) {
  'use strict';

  const TON = { gut: '#2f9e5f', mittel: '#e0ac2b', schlecht: '#e9772e', kritisch: '#c93a32', offen: '#9aa7a1' };
  const INK = '#1d2925';

  function mix(hex, t) { // t=0 → hex, t=1 → weiss
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const m = (c) => Math.round(c + (255 - c) * t);
    return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
  }
  function darker(hex, t) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const m = (c) => Math.round(c * (1 - t));
    return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rad = (deg) => (deg - 90) * Math.PI / 180;
  const pt = (r, deg) => [r * Math.cos(rad(deg)), r * Math.sin(rad(deg))];
  const f1 = (n) => Math.round(n * 100) / 100;

  function arc(r0, r1, a0, a1) {
    const large = a1 - a0 > 180 ? 1 : 0;
    const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
    return 'M' + f1(x0) + ' ' + f1(y0) + 'A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + f1(x1) + ' ' + f1(y1) +
      'L' + f1(x2) + ' ' + f1(y2) + 'A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + f1(x3) + ' ' + f1(y3) + 'Z';
  }

  /**
   * Zeilen umbrechen. «-» bleibt ein echter Bindestrich (Umbruch danach erlaubt). «\u00AD» (weiches Trennzeichen) ist nur
   * eine Trennstelle: auf derselben Zeile unsichtbar, am Zeilenende als «-» sichtbar.
   */
  function wrap(text, maxChars) {
    const words = String(text).replace(/-/g, '-\u0000').replace(/\u00AD/g, '\u00AD\u0000').split(/[\s\u0000]+/).filter(Boolean);
    const lines = []; let cur = '';
    const zeigen = (z) => z.replace(/\u00AD$/, '-').replace(/\u00AD/g, '');
    words.forEach((w) => {
      const cand = cur ? (/[-\u00AD]$/.test(cur) ? cur + w : cur + ' ' + w) : w;
      if (zeigen(cand).length <= maxChars || !cur) cur = cand; else { lines.push(zeigen(cur)); cur = w; }
    });
    if (cur) lines.push(zeigen(cur));
    return lines;
  }
  let pfadNr = 0; // eindeutige IDs für die Textpfade (mehrere Räder und Animationsbilder auf einer Seite)

  /** Platziert Text in einem Ringsegment: tangential wenn genug Bogen, sonst radial. */
  function label(text, r0, r1, a0, a1, opt) {
    const o = opt || {};
    const rm = (r0 + r1) / 2, am = (a0 + a1) / 2;
    const arcLen = (Math.PI * rm * (a1 - a0)) / 180;
    const thick = r1 - r0;
    const tangential = o.force === 'tan' || (o.force !== 'rad' && arcLen > thick * 1.25);
    const avail = tangential ? arcLen - 6 : thick - 6;
    const across = tangential ? thick - 4 : arcLen - 3;
    let fs = o.fs || 9;
    let lines;
    const fsMin = o.min || 5.6; let passt = false;
    for (; fs >= fsMin; fs -= 0.4) {
      lines = wrap(text, Math.max(3, Math.floor(avail / (fs * 0.53))));
      if (lines.length * fs * 1.08 <= across && lines.every((l) => l.length * fs * 0.53 <= avail + 2)) { passt = true; break; }
    }
    if (!passt) { if (o.weglassen) return ''; fs = fsMin; }  // weglassen: lieber kein Text als überlappender
    const [x, y] = pt(rm, am);
    let rot = tangential ? am : am - 90;
    let flip = false;
    const an = ((am % 360) + 360) % 360; // Winkel kann durch die Drehung negativ sein
    if (tangential) { if (an > 90 && an < 270) { rot += 180; flip = true; } } else if (an > 180) { rot += 180; flip = true; }
    const lh = fs * 1.08;
    const start = -((lines.length - 1) * lh) / 2;
    if (tangential && o.krumm !== false) {
      // Gekrümmt: jede Zeile auf einem eigenen Bogen (oben im Uhrzeigersinn, unten umgekehrt, damit lesbar)
      const ext = Math.min(20, (359 - (a1 - a0)) / 2); const b0 = a0 - ext, b1 = a1 + ext;
      const zusatz = (o.weight ? ' font-weight="' + o.weight + '"' : '');
      return lines.map((l, i) => {
        const r = flip ? rm + start + i * lh : rm - start - i * lh;
        const [x0, y0] = pt(r, flip ? b1 : b0), [x1, y1] = pt(r, flip ? b0 : b1);
        const id = 'radtp' + (++pfadNr);
        return '<path id="' + id + '" d="M' + f1(x0) + ' ' + f1(y0) + 'A' + f1(r) + ' ' + f1(r) + ' 0 ' + (b1 - b0 > 180 ? 1 : 0) + ' ' + (flip ? 0 : 1) + ' ' + f1(x1) + ' ' + f1(y1) + '" fill="none"/>' +
          '<text font-size="' + f1(fs) + '" fill="' + (o.fill || INK) + '"' + zusatz + ' dominant-baseline="central"><textPath href="#' + id + '" startOffset="50%" text-anchor="middle">' + esc(l) + '</textPath></text>';
      }).join('');
    }
    const tsp = lines.map((l, i) => '<tspan x="0" y="' + f1(start + i * lh) + '">' + esc(l) + '</tspan>').join('');
    void flip;
    return '<text transform="translate(' + f1(x) + ' ' + f1(y) + ') rotate(' + f1(rot) + ')" font-size="' + f1(fs) +
      '" text-anchor="middle" dominant-baseline="central" fill="' + (o.fill || INK) + '"' + (o.weight ? ' font-weight="' + o.weight + '"' : '') + '>' + tsp + '</text>';
  }

  /**
   * @param {Array} faktoren  Rad-Definition (K3.TYPEN[x].rad)
   * @param {Object} auswahl  {faktorId: optionId}
   * @param {Object} o        {mini, interaktiv, fokus, zoom, zentrum:{wert, einheit, label, ton}, titel}
   *                           zoom (Smartphone): Fokus-Faktor füllt das Bild, der Rest des Rades bleibt am Rand angeschnitten.
   */
  function render(faktoren, auswahl, o) {
    o = o || {};
    const mini = !!o.mini;
    if (!faktoren || !faktoren.length) { // Futter ohne Sensorik-Rad (Grünfutter): Scheibe in der Klassenfarbe
      const z = o.zentrum || {}; const ton = TON[z.ton] || TON.offen;
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (mini ? '-198 -198 396 396' : '-216 -216 432 432') + '" class="rad' + (mini ? ' rad-mini' : '') + '" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"' + (o.titel ? ' role="img" aria-label="' + esc(o.titel) + '"' : '') + '>' +
        '<circle r="196" fill="#8cbf4f" opacity=".25"/><circle r="150" fill="#8cbf4f" opacity=".35"/><circle r="100" fill="' + ton + '"/>' +
        (mini ? '' : '<text y="-8" text-anchor="middle" dominant-baseline="central" font-size="30" font-weight="800" fill="#fff">' + esc(z.wert != null ? z.wert : '–') + '</text><text y="26" text-anchor="middle" font-size="13" font-weight="600" fill="#fff">' + esc(z.label || '') + '</text>') + '</svg>';
    }
    const R0 = 52, R1 = mini ? 100 : 98, R2 = mini ? 150 : 150, R3 = 194, RT = 204;
    const N = faktoren.reduce((n, f) => n + f.optionen.length, 0);
    const gruppen = [];
    faktoren.forEach((f) => {
      const g = gruppen[gruppen.length - 1];
      if (g && g.name === f.gruppe) g.faktoren.push(f); else gruppen.push({ name: f.gruppe, farbe: f.farbe, faktoren: [f] });
    });
    const GAP = 1.6;
    const usable = 360 - GAP * gruppen.length;
    // Lupe (interaktiv): gewählter Faktor bekommt ~40 % des Kreises und wird nach oben gedreht – lesbar und gut zu treffen
    const lupe = !!(o.interaktiv && !mini && ((o.fokus && faktoren.some((f) => f.id === o.fokus)) || o._g));
    const zoom = lupe && !!o.zoom;
    // Zoom: Fokus bekommt je Ausprägung ~25° (84–160°), Bildausschnitt danach; sonst ~40 % des Kreises
    const zSpanVon = (f) => Math.max(84, Math.min(160, f.optionen.length * 25));
    const wFuer = (f) => { // Breiten-Faktor, wenn f der Fokus ist
      const n = f.optionen.length; const rest = N - n;
      return zoom ? Math.max(1, (zSpanVon(f) * rest) / (n * (360 - GAP * gruppen.length - zSpanVon(f)))) : Math.max(1.5, Math.min(3, (0.4 * rest) / (0.6 * n)));
    };
    // G: «Fokus-Anteil» je Faktor (0–1). Normal 1 für den Fokus; während der Animation gleitet er vom alten zum neuen.
    const G = o._g || (lupe ? { [o.fokus]: 1 } : {});
    const gOf = (f) => (lupe ? G[f.id] || 0 : 0);
    const gew = (f) => 1 + gOf(f) * (wFuer(f) - 1);
    const units = faktoren.reduce((n, f) => n + f.optionen.length * gew(f), 0);
    const einheit = usable / units;
    let a = GAP / 2;
    if (o._start != null) a = o._start;
    else if (lupe) { // Mitte des Fokus-Faktors auf 0° (oben) legen
      let x = GAP / 2; let mitte = 0;
      gruppen.forEach((g) => { g.faktoren.forEach((f) => { const w = f.optionen.length * gew(f) * einheit; if (f.id === o.fokus) mitte = x + w / 2; x += w; }); x += GAP; });
      a = GAP / 2 - mitte;
    }
    const RF = R3 + 12; // Fokus ragt heraus
    const a0Start = a;
    const parts = { seg: [], lab: [], ticks: [], grp: [], mid: [] };
    let fokusBereich = null;
    const deck = (html, op) => (!html || op >= 0.999 ? html : (op <= 0.01 ? '' : '<g opacity="' + f1(op) + '">' + html + '</g>'));

    gruppen.forEach((g) => {
      const g0 = a;
      g.faktoren.forEach((f) => {
        const sel = auswahl ? auswahl[f.id] : null;
        const gf = gOf(f);
        const step = einheit * gew(f);
        const big = gf > 0.01;                 // Detailtexte (ein-/ausgeblendet mit gf)
        const r3 = R3 + gf * (RF - R3);
        const dimM = lupe ? 0.68 - 0.13 * gf : 0.55; const dimS = lupe ? 0.6 - 0.18 * gf : 0.42;
        // Mitte: aufeinanderfolgende Optionen mit gleichem "mitte"-Text zusammenfassen
        const mids = [];
        f.optionen.forEach((op) => {
          const txt = op.mitte || f.mitte || '';
          const last = mids[mids.length - 1];
          if (last && last.txt === txt) last.n++; else mids.push({ txt, n: 1, ids: [] });
          mids[mids.length - 1].ids.push(op.id);
        });
        let am = a;
        mids.forEach((m) => {
          const a1 = am + m.n * step;
          const hit = sel && m.ids.includes(sel);
          parts.mid.push('<path d="' + arc(R1, R2, am, a1) + '" fill="' + mix(f.farbe, hit ? 0.25 : dimM) + '" stroke="#fff" stroke-width="1.2"' +
            (o.interaktiv ? ' data-f="' + f.id + '" class="rz-hit"' : '') + '/>');
          if (!mini && m.txt) {
            if (big) parts.lab.push(deck(label(m.txt, R1, R2, am, a1, { fs: zoom ? 11 : 10, weight: 650 }), gf));
            if (!zoom && gf < 0.99) parts.lab.push(deck(label(m.txt, R1, R2, am, a1, { fs: 8.6, weglassen: true, min: 6.4 }), big ? 1 - gf : 1));
          }
          am = a1;
        });
        f.optionen.forEach((op) => {
          const a0 = a, a1 = a + step;
          const isSel = sel === op.id;
          const dim = sel && !isSel;
          const shade = op.block ? '#d9534f' : f.farbe;
          const fill = isSel ? darker(shade, 0.06) : mix(shade, dim ? 0.78 : dimS);
          parts.seg.push('<path d="' + arc(R2, r3, a0, a1) + '" fill="' + fill + '" stroke="' + (isSel ? INK : '#fff') + '" stroke-width="' + (isSel ? 2 : 1.2) +
            '"' + (o.interaktiv ? ' data-f="' + f.id + '" data-o="' + op.id + '" class="rz-hit" role="button" aria-label="' + esc(f.frage + ': ' + op.text) + '"' : '') + '/>');
          if (!mini && big) {
            // Kriterium ausgeschrieben + Punkte/Korrektur
            const txt = (op.text || '').split(/: | – /)[0];
            parts.lab.push(deck(label(op.kurz === '!' ? '⚠' : op.kurz, r3 - 20, r3, a0, a1, { force: 'tan', fs: op.kurz.length > 2 ? 11 : (zoom ? 15 : 14), weight: 800, fill: isSel ? '#fff' : INK }), gf));
            if (txt && txt !== op.kurz) parts.lab.push(deck(label(txt, R2 + 1, r3 - 19, a0, a1, { fs: zoom ? 9.6 : 8.4, weight: isSel ? 700 : 500, fill: isSel ? '#fff' : INK }), gf));
          }
          if (!mini && gf < 0.99) {
            parts.lab.push(deck(label(op.kurz, R2, r3, a0, a1, { force: 'rad', fs: op.kurz.length > 2 ? 11 : 15, weight: isSel ? 800 : 600, fill: isSel ? '#fff' : INK }), 1 - gf));
          }
          if (!mini) {
            const rPunkt = RT + gf * (RF + 10 - RT);
            const [tx, ty] = pt(rPunkt, (a0 + a1) / 2);
            parts.ticks.push('<circle cx="' + f1(tx) + '" cy="' + f1(ty) + '" r="' + f1(5.2 + gf * 3.3) + '" fill="' + (isSel ? INK : '#fff') + '" stroke="' + darker(f.farbe, 0.15) + '" stroke-width="' + f1(1.4 + gf * 0.8) + '"/>');
            // Unsichtbare Fangfläche vom Feld bis über den Randpunkt hinaus: der Punkt ist das, was man antippen will
            // (auch mit Handschuh). Ohne sie lag er ausserhalb der antippbaren Fläche.
            if (o.interaktiv) parts.seg.push('<path d="' + arc(r3, rPunkt + 18, a0, a1) + '" fill="#000" fill-opacity="0" data-f="' + f.id + '" data-o="' + op.id + '" class="rz-hit rz-fang" aria-hidden="true"/>');
          }
          a = a1;
        });
        if (big && !mini) {
          const f0 = a - f.optionen.length * step; if (f.id === o.fokus) fokusBereich = [f0, a];
          parts.seg.push('<path d="' + arc(R0 - 2, RT + 8 + gf * (RF + 16 - RT - 8), f0 - 0.6, a + 0.6) + '" fill="none" stroke="' + INK + '" stroke-opacity="' + f1(gf) + '" stroke-width="2.4" stroke-dasharray="5 4" pointer-events="none"/>');
        }
      });
      const g1 = a;
      const allSet = auswahl && g.faktoren.every((f) => auswahl[f.id]);
      parts.grp.push('<path d="' + arc(R0, R1, g0, g1) + '" fill="' + (allSet || mini ? g.farbe : mix(g.farbe, 0.2)) + '" stroke="#fff" stroke-width="1.6"' +
        (o.interaktiv ? ' data-f="' + g.faktoren[0].id + '" class="rz-hit"' : '') + '/>');
      if (!mini) { // Zoom: Gruppenname nur über dem Fokus (sonst angeschnitten), während der Animation eingeblendet
        const gz = zoom ? Math.max(...g.faktoren.map(gOf)) : 1;
        const fb = zoom && g.faktoren.find((f) => gOf(f) === gz && gz > 0);
        if (gz > 0.01) {
          let b0 = g0, b1 = g1;
          if (fb) { let x = g0; g.faktoren.forEach((f) => { const w = f.optionen.length * einheit * gew(f); if (f === fb) { b0 = x; b1 = x + w; } x += w; }); }
          parts.lab.push(deck(label(g.name.replace(/-/g, '\u00AD'), R0, R1, b0, b1, { fs: 10, weight: 700, weglassen: lupe, min: 6.4 }), gz));
        }
      }
      a = g1 + GAP;
    });
    void fokusBereich;

    const z = o.zentrum || {};
    const ton = TON[z.ton] || TON.offen;
    const center = '<circle r="' + (R0 - 3) + '" fill="' + ton + '"/>' + (mini ? '' :
      '<text y="' + (z.label ? -6 : 2) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (String(z.wert || '').length > 3 ? 20 : 26) + '" font-weight="800" fill="#fff">' + esc(z.wert != null ? z.wert : '–') + '</text>' +
      (z.label ? '<text y="18" text-anchor="middle" font-size="8.5" font-weight="600" fill="#fff">' + esc(z.label) + '</text>' : ''));
    let vb = mini ? [-198, -198, 396, 396] : (lupe ? [-232, -236, 464, 464] : [-216, -216, 432, 432]);
    const fokusF = faktoren.find((f) => f.id === o.fokus);
    if (zoom && fokusF) { // Ausschnitt um den (nach oben gedrehten) Fokus-Faktor
      const zSpan = zSpanVon(fokusF);
      const th = Math.min(90, zSpan / 2 + 6) * Math.PI / 180; const rA = RF + 22;
      const xh = Math.min(232, rA * Math.sin(th) + 8); const yb = Math.min(12, -(R0 - 8) * Math.cos(th));
      vb = [-xh, -240, 2 * xh, 240 + yb];
    }
    if (o._vb) vb = o._vb;
    if (o.interaktiv && !mini && !o._g) letzteLage = { fokus: fokusF ? o.fokus : null, start: a0Start, vb, faktoren, auswahl, o, zoom: !!o.zoom };
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb.map(f1).join(' ') + '" class="rad' + (mini ? ' rad-mini' : '') + '" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"' +
      (o.titel ? ' role="img" aria-label="' + esc(o.titel) + '"' : '') + '>' +
      '<circle r="' + (RT + 10) + '" fill="#fff" opacity="' + (mini ? 0 : 1) + '"/>' +
      '<g class="rad-dreh">' +
      parts.grp.join('') + parts.mid.join('') + parts.seg.join('') + '<g pointer-events="none">' + parts.ticks.join('') + parts.lab.join('') + '</g></g>' +
      '<g pointer-events="none">' + center + '</g></svg>';
  }

  /**
   * Fokuswechsel animieren: Das Rad wird Bild für Bild neu gezeichnet. Der alte Faktor schrumpft, der neue
   * wächst, und das Rad dreht auf dem kürzesten Weg, bis der neue Faktor oben steht (Texte blenden über).
   */
  let letzteLage = null; let vorher = null; let lauf = 0; let laeuft = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function animieren(root) {
    const svg = root && root.querySelector('svg.rad');
    const jetzt = svg ? letzteLage : null;
    // Wird dasselbe Ziel gleich nochmals gezeichnet (zweites Rendern), läuft die Animation weiter.
    if (laeuft && jetzt && laeuft.ziel === jetzt.fokus && laeuft.faktoren === jetzt.faktoren) { vorher = jetzt; laeuft.jetzt = jetzt; return; }
    const alt = vorher; vorher = jetzt; lauf++; laeuft = null;
    if (!jetzt || !alt || alt.fokus === jetzt.fokus || alt.faktoren !== jetzt.faktoren || alt.zoom !== jetzt.zoom) return;
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const meinLauf = lauf; const dauer = 620; const t0 = performance.now();
    const id = root.id; const box0 = () => (id ? document.getElementById(id) : root);
    const zustand = laeuft = { ziel: jetzt.fokus, faktoren: jetzt.faktoren, jetzt };
    const d = ((jetzt.start - alt.start + 540) % 360) - 180; // kürzester Weg
    const bild = (e) => {
      const G = {}; if (alt.fokus) G[alt.fokus] = 1 - e; if (jetzt.fokus) G[jetzt.fokus] = (G[jetzt.fokus] || 0) + e;  // auch von/zur Übersicht ohne Fokus
      const vb = alt.vb.map((v, i) => v + (jetzt.vb[i] - v) * e);
      const r = box0(); const box = r && r.querySelector('svg.rad'); if (!box) return false;
      const j = zustand.jetzt; // ggf. neuere Auswahl/Anzeige übernehmen
      box.outerHTML = render(j.faktoren, j.auswahl, Object.assign({}, j.o, { _g: G, _start: alt.start + d * e, _vb: vb }));
      return true;
    };
    bild(0);
    const schritt = (now) => {
      if (meinLauf !== lauf || !box0()) { if (laeuft === zustand) laeuft = null; return; } // neuer Zustand: abbrechen
      const t = Math.min(1, (now - t0) / dauer);
      if (t < 1) { if (!bild(ease(t))) { laeuft = null; return; } requestAnimationFrame(schritt); }
      else { laeuft = null; const r = box0(); const box = r && r.querySelector('svg.rad'); const j = zustand.jetzt; if (box) box.outerHTML = render(j.faktoren, j.auswahl, j.o); }
    };
    requestAnimationFrame(schritt);
  }

  global.Rad = { render, animieren, TON };
})(typeof window !== 'undefined' ? window : globalThis);
