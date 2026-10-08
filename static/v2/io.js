/* Futter v2 – Ein-/Ausgabe: Kodierung, PDF mit QR-Code + eingebetteten Daten, Import, v1-Übernahme, Server-Client. */
(function (global) {
  'use strict';
  const MARKER = 'AGFF-FUTTER-V2:';
  const FORMAT = 'agff-futter';

  // ---------- Kodierung: JSON → deflate-raw → base64url ----------
  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function streamBytes(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }
  async function pack(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      try { return 'A' + b64url(await streamBytes(raw, new CompressionStream('deflate-raw'))); } catch (e) { /* Fallback unten */ }
    }
    return 'J' + b64url(raw);
  }
  async function unpack(str) {
    const kind = str[0];
    const bytes = unb64url(str.slice(1));
    let raw;
    if (kind === 'A') raw = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
    else if (kind === 'J') raw = bytes;
    else throw new Error('Unbekanntes Format');
    const obj = JSON.parse(new TextDecoder().decode(raw));
    if (!obj || obj.f !== FORMAT) throw new Error('Keine AGFF-Futterdaten');
    return obj;
  }

  /** Exportpaket ohne Server-Schlüssel und interne Felder. */
  function bundle(anlass, proben) {
    const clean = (p) => { const c = JSON.parse(JSON.stringify(p)); delete c.syncedAt; delete c.dirty; return c; };
    const a = anlass ? { id: anlass.id, titel: anlass.titel, datum: anlass.datum, ort: anlass.ort, notiz: anlass.notiz, updatedAt: anlass.updatedAt } : null;
    return { f: FORMAT, v: 2, exportiert: new Date().toISOString(), anlass: a, proben: proben.map(clean) };
  }

  function appUrl() {
    const p = location.pathname.replace(/[^/]*$/, '');
    return location.origin + (p.endsWith('/v2/') ? p : p.replace(/\/?$/, '/'));
  }

  // ---------- Hilfen ----------
  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = () => { delete scriptCache[src]; rej(new Error('Laden fehlgeschlagen: ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }
  const loadPdfLib = () => loadScript('assets/vendor/jspdf.umd.min.js').then(() => global.jspdf.jsPDF);
  const loadQrLib = () => loadScript('assets/vendor/qrcode.js').then(() => global.qrcode);

  async function qrMatrix(text) {
    const qrcode = await loadQrLib();
    for (const ecc of ['M', 'L']) {
      try {
        const qr = qrcode(0, ecc); qr.addData(text, 'Byte'); qr.make();
        return qr;
      } catch (e) { /* zu lang für diese Stufe */ }
    }
    return null;
  }
  async function qrSvg(text) {
    const qr = await qrMatrix(text);
    if (!qr) return null;
    const n = qr.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ' + (n + 4) + ' ' + (n + 4) + '" shape-rendering="crispEdges"><rect x="-2" y="-2" width="' + (n + 4) + '" height="' + (n + 4) + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  function svgToPng(svg, px) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = px;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px); ctx.drawImage(img, 0, 0, px, px);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  const pdfText = (s) => String(s == null ? '' : s)
    .replace(/[−–—]/g, '-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"').replace(/…/g, '...').replace(/→/g, '->').replace(/[ᵣᵒᵍ​]/g, '').replace(/⅓/g, '1/3');
  const fmt = (v, d) => (v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const DIGITS = { nel: 2, nev: 2 };
  const dig = (m) => (DIGITS[m] != null ? DIGITS[m] : (['ca', 'p', 'mg'].includes(m) ? 1 : 0));
  const TON_RGB = { gut: [47, 158, 95], mittel: [211, 155, 23], schlecht: [226, 112, 31], kritisch: [201, 58, 50], offen: [154, 167, 161] };
  const BRAND = [15, 127, 116];

  // jsPDF.text wirft bei leeren Strings/undefined – zentral abfangen
  function patchText(doc) {
    const orig = doc.text.bind(doc);
    doc.text = (t, x, y, o) => {
      if (t == null || t === '' || (Array.isArray(t) && !t.length)) return doc;
      return orig(Array.isArray(t) ? t.map((l) => l || ' ') : String(t), x, y, o);
    };
    return doc;
  }

  // ---------- PDF ----------
  /**
   * ctx: { anlass, proben, auswertung(probe)→res, wheelSvg(probe,res)→svg, label(probe)→{...}, filename }
   */
  async function makePdf(ctx) {
    const JsPDF = await loadPdfLib();
    const doc = patchText(new JsPDF({ unit: 'mm', format: 'a4', compress: true }));
    const all = bundle(ctx.anlass, ctx.proben);
    const payloadAll = await pack(all);
    doc.setProperties({
      title: pdfText(ctx.titel), subject: MARKER + payloadAll, creator: 'AGFF Futterbeurteilung v2 (Beta)',
      keywords: 'AGFF K3a K3b K3c Futterbeurteilung',
    });
    const multi = ctx.proben.length > 1 || !!ctx.anlass;
    if (multi) await pdfUebersicht(doc, ctx, payloadAll);
    for (let i = 0; i < ctx.proben.length; i++) {
      if (multi || i > 0) doc.addPage();
      await pdfProbe(doc, ctx, ctx.proben[i]);
    }
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text('Seite ' + i + ' / ' + pages, 196, 291, { align: 'right' });
    }
    return doc.output('blob');
  }

  function band(doc, titel, sub) {
    doc.setFillColor(...BRAND); doc.rect(0, 0, 210, 25, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(pdfText(titel), 14, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(pdfText(sub), 14, 19);
    doc.setFontSize(8); doc.text('Futterbeurteilung v2 (Beta)', 196, 12, { align: 'right' });
    doc.text(new Date().toLocaleDateString('de-CH'), 196, 19, { align: 'right' });
  }

  function metaLine(doc, pairs, x, y, maxW) {
    doc.setFontSize(8.5); let cx = x; let cy = y;
    pairs.filter((p) => p[1]).forEach(([k, v]) => {
      const kt = pdfText(k) + ': '; const vt = pdfText(v);
      doc.setFont('helvetica', 'normal'); const kw = doc.getTextWidth(kt);
      doc.setFont('helvetica', 'bold'); const vw = doc.getTextWidth(vt);
      if (cx + kw + vw > x + maxW) { cx = x; cy += 4.6; }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(110); doc.text(kt, cx, cy);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(30); doc.text(vt, cx + kw, cy);
      cx += kw + vw + 6;
    });
    return cy;
  }

  async function drawQr(doc, text, x, y, size) {
    const qr = await qrMatrix(text);
    if (!qr) return false;
    const n = qr.getModuleCount(); const m = size / (n + 2);
    doc.setFillColor(255, 255, 255); doc.rect(x, y, size, size, 'F');
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (qr.isDark(r, c)) { let e = c; while (e + 1 < n && qr.isDark(r, e + 1)) e++; doc.rect(x + m * (c + 1), y + m * (r + 1), m * (e - c + 1) + 0.02, m + 0.02, 'F'); c = e + 1; } else c++;
      }
    }
    return true;
  }

  function footer(doc, hasQr, quelle) {
    doc.setDrawColor(210); doc.line(14, 250, 196, 250);
    doc.setTextColor(30); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text('Wieder öffnen und weiterbearbeiten', 14, 257);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(70);
    const t = (hasQr ? 'QR-Code mit dem Handy scannen – oder diese PDF-Datei in der App unter «Importieren» hochladen. ' : 'Diese PDF-Datei in der App unter «Importieren» hochladen. ') +
      'Alle Eingaben sind in dieser Datei' + (hasQr ? ' und im QR-Code' : '') + ' enthalten; sie wurden dafür nicht auf einem Server gespeichert.';
    doc.text(doc.splitTextToSize(pdfText(t), hasQr ? 132 : 180), 14, 262);
    doc.setFontSize(7.2); doc.setTextColor(120);
    doc.text(doc.splitTextToSize(pdfText(quelle), hasQr ? 132 : 180), 14, 279);
  }

  function chipBox(doc, x, y, w, h, ton, text, sub) {
    doc.setFillColor(...(TON_RGB[ton] || TON_RGB.offen)); doc.roundedRect(x, y, w, h, 2.5, 2.5, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.text(pdfText(text), x + 4, y + 7.2);
    if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(pdfText(sub), x + 4, y + 12.4); }
  }

  function kpi(doc, x, y, w, label, value, unit, sub, subTon) {
    doc.setDrawColor(215); doc.setFillColor(248, 250, 249); doc.roundedRect(x, y, w, 19, 2, 2, 'FD');
    doc.setTextColor(110); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text(pdfText(label), x + 3, y + 5);
    doc.setTextColor(20); doc.setFontSize(15); doc.text(pdfText(value), x + 3, y + 12.5);
    const vw = doc.getTextWidth(pdfText(value));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110); doc.text(pdfText(unit), x + 4 + vw, y + 12.5);
    if (sub) { doc.setFontSize(7.2); if (subTon) doc.setTextColor(...TON_RGB[subTon]); doc.text(pdfText(sub), x + 3, y + 17); }
  }

  function gauge(doc, x, y, w, min, max, value, base, target, label) {
    const px = (v) => x + Math.max(0, Math.min(1, (v - min) / (max - min))) * w;
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const c = t < 0.45 ? [243 + (248 - 243) * t / 0.45, 210 + (231 - 210) * t / 0.45, 207 + (184 - 207) * t / 0.45]
        : [248 + (205 - 248) * Math.min(1, (t - 0.45) / 0.3), 231 + (233 - 231) * Math.min(1, (t - 0.45) / 0.3), 184 + (215 - 184) * Math.min(1, (t - 0.45) / 0.3)];
      doc.setFillColor(c[0], c[1], c[2]); doc.rect(x + (w / steps) * i, y, w / steps + 0.1, 3.2, 'F');
    }
    doc.setFontSize(6.8); doc.setTextColor(120); doc.setFont('helvetica', 'normal');
    doc.text(fmt(min, 1), x, y + 7); doc.text(fmt(max, 1), x + w, y + 7, { align: 'right' });
    if (target != null) { doc.setDrawColor(40); doc.setLineDashPattern([0.8, 0.8], 0); doc.line(px(target), y - 2, px(target), y + 5); doc.setLineDashPattern([], 0); doc.text('Ziel ' + fmt(target, 1), px(target), y + 7, { align: 'center' }); }
    if (base != null && Math.abs(base - value) > 0.005) { doc.setFillColor(150); doc.rect(px(base) - 0.4, y - 1.4, 0.8, 6, 'F'); }
    doc.setFillColor(20); doc.rect(px(value) - 0.7, y - 1.8, 1.4, 6.8, 'F');
    doc.setFontSize(7.5); doc.setTextColor(60); doc.text(pdfText(label), x, y - 3);
  }

  async function pdfProbe(doc, ctx, probe) {
    const res = ctx.auswertung(probe);
    const L = ctx.label(probe, res);
    const typ = global.K3.TYPEN[probe.typ];
    band(doc, 'Futterbeurteilung – ' + typ.titel, 'nach AGFF-Merkblatt ' + typ.merkblatt + (ctx.anlass ? ' · Anlass: ' + ctx.anlass.titel : ''));
    doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(pdfText(L.titel), 14, 35);
    let y = metaLine(doc, L.meta, 14, 41, 182);

    y = Math.max(y + 5, 47);
    const svg = ctx.wheelSvg(probe, res);
    try { doc.addImage(await svgToPng(svg, 1000), 'JPEG', 12, y - 1, 88, 88); } catch (e) { /* Rad optional */ }

    const xr = 106, wr = 90;
    const kl = res.klasse || { label: 'Unvollständig', ton: 'offen' };
    chipBox(doc, xr, y, wr, 15, res.sperre.length ? 'kritisch' : kl.ton, res.sperre.length ? 'Nicht verfüttern' : kl.label, L.klasseSub);
    let ky = y + 19;
    const w = res.werte || {}; const b = res.basis || {};
    const kp = probe.typ === 'mais' ? ['nel', 'nev', 'apde', 'staerke'] : ['nel', 'apde', 'apdn', 'nev'];
    kp.forEach((m, i) => {
      const [lab, unit] = global.K3.METRIK_LABEL[m];
      const sub = res.werte && b[m] != null && Math.abs((w[m] || 0) - b[m]) > 0.004
        ? (probe.typ === 'mais' ? 'Ausgang ' + fmt(b[m], dig(m)) : 'Tabelle ' + fmt(b[m], dig(m)) + ' · ' + (res.korr[m] > 0 ? '+' : '') + fmt(res.korr[m], 0) + ' %') : (res.werte ? 'ohne Korrektur' : '');
      kpi(doc, xr + (i % 2) * (wr / 2 + 1), ky + Math.floor(i / 2) * 21, wr / 2 - 1, lab, fmt(w[m], dig(m)), unit + '/kg TS', sub, (w[m] < b[m]) ? 'kritisch' : null);
    });
    ky += 46;
    if (res.werte && res.werte.nel) gauge(doc, xr + 2, ky + 4, wr - 4, 4, 7.5, res.werte.nel, res.basis && res.basis.nel, res.ziel && res.ziel.nel, 'NEL im Vergleich zum Ziel (MJ/kg TS)');
    ky += 12;
    doc.setFontSize(7.8); doc.setTextColor(50); doc.setFont('helvetica', 'normal');
    [L.mpp, L.mast].filter(Boolean).forEach((t) => {
      const lines = doc.splitTextToSize(pdfText(t), wr);
      doc.text(lines, xr, ky + 3); ky += lines.length * 3.3 + 1.5;
    });

    y = Math.max(y + 92, ky + 10);
    if (res.sperre.length) {
      doc.setFillColor(251, 227, 225); doc.setDrawColor(201, 58, 50); doc.roundedRect(14, y, 182, 9 + 4.2 * (res.sperre.length - 1), 2, 2, 'FD');
      doc.setTextColor(201, 58, 50); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      [...new Set(res.sperre)].forEach((s, i) => doc.text(pdfText('! ' + s), 18, y + 5.8 + i * 4.2));
      y += 13 + 4.2 * (res.sperre.length - 1);
    }

    // Nährwerttabelle links
    const rows = L.tabelle;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20); doc.text('Nährwerte pro kg TS', 14, y + 4);
    const cols = [14, 44, 66, 86, 104]; const tw = 104 - 14 + 6;
    let ty = y + 8;
    doc.setFillColor(238, 242, 239); doc.rect(14, ty, tw, 5.6, 'F');
    doc.setFontSize(7); doc.setTextColor(100);
    ['Kennwert', 'Einheit', L.basisLabel || 'Tabelle', 'Korr.', 'Schätzung'].forEach((h, i) => doc.text(h, i === 0 ? cols[0] + 1 : cols[i] + 14, ty + 3.9, { align: i === 0 ? 'left' : 'right' }));
    ty += 5.6;
    const maxRows = Math.min(rows.length, Math.floor((246 - ty) / 4.6));
    rows.slice(0, maxRows).forEach((r, i) => {
      if (i % 2) { doc.setFillColor(249, 250, 249); doc.rect(14, ty, tw, 4.6, 'F'); }
      doc.setFontSize(8); doc.setTextColor(30); doc.setFont('helvetica', r.key ? 'bold' : 'normal');
      doc.text(pdfText(r.label), cols[0] + 1, ty + 3.3);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(110); doc.text(pdfText(r.unit), cols[1] + 14, ty + 3.3, { align: 'right' });
      doc.setTextColor(60); doc.text(pdfText(r.basis), cols[2] + 14, ty + 3.3, { align: 'right' });
      if (r.korr && r.korr !== '–') doc.setTextColor(...(String(r.korr).startsWith('-') ? TON_RGB.kritisch : TON_RGB.gut)); else doc.setTextColor(150);
      doc.text(pdfText(r.korr || '–'), cols[3] + 14, ty + 3.3, { align: 'right' });
      doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.text(pdfText(r.wert), cols[4] + 14, ty + 3.3, { align: 'right' });
      ty += 4.6;
    });

    // Beurteilung rechts
    const bx = 126, bw = 70; let by = y + 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20); doc.text('Beurteilung', bx, by);
    by += 5;
    L.befunde.forEach((f) => {
      if (by > 245) return;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); doc.setTextColor(90);
      doc.text(pdfText(f.k), bx, by);
      if (f.v2) { doc.setTextColor(...(TON_RGB[f.ton] || [60, 60, 60])); doc.text(pdfText(f.v2), bx + bw, by, { align: 'right' }); }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30); doc.setFontSize(7.8);
      const lines = doc.splitTextToSize(pdfText(f.v || '–'), bw);
      doc.text(lines.slice(0, 2), bx, by + 3.6);
      by += 3.8 + Math.min(2, lines.length) * 3.4 + 1.2;
    });

    const single = global.FutterIO.bundle(ctx.anlass, [probe]);
    const url = appUrl() + '#import=' + (await pack(single));
    const ok = await drawQr(doc, url, 160, 252, 36);
    footer(doc, ok, 'Nährwerte: Agroscope (Fütterungsempfehlungen); Beurteilungsschlüssel AGFF ' + typ.merkblatt + '. Sensorische Schätzung – ersetzt keine Laboranalyse.');
  }

  async function pdfUebersicht(doc, ctx, payloadAll) {
    const a = ctx.anlass;
    band(doc, a ? 'Anlass-Übersicht' : 'Übersicht Proben', a ? (a.titel + (a.datum ? ' · ' + new Date(a.datum).toLocaleDateString('de-CH') : '') + (a.ort ? ' · ' + a.ort : '')) : ctx.proben.length + ' Proben');
    let y = 34;
    doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(pdfText(a ? a.titel : 'Proben'), 14, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(pdfText(ctx.proben.length + ' Proben' + (a && a.notiz ? ' · ' + a.notiz : '')), 14, y + 5.5);
    y += 12;
    const items = ctx.proben.map((p) => ({ p, res: ctx.auswertung(p), L: ctx.label(p, ctx.auswertung(p)) }));

    // Balkendiagramm NEL
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20); doc.text('Energiegehalt (NEL, MJ/kg TS) – Tabellenwert und Schätzung', 14, y);
    y += 4;
    const x0 = 58, x1 = 182, min = 4, max = 7.5;
    const px = (v) => x0 + Math.max(0, Math.min(1, (v - min) / (max - min))) * (x1 - x0);
    const shown = items.slice(0, 18);
    shown.forEach((it, i) => {
      const yy = y + i * 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(40);
      doc.text(pdfText(it.L.titel).slice(0, 30), 14, yy + 3.6);
      doc.setFillColor(238, 242, 239); doc.rect(x0, yy, x1 - x0, 4.6, 'F');
      const w = it.res.werte; const bs = it.res.basis;
      if (bs && bs.nel) { doc.setFillColor(205, 214, 210); doc.rect(x0, yy, px(bs.nel) - x0, 4.6, 'F'); }
      if (w && w.nel) {
        doc.setFillColor(...(TON_RGB[it.res.sperre.length ? 'kritisch' : (it.res.klasse ? it.res.klasse.ton : 'offen')])); doc.rect(x0, yy + 0.8, px(w.nel) - x0, 3, 'F');
        doc.setFont('helvetica', 'bold'); doc.setTextColor(20); doc.text(fmt(w.nel, 2), x1 + 2, yy + 3.6);
      }
      if (it.res.ziel && it.res.ziel.nel) { doc.setFillColor(20); doc.rect(px(it.res.ziel.nel) - 0.3, yy - 0.6, 0.6, 5.8, 'F'); }
    });
    y += shown.length * 6 + 2;
    doc.setFontSize(7); doc.setTextColor(120); doc.setFont('helvetica', 'normal');
    for (let v = 4; v <= 7.5; v += 0.5) doc.text(fmt(v, 1), px(v), y + 2, { align: 'center' });
    doc.text('grau = Tabellenwert vor Korrektur · Farbe = Schätzung nach Beurteilung · Strich = Zielwert', 14, y + 6.5);
    y += 12;

    // Tabelle
    const head = ['Probe', 'Futter', 'Bestand / Stadium', 'Beurteilung', 'NEL', 'APDE', 'APDN', 'RP', 'Milch*', 'Mast**'];
    const cx = [14, 50, 72, 102, 141, 152, 163, 173, 184, 196];
    doc.setFillColor(238, 242, 239); doc.rect(14, y, 182, 6, 'F');
    doc.setFontSize(7); doc.setTextColor(90); doc.setFont('helvetica', 'bold');
    head.forEach((h, i) => doc.text(h, cx[i] + (i >= 4 ? 0 : 1), y + 4, { align: i >= 4 ? 'right' : 'left' }));
    y += 6;
    items.forEach((it, i) => {
      if (y > 236) return;
      if (i % 2) { doc.setFillColor(249, 250, 249); doc.rect(14, y, 182, 5.4, 'F'); }
      const w = it.res.werte || {};
      const cells = [it.L.titel.slice(0, 22), global.K3.TYPEN[it.p.typ].kurz, it.L.bestandStadium || '–', (it.res.sperre.length ? 'Nicht verfüttern' : (it.res.klasse ? it.res.klasse.label : '–')).slice(0, 26),
        fmt(w.nel, 2), fmt(w.apde, 0), fmt(w.apdn, 0), fmt(w.rp, 0), it.L.mppKurz || '–', it.L.mastKurz || '–'];
      doc.setFontSize(7.6); doc.setFont('helvetica', 'normal');
      cells.forEach((c, j) => {
        doc.setTextColor(j === 3 ? 40 : 30);
        if (j === 3) doc.setTextColor(...(TON_RGB[it.res.sperre.length ? 'kritisch' : (it.res.klasse ? it.res.klasse.ton : 'offen')]));
        if (j === 4) doc.setFont('helvetica', 'bold'); else doc.setFont('helvetica', 'normal');
        doc.setFontSize(j === 3 ? 6.8 : 7.6);
        doc.text(pdfText(c), cx[j] + (j >= 4 ? 0 : 1), y + 3.8, { align: j >= 4 ? 'right' : 'left' });
      });
      y += 5.4;
    });
    doc.setFontSize(6.8); doc.setTextColor(120); doc.text('* Milchbildungspotenzial aus dem Grundfutter (kg/Tag), Schätzung wie Futterwert-Rechner v1.  ** Tageszuwachs Muni (g/Tag) aus dem Grundfutter, Agroscope Grünes Buch Kap. 10.', 14, y + 4);
    // Beurteilungsräder als kleine Vielfache
    y += 10;
    const size = 27, gap = 3.2, perRow = 6;
    if (y < 220) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20); doc.text('Beurteilungsräder', 14, y); y += 3;
      for (let i = 0; i < items.length; i++) {
        const col = i % perRow; const row = Math.floor(i / perRow);
        const yy = y + row * (size + 7);
        if (yy + size > 246) break;
        try { doc.addImage(await svgToPng(ctx.wheelSvg(items[i].p, items[i].res), 360), 'JPEG', 14 + col * (size + gap), yy, size, size); } catch (e) { /* optional */ }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(60);
        doc.text(pdfText(items[i].L.titel).slice(0, 22), 14 + col * (size + gap) + size / 2, yy + size + 3, { align: 'center' });
      }
    }

    const url = appUrl() + '#import=' + payloadAll;
    const ok = url.length < 2200 ? await drawQr(doc, url, 160, 252, 36) : false;
    footer(doc, ok, ok ? 'QR-Code und PDF enthalten alle ' + ctx.proben.length + ' Proben dieses Anlasses.' : 'Zu viele Daten für einen einzelnen QR-Code: Jede Probe hat auf ihrer Seite einen eigenen QR-Code. Der Import der PDF-Datei übernimmt den ganzen Anlass.');
  }

  /** Sucht die eingebetteten Daten in einer PDF-Datei (Dokument-Eigenschaft «Betreff»). */
  async function readPdf(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let txt = '';
    for (let i = 0; i < buf.length; i += 0x8000) txt += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const m = txt.match(/AGFF-FUTTER-V2:([AJ][A-Za-z0-9_-]+)/);
    if (!m) {
      // UTF-16BE-kodierte Info-Strings (falls ein anderes Programm die PDF neu gespeichert hat)
      const u = txt.match(/<FEFF([0-9A-Fa-f]+)>/g) || [];
      for (const h of u) {
        const hex = h.slice(5, -1); let s = '';
        for (let i = 0; i < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
        const mm = s.match(/AGFF-FUTTER-V2:([AJ][A-Za-z0-9_-]+)/);
        if (mm) return unpack(mm[1]);
      }
      throw new Error('In dieser PDF wurden keine Futterbeurteilungs-Daten gefunden.');
    }
    return unpack(m[1]);
  }

  async function readFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.pdf') || file.type === 'application/pdf') return readPdf(file);
    const obj = JSON.parse(await file.text());
    if (obj && obj.f === FORMAT) return obj;
    if (obj && obj.f === 'agff-futter-backup') return obj;
    if (obj && obj.eingaben) return { f: 'v1', eintraege: [obj] };
    throw new Error('Unbekanntes Dateiformat.');
  }

  // ---------- v1-Übernahme ----------
  const nearestOpt = (faktor, pts) => {
    if (pts == null || pts === '') return null;
    const v = Number(pts); if (!isFinite(v)) return null;
    let best = null;
    faktor.optionen.forEach((o) => { if (o.p != null && (best == null || Math.abs(o.p - v) < Math.abs(best.p - v))) best = o; });
    return best ? best.id : null;
  };
  /** Mappt einen v1-Eintrag ({eingaben, ergebnisse, probeNr, beurteiler, erstelltAm}) auf eine v2-Probe. */
  function fromV1(e, newId) {
    const ein = e.eingaben || {};
    const erg = e.ergebnisse || {};
    const futterart = ein.futterart || 'Wiesenfutter';
    let typ = null;
    if (/silomais/i.test(futterart) || erg.mode === 'silomais') typ = 'mais';
    else if (ein.konservierung === 'silage') typ = 'gras';
    else if (ein.konservierung === 'hay') typ = 'heu';
    if (!typ) return null;
    const probeNr = e.probeNr || (e.meta && e.meta.probeNr) || '';
    const now = new Date().toISOString();
    const p = {
      id: newId(), typ, anlassId: null, createdAt: e.erstelltAm || now, updatedAt: now, quelle: 'v1',
      kopf: { bez: probeNr.includes('_') ? probeNr.split('_').slice(1).join('_') : (probeNr || 'v1-Probe'), herkunft: ein.probe_lieferant || '',
        beurteiler: e.beurteiler || (e.meta && e.meta.beurteiler) || '', schnitt: ein.schnittdatum || '', notiz: [ein.chargenbeschreibung, ein.kommentar_beurteilung].filter(Boolean).join(' · '), v1ProbeNr: probeNr },
      antworten: {}, rad: {},
    };
    const a = p.antworten;
    if (typ !== 'mais') {
      a.aufwuchs = ein.aufwuchs === 'erster' ? '1' : ein.aufwuchs === 'folge' ? 'f' : undefined;
      a.bestand = ein.bestand ? String(ein.bestand).toUpperCase() : undefined;
      a.stadium = ein.stadium ? String(ein.stadium) : undefined;
    }
    if (typ === 'gras' && String(ein.grassilage_k3b_enabled) !== 'false') {
      a.sauberkeit = { clean: 'sauber', light: 'leicht', strong: 'stark' }[ein.grassilage_cleanliness];
      a.ts = { lt20: 'lt20', '21_30': '30', '31_45': '35', gt45: 'gt45' }[ein.grassilage_ts_class];
      if (ein.grassilage_ph) a.phWert = Number(ein.grassilage_ph);
      const R = global.K3.TYPEN.gras.rad; const f = (id) => R.find((x) => x.id === id);
      // v1 hatte teilweise andere Punkteskalen: nächstliegende Stufe übernehmen
      [['essig', 'grassilage_pts_essig'], ['alkohol', 'grassilage_pts_alkohol'], ['butter', 'grassilage_pts_buttersaeure'],
        ['erwaermung', 'grassilage_pts_erwaermung'], ['schimmel', 'grassilage_pts_schimmel'], ['farbe', 'grassilage_pts_farbe']]
        .forEach(([id, key]) => { const o = nearestOpt(f(id), ein[key]); if (o) p.rad[id] = o; });
    }
    if (typ === 'mais') {
      const k = Number(ein.silomais_kolbenanteil);
      if (isFinite(k) && k > 0) a.kolben = k > 55 ? 'gt55' : k >= 45 ? '45' : 'lt45';
      a.hoch = ein.silomais_schnitthoehe_50 === 'ja';
      a.power = ein.silomais_powermais === 'ja';
    }
    p.kopf.notiz = [p.kopf.notiz, 'Aus v1 übernommen – Sensorik bitte prüfen.'].filter(Boolean).join(' · ');
    return { probe: p, anlassTitel: probeNr.includes('_') ? probeNr.split('_')[0] : null };
  }

  // ---------- Server ----------
  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
    const r = await fetch('api/' + path, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined, cache: 'no-store', credentials: 'omit' });
    let data = null; try { data = await r.json(); } catch (e) { /* leer */ }
    if (!r.ok) { const err = new Error((data && data.error) || ('HTTP ' + r.status)); err.status = r.status; err.data = data; throw err; }
    return data;
  }

  global.FutterIO = { MARKER, pack, unpack, bundle, appUrl, qrSvg, makePdf, readFile, readPdf, fromV1, api, svgToPng, loadScript, fmt, pdfText };
})(window);
