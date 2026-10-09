/* Futter v2 – Laborbericht lesen und mit der eigenen Schätzung vergleichen.
 *
 * Wege: «Server» (Tesseract/pdftotext, nur nach Zustimmung, nichts wird gespeichert) oder
 * «Auf meinem Gerät» (Tesseract.js + pdf.js, lokal gehostet, ~11 MB, werden erst bei Bedarf geladen).
 * Erkannte Werte werden immer zur Kontrolle angezeigt – unsichere sind markiert.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const OCR_CONSENT = '2026-10-o1';

  const FELDER = [
    ['nel', 'NEL', 'MJ/kg TS', 2], ['nev', 'NEV', 'MJ/kg TS', 2], ['apde', 'APDE', 'g/kg TS', 0], ['apdn', 'APDN', 'g/kg TS', 0],
    ['rp', 'Rohprotein', 'g/kg TS', 0], ['ts', 'Trockensubstanz', '%', 1], ['rf', 'Rohfaser', 'g/kg TS', 0], ['ndf', 'NDF', 'g/kg TS', 0],
    ['adf', 'ADF', 'g/kg TS', 0], ['zucker', 'Zucker', 'g/kg TS', 0], ['ra', 'Rohasche', 'g/kg TS', 0], ['ph', 'pH', '', 1],
    ['milchsaeure', 'Milchsäure', 'g/kg TS', 0], ['essigsaeure', 'Essigsäure', 'g/kg TS', 0], ['buttersaeure', 'Buttersäure', 'g/kg TS', 1],
  ];

  // ---------- Parser (gleiche Regeln wie labor_parser.py auf dem Server) ----------
  const PARAM = [
    ['ts', /trocken\s*substanz|^\s*ts\b/i, [80, 1000], 0], ['ra', /roh\s*asche/i, [20, 250], 0], ['rp', /roh\s*protein/i, [30, 400], 0],
    ['rf', /roh\s*faser/i, [50, 500], 0], ['rfe', /roh\s*fett/i, [5, 120], 0], ['zucker', /zucker/i, [0, 350], 0],
    ['ndf', /\b(a?ndf\s*om|ndf)\b/i, [150, 800], 0], ['adf', /\b(adf\s*om|adf)\b/i, [80, 600], 0], ['adl', /\badl\b/i, [5, 150], 0],
    ['vos', /\bvos\b/i, [300, 900], 0], ['apde', /apd\s*e\b/i, [30, 160], 0], ['apdn', /apd\s*n\b/i, [20, 300], 0],
    ['nel', /^\s*nel\b|nettoenergie\s*laktation/i, [2.5, 9], 1], ['nev', /^\s*nev\b|nettoenergie\s*(mast|wachstum)/i, [2.5, 9.5], 1],
    ['ph', /p\s*h[\s-]*wert|^\s*ph\b/i, [3, 8], 1], ['milchsaeure', /milchs[äa]ure/i, [0, 200], 0], ['essigsaeure', /essigs[äa]ure/i, [0, 120], 0],
    ['buttersaeure', /butters[äa]ure/i, [0, 80], 1], ['nh3', /^\s*nh\s*3/i, [0, 60], 1],
  ];
  const AUSSCHLUSS = /verdaul|l[öo]slich|anteil|abbaubar|in\s*%\s*des|kg\s*pro\s*ha|ertr/i;
  function parse(text) {
    const werte = {}; const zeilen = {};
    String(text || '').split(/\r?\n/).forEach((zeile) => {
      const z = zeile.replace(/\|/g, ' ');
      if (!z.trim() || AUSSCHLUSS.test(z)) return;
      PARAM.forEach(([key, rx, [lo, hi], dez]) => {
        if (key in werte) return;
        const m = rx.exec(z); if (!m) return;
        let rest = z.slice(m.index + m[0].length).replace(/\([^)]*\)/g, ' ').replace(/n\s*x\s*6[.,]25/ig, ' ').replace(/\bc\s*\d+:\d+\b/ig, ' ');
        const zm = /\d{1,4}(?:[.,]\d{1,3})?/.exec(rest); if (!zm) return;
        const roh = zm[0]; let w = Number(roh.replace(',', '.'));
        const nach = rest.slice(zm.index + roh.length);
        if (key === 'ts') { if (!/^\s*%/.test(nach) && w > 100) w /= 10; if (w >= 8 && w <= 100) { werte.ts = Math.round(w * 10) / 10; zeilen.ts = zeile.trim().slice(0, 120); } return; }
        if (dez && !/[.,]/.test(roh)) {
          if ((key === 'nel' || key === 'nev') && /^\s*M\s*[J1lI]/i.test(nach)) { /* Dezimalpunkt verloren */ } else if (key === 'ph' && /^\s*$/.test(nach) && w >= 3 && w <= 8) { /* ok */ } else return;
        }
        if (!(w >= lo && w <= hi) && !/[.,]/.test(roh)) { if (w / 10 >= lo && w / 10 <= hi) w /= 10; else if (w / 100 >= lo && w / 100 <= hi) w /= 100; }
        if (w >= lo && w <= hi) { werte[key] = Math.round(w * 100) / 100; zeilen[key] = zeile.trim().slice(0, 120); }
      });
    });
    return { werte, zeilen };
  }

  // ---------- Server ----------
  async function serverLesen(blob) {
    const r = await fetch('api/labor/lesen', { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-OCR-Consent': OCR_CONSENT }, body: blob, credentials: 'omit', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error({ RATE_LIMITED: 'Zu viele Anfragen – bitte später erneut.', TOO_LARGE: 'Datei zu gross (max. 12 MB).', FORMAT: 'Bitte PDF oder Foto (JPEG, PNG, WebP).', NICHT_LESBAR: 'Die Datei konnte nicht gelesen werden.', BESCHAEFTIGT: 'Server ausgelastet – bitte gleich nochmals.' }[j.error] || ('Fehler ' + r.status));
    return j;
  }

  // ---------- Auf dem Gerät ----------
  let tessWorker = null;
  async function tesseract() {
    if (!tessWorker) {
      await global.FutterIO.loadScript('assets/vendor/ocr/tesseract.min.js');
      const base = new URL('assets/vendor/ocr/', location.href).href;
      tessWorker = await global.Tesseract.createWorker('deu', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: true, cacheMethod: 'none' });
      await tessWorker.setParameters({ tessedit_pageseg_mode: '6' });
    }
    return tessWorker;
  }
  /** Schatten entfernen (Helligkeit durch stark weichgezeichnete Fassung teilen) und drehen. */
  function vorbereiten(bild, winkel) {
    const max = 2600; const f = Math.min(1, max / Math.max(bild.width, bild.height));
    const w = Math.round(bild.width * f), h = Math.round(bild.height * f);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.filter = 'grayscale(1)'; ctx.drawImage(bild, 0, 0, w, h);
    const b = document.createElement('canvas'); b.width = w; b.height = h;
    const bctx = b.getContext('2d', { willReadFrequently: true }); bctx.filter = 'grayscale(1) blur(' + Math.round(Math.max(w, h) / 120) + 'px)'; bctx.drawImage(bild, 0, 0, w, h);
    const a = ctx.getImageData(0, 0, w, h); const bg = bctx.getImageData(0, 0, w, h).data; const d = a.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.min(255, (d[i] / (bg[i] + 1)) * 235); d[i] = d[i + 1] = d[i + 2] = v < 150 ? Math.max(0, v - 40) : 255; }
    ctx.putImageData(a, 0, 0);
    if (!winkel) return c;
    const r = document.createElement('canvas'); const quer = winkel % 180 !== 0;
    r.width = quer ? h : w; r.height = quer ? w : h;
    const rctx = r.getContext('2d'); rctx.translate(r.width / 2, r.height / 2); rctx.rotate(winkel * Math.PI / 180); rctx.drawImage(c, -w / 2, -h / 2);
    return r;
  }
  async function bildLaden(blob) { return createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  async function geraetLesen(blob, status) {
    if (blob.type === 'application/pdf' || /\.pdf$/i.test(blob.name || '')) {
      status('Lese PDF …');
      const pdfjs = await import(new URL('assets/vendor/ocr/pdf.min.mjs', location.href).href);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/vendor/ocr/pdf.worker.min.mjs', location.href).href;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
      let text = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 6); i++) {
        const page = await pdf.getPage(i); const tc = await page.getTextContent();
        // Textstücke nach Zeilen (y) gruppieren
        const zeilen = new Map();
        tc.items.forEach((it) => { const y = Math.round(it.transform[5]); const z = zeilen.get(y) || []; z.push(it); zeilen.set(y, z); });
        [...zeilen.entries()].sort((x, y) => y[0] - x[0]).forEach(([, its]) => { text += its.sort((x, y) => x.transform[4] - y.transform[4]).map((it) => it.str).join(' ') + '\n'; });
      }
      if (text.replace(/\s/g, '').length > 80) { const r = parse(text); return Object.assign(r, { quelle: 'pdf-text', sicher: Object.fromEntries(Object.keys(r.werte).map((k) => [k, true])) }); }
      status('PDF ohne Text – erkenne Bild …');
      const page = await pdf.getPage(1); const vp = page.getViewport({ scale: 3 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    }
    status('Lade Texterkennung (einmalig ca. 6 MB) …');
    const worker = await tesseract();
    const bild = await bildLaden(blob);
    let best = { werte: {}, zeilen: {} };
    for (const w of [0, 270, 90, 180]) {
      status('Erkenne Text' + (w ? ' (gedreht ' + w + '°)' : '') + ' …');
      const { data } = await worker.recognize(vorbereiten(bild, w));
      const r = parse(data.text);
      if (Object.keys(r.werte).length > Object.keys(best.werte).length) best = r;
      if (Object.keys(best.werte).length >= 6) break;
    }
    return Object.assign(best, { quelle: 'geraet-ocr', sicher: {} });
  }

  // ---------- Dialoge ----------
  /**
   * Öffnet den Lese-Dialog. opts.fotos: [{id, blob}] vorhandene (geschwärzte) Laborfotos.
   * Liefert Promise<{werte}|null>.
   */
  function dialog(opts) {
    const A = app(); const esc = A.esc; const o = opts || {};
    return new Promise((resolve) => {
      const zugestimmt = A.db.prefs.ocrConsent === OCR_CONSENT;
      A.sheet('<h2>Laborbericht lesen</h2>' +
        '<form id="ocrForm" class="stack"><div><b class="small">Quelle</b><div class="opts" style="margin-top:6px">' +
        (o.fotos || []).map((f, i) => '<label class="opt"><input type="radio" name="quelle" value="foto' + i + '"' + (i === 0 ? ' checked' : '') + ' style="accent-color:var(--brand)"><span class="body"><b>Laborfoto ' + (i + 1) + ' dieser Probe</b><small>bereits geschwärzt gespeichert</small></span></label>').join('') +
        '<label class="opt"><input type="radio" name="quelle" value="datei"' + ((o.fotos || []).length ? '' : ' checked') + ' style="accent-color:var(--brand)"><span class="body"><b>PDF oder Foto wählen</b><small>Digitale PDF-Berichte werden exakt gelesen</small></span></label></div>' +
        '<input type="file" id="ocrDatei" accept="application/pdf,image/*" style="margin-top:8px"></div>' +
        '<div><b class="small">Wo lesen?</b><div class="opts" style="margin-top:6px">' +
        '<label class="opt"><input type="radio" name="wo" value="server" checked style="accent-color:var(--brand)"><span class="body"><b>Auf dem Server (empfohlen)</b><small>Schnell und zuverlässig, auch bei schrägen Fotos</small></span></label>' +
        '<label class="opt"><input type="radio" name="wo" value="geraet" style="accent-color:var(--brand)"><span class="body"><b>Auf meinem Gerät</b><small>Nichts verlässt das Gerät; einmalig ca. 6–11 MB Download, langsamer</small></span></label>' +
        '<label class="opt" style="opacity:.55"><input type="radio" name="wo" value="ki" disabled><span class="body"><b>KI-Auswertung</b><small>in Vorbereitung</small></span></label></div></div>' +
        '<div class="alert info" id="ocrHinweis">' + A.I.lock + '<div><b>Datenschutz:</b> Beim Lesen auf dem Server wird die Datei verschlüsselt (HTTPS) übertragen, nur im Arbeitsspeicher verarbeitet und sofort gelöscht – nichts wird gespeichert. Decken Sie Adresse und Namen <b>vor dem Fotografieren</b> ab oder schwärzen Sie sie.' +
        (zugestimmt ? '' : '<label class="toggle" style="margin-top:8px"><input type="checkbox" name="ok"> <span>Einverstanden (wird auf diesem Gerät gemerkt)</span></label>') + '</div></div>' +
        '<p class="hint" id="ocrMsg"></p><div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Lesen</button></div></form>' +
        '<button class="btn ghost block" id="ocrManuell" style="margin-top:8px">Werte von Hand eingeben</button>', (el) => {
        const msg = el.querySelector('#ocrMsg');
        el.querySelector('#ocrManuell').onclick = () => pruefen({ werte: {}, zeilen: {}, sicher: {}, quelle: 'manuell' }, resolve);
        el.querySelectorAll('[name=wo]').forEach((r) => r.addEventListener('change', () => { el.querySelector('#ocrHinweis').style.display = r.value === 'server' && r.checked ? '' : (el.querySelector('[name=wo]:checked').value === 'server' ? '' : 'none'); }));
        el.querySelector('#ocrForm').addEventListener('submit', async (e) => {
          e.preventDefault(); const fd = new FormData(e.target); const btn = e.target.querySelector('.primary');
          const q = fd.get('quelle'); const wo = fd.get('wo');
          let blob = null;
          if (q && q.startsWith('foto')) blob = o.fotos[Number(q.slice(4))].blob; else blob = el.querySelector('#ocrDatei').files[0];
          if (!blob) { msg.textContent = 'Bitte eine Datei wählen.'; return; }
          if (wo === 'server' && !zugestimmt && fd.get('ok') !== 'on') { msg.textContent = 'Bitte zuerst zustimmen – oder «Auf meinem Gerät» wählen.'; return; }
          btn.disabled = true;
          try {
            let r;
            if (wo === 'server') { A.db.prefs.ocrConsent = OCR_CONSENT; A.save(); msg.textContent = 'Lese auf dem Server …'; r = await serverLesen(blob); }
            else r = await geraetLesen(blob, (t) => { msg.textContent = t; });
            if (!Object.keys(r.werte).length) { msg.textContent = 'Keine Werte erkannt. Tipp: Foto gerade und bei gleichmässigem Licht aufnehmen – oder die Werte von Hand eingeben.'; btn.disabled = false; return; }
            pruefen(r, resolve);
          } catch (er) { msg.textContent = er.message; btn.disabled = false; }
        });
      });
    });
  }

  /** Kontrollansicht: erkannte Werte bearbeiten, unsichere markiert. */
  function pruefen(r, resolve) {
    const A = app(); const esc = A.esc;
    const quelleText = { 'pdf-text': 'aus dem PDF-Text gelesen (exakt)', 'pdf-ocr': 'aus einem gescannten PDF erkannt', ocr: 'per Texterkennung auf dem Server erkannt', 'geraet-ocr': 'per Texterkennung auf dem Gerät erkannt', manuell: 'manuelle Eingabe' }[r.quelle] || '';
    A.sheet('<h2>Laborwerte prüfen</h2><p class="small" style="margin-top:0">' + esc(quelleText) + '. Bitte mit dem Bericht vergleichen – <span style="background:var(--mittel-soft);padding:0 4px;border-radius:4px">gelb</span> = unsicher. Leere Felder werden nicht übernommen.</p>' +
      '<form id="labForm" class="stack"><div class="grid2">' + FELDER.map(([k, l, u]) => {
        const v = r.werte[k]; const unsicher = v != null && r.sicher && r.sicher[k] === false;
        return '<label class="field"><span>' + l + ' <span class="muted">' + u + '</span></span><input class="input" name="' + k + '" inputmode="decimal" value="' + (v != null ? String(v).replace('.', ',') : '') + '"' +
          (unsicher ? ' style="background:var(--mittel-soft);border-color:var(--mittel)"' : '') + (r.zeilen && r.zeilen[k] ? ' title="' + esc(r.zeilen[k]) + '"' : '') + '></label>';
      }).join('') + '</div><div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Übernehmen</button></div></form>', (el) => {
      el.querySelector('#labForm').addEventListener('submit', (e) => {
        e.preventDefault(); const fd = new FormData(e.target); const werte = {};
        FELDER.forEach(([k]) => { const s = String(fd.get(k) || '').replace(',', '.').trim(); const n = Number(s); if (s && isFinite(n)) werte[k] = n; });
        A.closeSheet(); resolve(Object.keys(werte).length ? { werte, quelle: r.quelle } : null);
      });
      // Abbrechen: nur der Knopf oder ein Klick direkt auf den Hintergrund (nicht jeder Klick im Dialog)
      el.closest('.scrim').addEventListener('click', (e) => { if (e.target.closest('button[data-close]') || e.target.classList.contains('scrim')) resolve(null); });
    });
  }

  // ---------- Vergleich eigene Schätzung ↔ Labor ----------
  function vergleich(p, res) {
    const lab = p.labor || {}; const w = res.werte || {};
    const zeilen = [['nel', 'NEL', 'MJ', 2], ['nev', 'NEV', 'MJ', 2], ['apde', 'APDE', 'g', 0], ['apdn', 'APDN', 'g', 0], ['rp', 'RP', 'g', 0], ['rf', 'RF', 'g', 0], ['ndf', 'NDF', 'g', 0], ['zucker', 'Zucker', 'g', 0]]
      .filter(([k]) => lab[k] != null && w[k] != null)
      .map(([k, l, u, d]) => ({ k, l, u, d, s: w[k], lab: lab[k], diff: w[k] - lab[k], pz: lab[k] ? ((w[k] - lab[k]) / lab[k]) * 100 : 0 }));
    return zeilen;
  }
  function lernhinweise(p, z) {
    const t = []; const nel = z.find((x) => x.k === 'nel'); const apde = z.find((x) => x.k === 'apde'); const rf = z.find((x) => x.k === 'rf');
    if (nel && nel.diff > 0.3) t.push('Ihre Energieschätzung liegt deutlich über dem Labor. Häufige Ursachen: Stadium zu jung eingeschätzt, Verluste durch Regen, Bröckeln oder Fehlgärung unterschätzt.');
    if (nel && nel.diff < -0.3) t.push('Ihre Energieschätzung liegt unter dem Labor. Eventuell war das Futter jünger, oder die Abzüge (Rad) waren zu streng.');
    if (rf && Math.abs(rf.pz) > 15) t.push('Die Rohfaser weicht stark ab – ein Hinweis, dass das Entwicklungsstadium neu überdacht werden sollte.');
    if (apde && apde.pz < -12) t.push('Das Labor misst mehr APDE als geschätzt – der Bestand war evtl. kleereicher.');
    if (p.labor && p.labor.ts != null && p.typ === 'gras') {
      const kl = (global.K3.K3B_TS.find((x) => x.id === p.antworten.ts) || {}).tsWert;
      if (kl && Math.abs(kl - p.labor.ts) >= 7) t.push('Auswringprobe: geschätzt ca. ' + kl + ' % TS, Labor ' + p.labor.ts + ' % – die Handprobe lohnt sich zu üben.');
    }
    if (!t.length && nel) t.push(Math.abs(nel.diff) <= 0.2 ? 'Sehr gut: Ihre Energieschätzung trifft das Labor auf ±0,2 MJ NEL.' : 'Ihre Schätzung liegt nahe beim Labor.');
    return t;
  }
  function vergleichHtml(p, res) {
    const A = app();
    const z = vergleich(p, res);
    const lab = p.labor || {};
    const ton = (pz) => (Math.abs(pz) <= 5 ? 'gut' : Math.abs(pz) <= 10 ? 'mittel' : 'schlecht');
    let h = '<div class="card"><div class="row"><b class="grow">Ihre Schätzung im Vergleich zum Labor</b><button class="btn sm ghost" data-act="labor-import" data-id="' + p.id + '">Ändern</button></div>';
    if (z.length) {
      h += '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th></th><th>Schätzung</th><th>Labor</th><th>Abweichung</th></tr></thead><tbody>' +
        z.map((x) => '<tr><td><strong>' + x.l + '</strong> <span class="muted">' + x.u + '</span></td><td>' + A.fmt(x.s, x.d) + '</td><td><strong>' + A.fmt(x.lab, x.d) + '</strong></td><td><span class="chip ' + ton(x.pz) + '">' + (x.diff > 0 ? '+' : '') + A.fmt(x.diff, x.d) + ' (' + (x.pz > 0 ? '+' : '') + A.fmt(x.pz, 0) + ' %)</span></td></tr>').join('') + '</tbody></table></div>';
      h += lernhinweise(p, z).map((t) => '<p class="small" style="margin:10px 0 0">💡 ' + A.esc(t) + '</p>').join('');
    }
    const weitere = Object.keys(lab).filter((k) => !z.find((x) => x.k === k));
    if (weitere.length) h += '<p class="small muted" style="margin:10px 0 0">Weitere Laborwerte: ' + weitere.map((k) => { const f = FELDER.find((x) => x[0] === k); return (f ? f[1] : k) + ' ' + A.fmt(lab[k], f ? f[3] : 1) + (f && f[2] ? ' ' + f[2] : ''); }).join(' · ') + '</p>';
    return h + '</div>' + tabelleHtml(p, res);
  }

  // ---------- Labor im Vergleich zur AGFF-Tabelle ----------
  // Spalten: Schlüssel, Bezeichnung, Einheit, Dezimalen, Massstab für die «Passt das Stadium?»-Suche (null = nicht verwenden)
  const TAB = [['nel', 'NEL', 'MJ', 2, 0.3], ['nev', 'NEV', 'MJ', 2, null], ['apde', 'APDE', 'g', 0, 12], ['apdn', 'APDN', 'g', 0, null], ['rp', 'Rohprotein', 'g', 0, 20],
    ['rf', 'Rohfaser', 'g', 0, 25], ['ndf', 'NDF', 'g', 0, 40], ['adf', 'ADF', 'g', 0, 25], ['zucker', 'Zucker', 'g', 0, null], ['ra', 'Rohasche', 'g', 0, null]];
  /** Erwartete Gehalte gemäss AGFF für die gewählten Angaben (Bestand, Aufwuchs, Stadium bzw. Mais-Bedingungen). */
  function tabellenwert(p, res) {
    const K3 = global.K3;
    if (p.typ === 'mais') {
      const w = (K3.K3C_AUSGANG[0] || {}).w; if (!w) return null;
      const o = {}; K3.K3C_METRIKEN.forEach((m, i) => { if (w[i] != null) o[m] = (res.korrIds || []).reduce((v, id) => v + K3.K3C_KORR[id].w[i], w[i]); });
      return o;
    }
    const tab = app().basisTabelle && app().basisTabelle();
    return tab ? K3.pickBasis(tab, p) : null;
  }
  /** Welche Kombination aus Bestand und Stadium passt am besten zu den Laborwerten? (gleicher Aufwuchs) */
  function bestePassung(p) {
    const K3 = global.K3; const tab = app().basisTabelle && app().basisTabelle(); const lab = p.labor || {};
    const typ = K3.TYPEN[p.typ]; const a = p.antworten || {};
    if (!tab || !typ.basisKons || !a.aufwuchs || !tab[typ.basisKons] || !tab[typ.basisKons][a.aufwuchs]) return null;
    const keys = TAB.filter((t) => t[4] && lab[t[0]] != null);
    if (!keys.some((t) => t[0] === 'nel' || t[0] === 'rf' || t[0] === 'ndf')) return null;
    const liste = [];
    Object.entries(tab[typ.basisKons][a.aufwuchs]).forEach(([bestand, stadien]) => Object.entries(stadien).forEach(([st, w]) => {
      let d = 0; let n = 0; keys.forEach(([k, , , , sk]) => { if (w[k] != null) { d += ((lab[k] - w[k]) / sk) ** 2; n++; } });
      if (n) liste.push({ bestand, stadium: st, d: Math.sqrt(d / n) });
    }));
    liste.sort((x, y) => x.d - y.d);
    const gewaehlt = liste.find((x) => x.bestand === a.bestand && String(x.stadium) === String(a.stadium));
    const gleicherBestand = liste.filter((x) => x.bestand === a.bestand)[0];
    return { beste: liste[0], gewaehlt, gleicherBestand, schluessel: keys.map((t) => t[1]) };
  }
  function tabelleHtml(p, res) {
    const A = app(); const lab = p.labor || {}; const K3 = global.K3;
    const t = tabellenwert(p, res);
    if (!t) return '';
    const zeilen = TAB.filter(([k]) => lab[k] != null && t[k] != null).map(([k, l, u, d]) => ({ k, l, u, d, t: t[k], lab: lab[k], pz: t[k] ? ((lab[k] - t[k]) / t[k]) * 100 : 0 }));
    if (!zeilen.length) return '';
    const silageZucker = (k) => k === 'zucker' && p.typ !== 'heu';
    const ton = (z) => (silageZucker(z.k) ? '' : Math.abs(z.pz) <= 8 ? 'gut' : Math.abs(z.pz) <= 15 ? 'mittel' : 'schlecht');
    const a = p.antworten || {};
    const angaben = p.typ === 'mais' ? 'Maissilage einwandfrei, ' + ({ gt55: 'Kolben > 55 %', 45: 'Kolben 45–55 %', lt45: 'Kolben < 45 %' }[a.kolben] || '') :
      (K3.BESTAND_PLAIN[a.bestand] || a.bestand) + ', ' + (a.aufwuchs === '1' ? '1. Aufwuchs' : 'Folgeaufwuchs') + ', Stadium ' + a.stadium;
    let h = '<div class="card" style="margin-top:12px"><b>Labor im Vergleich zur AGFF-Tabelle</b><p class="small muted" style="margin:4px 0 8px">Erwartet für: ' + A.esc(angaben) + ' (Tabellenwert vor Abzügen für Konservierungsmängel).</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Tabelle</th><th>Labor</th><th>Abw.</th></tr></thead><tbody>' +
      zeilen.map((z) => '<tr><td><strong>' + z.l + '</strong> <span class="muted">' + z.u + '</span></td><td>' + A.fmt(z.t, z.d) + '</td><td><strong>' + A.fmt(z.lab, z.d) + '</strong></td><td>' +
        (silageZucker(z.k) ? '<span class="small muted">in Silage vergoren</span>' : '<span class="chip ' + ton(z) + '">' + (z.pz > 0 ? '+' : '') + A.fmt(z.pz, 0) + ' %</span>') + '</td></tr>').join('') + '</tbody></table></div>';
    const tipps = [];
    const g = (k) => zeilen.find((z) => z.k === k);
    const faser = g('rf') || g('ndf') || g('adf');
    if (faser && faser.pz > 10) tipps.push('Mehr Faser als erwartet: Das Futter war vermutlich älter (späteres Stadium) oder hat Blätter verloren (Bröckelverluste, Regen).');
    if (faser && faser.pz < -10) tipps.push('Weniger Faser als erwartet: eher jüngeres Stadium oder blattreicher Bestand.');
    if (g('rp') && g('rp').pz > 12) tipps.push('Mehr Rohprotein als erwartet: kleereicher Bestand oder starke Stickstoffdüngung.');
    if (g('rp') && g('rp').pz < -12) tipps.push('Weniger Rohprotein als erwartet: gräserreicher, älter oder Blattverluste.');
    if (g('ra') && g('ra').t && lab.ra > 100) tipps.push('Rohasche über 100 g/kg TS: Hinweis auf Verschmutzung mit Erde.');
    if (g('nel') && g('nel').pz < -6 && !(faser && faser.pz > 10)) tipps.push('Weniger Energie als erwartet, ohne höhere Faser: eher Konservierungsverluste (Erwärmung, Fehlgärung, Regen) als ein späteres Stadium.');
    const bp = p.typ !== 'mais' ? bestePassung(p) : null;
    if (bp && bp.beste) {
      const name = (x) => (K3.BESTAND_PLAIN[x.bestand] || x.bestand) + ', Stadium ' + x.stadium;
      const passt = bp.gewaehlt && bp.gewaehlt.d <= bp.beste.d + 0.35;
      h += '<p class="small" style="margin:10px 0 0"><b>Passen Bestand und Stadium?</b> ' + (passt ? '✓ Die Laborwerte passen zu Ihren Angaben' + (bp.beste.bestand !== a.bestand || String(bp.beste.stadium) !== String(a.stadium) ? ' (am besten zu ' + A.esc(name(bp.beste)) + ').' : '.')
        : 'Die Laborwerte passen besser zu <b>' + A.esc(name(bp.beste)) + '</b>' + (bp.beste.bestand !== a.bestand && bp.gleicherBestand && String(bp.gleicherBestand.stadium) !== String(a.stadium) ? ' – beim gewählten Bestand am ehesten zu Stadium ' + bp.gleicherBestand.stadium : '') + '.') +
        ' <span class="muted">Verglichen: ' + bp.schluessel.join(', ') + '.</span></p>';
    }
    h += tipps.map((x) => '<p class="small" style="margin:8px 0 0">💡 ' + A.esc(x) + '</p>').join('');
    return h + '<p class="small muted" style="margin:8px 0 0">Grün ±8 %, gelb ±15 %. Laborwerte streuen auch innerhalb eines Stadiums; die Tabelle gibt typische Werte.</p></div>';
  }

  // ---------- Zeilen mit Position (für automatisches Schwärzen) ----------
  /** Erkennt Textzeilen eines Bildes auf dem Gerät; liefert [{text, bbox:{x0,y0,x1,y1}}] in Bildkoordinaten.
   *  winkel: Drehung im Uhrzeigersinn, mit der gelesen wird – Positionen werden aufs Original zurückgerechnet. */
  async function zeilen(canvas, winkel) {
    const worker = await tesseract();
    const w = canvas.width, h = canvas.height;
    const vor = vorbereiten(canvas, winkel || 0); const f = (winkel % 180 ? h : w) / vor.width;
    const { data } = await worker.recognize(vor);
    let ls = data.lines;
    if (!ls && data.blocks) ls = data.blocks.flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
    const zurueck = (X, Y) => (winkel === 90 ? [Y, h - X] : winkel === 270 ? [w - Y, X] : winkel === 180 ? [w - X, h - Y] : [X, Y]);
    return (ls || []).map((l) => {
      const a = zurueck(l.bbox.x0 * f, l.bbox.y0 * f); const b = zurueck(l.bbox.x1 * f, l.bbox.y1 * f);
      return { text: l.text || '', bbox: { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) } };
    });
  }
  const NAEHRSTOFF = /verdaul|abbaubar|stärke|staerke|mineral|calcium|phosphor|magnesium|kalium|natrium|energie|protein|faser|asche|fett|zucker|säure|saeure|\bnel\b|\bnev\b|\bapd|\bndf|\badf|\badl|\bts\b|ph[\s-]*wert/i;
  const SPALTEN = /^(?=.*\b(resultat|ergebnis|einheit|parameter|methode|messwert|wert|gehalt|analyse)\b)[^\d@]*$/i;
  /** Zeile darf sichtbar bleiben: Analysezeile mit Zahl oder Spaltentitel – nie Adressmerkmale. */
  function istWertzeile(text) {
    const z = String(text || '').replace(/\|/g, ' ').trim();
    if (!z || /@|www\.|https?:|\btel\b|\btelefon|\bfax\b|strasse|str\.|weg\b|gasse|platz\b|\b(herr|frau|familie|fam\.)\b|kunde|auftrag|betrieb|einsender|absender|adresse|\bname\b/i.test(z)) return false;
    if (/\b[1-9]\d{3}\s+[A-ZÄÖÜ][a-zäöüé]{2,}/.test(z)) return false; // PLZ + Ort
    if (SPALTEN.test(z)) return true;
    return /\d/.test(z) && (PARAM.some(([, rx]) => rx.test(z)) || NAEHRSTOFF.test(z));
  }

  global.LaborOCR = { tabelleHtml, bestePassung, zeilen, istWertzeile, dialog, parse, vergleich, vergleichHtml, FELDER, OCR_CONSENT };
})(window);
