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

  function wrap(text, maxChars) {
    const words = String(text).replace(/-/g, '-\u0000').split(/[\s\u0000]+/).filter(Boolean);
    const lines = []; let cur = '';
    words.forEach((w) => {
      const cand = cur ? (cur.endsWith('-') ? cur + w : cur + ' ' + w) : w;
      if (cand.length <= maxChars || !cur) cur = cand; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines;
  }

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
    for (; fs >= 5.6; fs -= 0.4) {
      lines = wrap(text, Math.max(3, Math.floor(avail / (fs * 0.53))));
      if (lines.length * fs * 1.08 <= across && lines.every((l) => l.length * fs * 0.53 <= avail + 2)) break;
    }
    const [x, y] = pt(rm, am);
    let rot = tangential ? am : am - 90;
    let flip = false;
    if (tangential) { if (am > 90 && am < 270) { rot += 180; flip = true; } } else if (am > 180) { rot += 180; flip = true; }
    const lh = fs * 1.08;
    const start = -((lines.length - 1) * lh) / 2;
    const tsp = lines.map((l, i) => '<tspan x="0" y="' + f1(start + i * lh) + '">' + esc(l) + '</tspan>').join('');
    void flip;
    return '<text transform="translate(' + f1(x) + ' ' + f1(y) + ') rotate(' + f1(rot) + ')" font-size="' + f1(fs) +
      '" text-anchor="middle" dominant-baseline="central" fill="' + (o.fill || INK) + '"' + (o.weight ? ' font-weight="' + o.weight + '"' : '') + '>' + tsp + '</text>';
  }

  /**
   * @param {Array} faktoren  Rad-Definition (K3.TYPEN[x].rad)
   * @param {Object} auswahl  {faktorId: optionId}
   * @param {Object} o        {mini, interaktiv, fokus, zentrum:{wert, einheit, label, ton}, titel}
   */
  function render(faktoren, auswahl, o) {
    o = o || {};
    const mini = !!o.mini;
    const R0 = 52, R1 = mini ? 100 : 98, R2 = mini ? 150 : 150, R3 = 194, RT = 204;
    const N = faktoren.reduce((n, f) => n + f.optionen.length, 0);
    const gruppen = [];
    faktoren.forEach((f) => {
      const g = gruppen[gruppen.length - 1];
      if (g && g.name === f.gruppe) g.faktoren.push(f); else gruppen.push({ name: f.gruppe, farbe: f.farbe, faktoren: [f] });
    });
    const GAP = 1.6;
    const usable = 360 - GAP * gruppen.length;
    const step = usable / N;
    let a = GAP / 2;
    const parts = { seg: [], lab: [], ticks: [], grp: [], mid: [] };

    gruppen.forEach((g) => {
      const g0 = a;
      g.faktoren.forEach((f) => {
        const sel = auswahl ? auswahl[f.id] : null;
        const fokus = o.fokus === f.id;
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
          parts.mid.push('<path d="' + arc(R1, R2, am, a1) + '" fill="' + mix(f.farbe, hit ? 0.25 : 0.55) + '" stroke="#fff" stroke-width="1.2"' +
            (o.interaktiv ? ' data-f="' + f.id + '" class="rz-hit"' : '') + '/>');
          if (!mini && m.txt) parts.lab.push(label(m.txt, R1, R2, am, a1, { fs: 8.6 }));
          am = a1;
        });
        f.optionen.forEach((op) => {
          const a0 = a, a1 = a + step;
          const isSel = sel === op.id;
          const dim = sel && !isSel;
          const shade = op.block ? '#d9534f' : f.farbe;
          const fill = isSel ? darker(shade, 0.06) : mix(shade, dim ? 0.78 : 0.42);
          parts.seg.push('<path d="' + arc(R2, R3, a0, a1) + '" fill="' + fill + '" stroke="' + (isSel ? INK : '#fff') + '" stroke-width="' + (isSel ? 2 : 1.2) +
            '"' + (o.interaktiv ? ' data-f="' + f.id + '" data-o="' + op.id + '" class="rz-hit" role="button" aria-label="' + esc(f.frage + ': ' + op.text) + '"' : '') + '/>');
          if (!mini) {
            parts.lab.push(label(op.kurz, R2, R3, a0, a1, { force: 'rad', fs: op.kurz.length > 2 ? 11 : 15, weight: isSel ? 800 : 600, fill: isSel ? '#fff' : INK }));
            const [tx, ty] = pt(RT, (a0 + a1) / 2);
            parts.ticks.push('<circle cx="' + f1(tx) + '" cy="' + f1(ty) + '" r="5.2" fill="' + (isSel ? INK : '#fff') + '" stroke="' + darker(f.farbe, 0.15) + '" stroke-width="1.4"/>');
          }
          a = a1;
        });
        if (fokus && !mini) {
          const f0 = a - f.optionen.length * step;
          parts.seg.push('<path d="' + arc(R0 - 2, RT + 8, f0 - 0.6, a + 0.6) + '" fill="none" stroke="' + INK + '" stroke-width="2.4" stroke-dasharray="5 4" pointer-events="none"/>');
        }
      });
      const g1 = a;
      const allSet = auswahl && g.faktoren.every((f) => auswahl[f.id]);
      parts.grp.push('<path d="' + arc(R0, R1, g0, g1) + '" fill="' + (allSet || mini ? g.farbe : mix(g.farbe, 0.2)) + '" stroke="#fff" stroke-width="1.6"' +
        (o.interaktiv ? ' data-f="' + g.faktoren[0].id + '" class="rz-hit"' : '') + '/>');
      if (!mini) parts.lab.push(label(g.name, R0, R1, g0, g1, { fs: 10, weight: 700 }));
      a = g1 + GAP;
    });

    const z = o.zentrum || {};
    const ton = TON[z.ton] || TON.offen;
    const center = '<circle r="' + (R0 - 3) + '" fill="' + ton + '"/>' + (mini ? '' :
      '<text y="' + (z.label ? -6 : 2) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (String(z.wert || '').length > 3 ? 20 : 26) + '" font-weight="800" fill="#fff">' + esc(z.wert != null ? z.wert : '–') + '</text>' +
      (z.label ? '<text y="18" text-anchor="middle" font-size="8.5" font-weight="600" fill="#fff">' + esc(z.label) + '</text>' : ''));
    const vb = mini ? '-198 -198 396 396' : '-216 -216 432 432';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" class="rad' + (mini ? ' rad-mini' : '') + '" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"' +
      (o.titel ? ' role="img" aria-label="' + esc(o.titel) + '"' : '') + '>' +
      '<circle r="' + (RT + 10) + '" fill="#fff" opacity="' + (mini ? 0 : 1) + '"/>' +
      parts.grp.join('') + parts.mid.join('') + parts.seg.join('') + '<g pointer-events="none">' + parts.ticks.join('') + parts.lab.join('') + center + '</g></svg>';
  }

  global.Rad = { render, TON };
})(typeof window !== 'undefined' ? window : globalThis);
