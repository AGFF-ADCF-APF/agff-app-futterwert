/* Futter v2 – Wiese mit Kamera: Hilfen im Live-Bild, ohne KI. Alles läuft auf dem Gerät, nichts geht an Dritte.
 *
 * 1 Punktraster: Was liegt unter jedem Punkt? (Deckung von oben – nicht der Ertragsanteil; daher nur ein Vorschlag)
 * 2 Lücken: Grünindex ExG = (2G − R − B) / (R + G + B) je Pixel, klassische Bildverarbeitung
 * 3 Messkarte (A4, vier Eckmarken): Perspektive (Homographie), Massstab, Weissabgleich
 * 4 Stadium: Vergleichsbilder aus den AGFF-Unterlagen und eigene Referenzfotos
 * 5 Fotopunkte: dieselbe Stelle über die Zeit, mit halbtransparentem Vorher-Bild
 * Bestimmungshilfe für Pflanzen: pflanzen.js
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const F = () => global.Fotos;
  const K3 = () => global.K3;
  const esc = (s) => app().esc(s);
  const toast = (m) => app().toast(m);
  const fmt = (v, d) => app().fmt(v, d);
  const KEY_FP = 'agffV2Fotopunkte';
  const KEY_REF = 'agffV2Referenzen';
  const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
  const lesen = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const schreiben = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); if (global.Konto) global.Konto.geaendert('wiese'); return true; } catch (e) { toast('Speichern im Browser nicht möglich.'); return false; } };

  // =====================================================================
  // Vollbild-Ansichten (Kamera, Werkzeug auf Standbild)
  // =====================================================================
  const MODUS_WIESE = (global.AGFF_V2 || {}).modus === 'wiese';
  let aktiv = null;
  function ansicht(html, cls) {
    zu();
    const root = document.createElement('div');
    root.className = 'cam' + (cls ? ' ' + cls : '');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.innerHTML = html;
    document.body.appendChild(root);
    document.documentElement.classList.add('cam-offen');
    aktiv = { root, weg: [] };
    return aktiv;
  }
  function zu() {
    if (!aktiv) return;
    const a = aktiv; aktiv = null;
    a.weg.forEach((f) => { try { f(); } catch (e) { /* weiter aufräumen */ } });
    a.root.remove();
    document.documentElement.classList.remove('cam-offen');
  }
  global.addEventListener('hashchange', zu);
  document.addEventListener('keydown', (e) => {
    const sr = document.getElementById('sheet-root');
    if (e.key === 'Escape' && aktiv && !(sr && sr.innerHTML)) zu();
  });
  const kopf = (titel, hilfe) => '<div class="cam-top"><button class="cam-x" data-cam="zu" aria-label="Schliessen">✕</button><div class="cam-t"><b>' + esc(titel) + '</b>' + (hilfe ? '<span>' + hilfe + '</span>' : '') + '</div></div>';
  const kannKamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && global.isSecureContext !== false;

  /**
   * Live-Kamera. opts: titel, hilfe, zeichnen(ctx, w, h, api) je Bild, leiste (HTML), ghost (Bild-URL), lupe (Standbild statt Foto),
   * nachFoto(canvas, api) – sonst schliesst die Kamera und das Promise liefert das Canvas (sichtbarer Ausschnitt, ohne Metadaten).
   */
  function kamera(opts) {
    return new Promise((resolve) => {
      let fertig = false;
      const ende = (v) => { if (!fertig) { fertig = true; resolve(v); } };
      const v = ansicht('<div class="cam-buehne"><video playsinline muted autoplay></video>' +
        (opts.ghost ? '<img class="cam-ghost" alt="" src="' + opts.ghost + '">' : '') + '<canvas class="cam-ov"></canvas><img class="cam-ref" alt="" hidden><div class="cam-info" aria-live="polite"></div><div class="cam-panel" hidden></div></div>' +
        kopf(opts.titel, opts.hilfe) +
        '<div class="cam-unten">' + (opts.leiste || '') +
        (opts.ghost ? '<label class="cam-regler">Vorher-Bild <input type="range" min="0" max="1" step="0.05" value="0.45" data-camr="ghost"></label>' : '') +
        '<label class="cam-regler" data-zoomrow>Zoom <input type="range" min="1" max="4" step="0.1" value="1" data-camr="zoom"></label>' +
        '<div class="cam-ctrl"><button class="cam-btn" data-cam="datei">Galerie</button><button class="cam-shot" data-cam="foto" aria-label="' + (opts.lupe ? 'Standbild ein/aus' : 'Aufnehmen') + '"></button>' +
        '<button class="cam-btn" data-cam="licht" hidden>Licht</button>' + (opts.knopf || '') + '</div></div>' +
        '<input type="file" accept="image/*" capture="environment" hidden>');
      const root = v.root;
      const video = root.querySelector('video'); const ov = root.querySelector('.cam-ov'); const buehne = root.querySelector('.cam-buehne');
      const info = root.querySelector('.cam-info'); const panel = root.querySelector('.cam-panel');
      let stream = null; let track = null; let hwZoom = null; let zoom = 1; let raf = 0; let licht = false;
      v.weg.push(() => { cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); ende(null); });

      function region() {
        const vw = video.videoWidth; const vh = video.videoHeight; const r = buehne.getBoundingClientRect();
        if (!vw || !r.width) return null;
        const s = Math.max(r.width / vw, r.height / vh) * (hwZoom ? 1 : zoom);
        const w = r.width / s; const h = r.height / s;
        return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
      }
      function bildVon(maxKante) {
        const g = region(); if (!g) return null;
        const f = Math.min(1, maxKante / Math.max(g.w, g.h));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(g.w * f)); c.height = Math.max(1, Math.round(g.h * f));
        c.getContext('2d', { willReadFrequently: true }).drawImage(video, g.x, g.y, g.w, g.h, 0, 0, c.width, c.height);
        return c;
      }
      const api = {
        root, bildVon, info: (t) => { info.innerHTML = t || ''; info.hidden = !t; },
        panel: (html) => { panel.innerHTML = html || ''; panel.hidden = !html; },
        ref: (src) => { const im = root.querySelector('.cam-ref'); if (src) { im.src = src; im.hidden = false; } else im.hidden = true; },
        weg: (f) => v.weg.push(f), schliessen: () => zu(),
      };
      api.info('');

      function schleife(t) {
        raf = requestAnimationFrame(schleife);
        const b = buehne.getBoundingClientRect(); const dpr = Math.min(2, global.devicePixelRatio || 1);
        const W = Math.round(b.width * dpr); const H = Math.round(b.height * dpr);
        if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
        const ctx = ov.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, b.width, b.height);
        if (opts.zeichnen && video.videoWidth) opts.zeichnen(ctx, b.width, b.height, api, t);
      }
      function ohneKamera(err) {
        api.info('Live-Kamera nicht verfügbar' + (err && err.name === 'NotAllowedError' ? ' (keine Berechtigung)' : '') + '. Sie können ein Foto mit der Kamera-App aufnehmen – die Hilfen erscheinen danach auf dem Standbild.');
        const b = root.querySelector('[data-cam="datei"]'); b.textContent = 'Foto aufnehmen'; b.classList.add('primary');
        root.querySelector('[data-cam="foto"]').hidden = true; root.querySelector('[data-zoomrow]').hidden = true;
      }
      (async () => {
        if (!kannKamera()) { ohneKamera(); return; }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        } catch (e) { ohneKamera(e); return; }
        if (fertig || !aktiv || aktiv.root !== root) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream; track = stream.getVideoTracks()[0];
        try { await video.play(); } catch (e) { /* autoplay */ }
        const cap = track.getCapabilities ? track.getCapabilities() : {};
        if (cap.zoom && cap.zoom.max > cap.zoom.min) { hwZoom = cap.zoom; const r = root.querySelector('[data-camr="zoom"]'); r.min = cap.zoom.min; r.max = Math.min(cap.zoom.max, cap.zoom.min * 8); r.step = cap.zoom.step || 0.1; r.value = cap.zoom.min; }
        if (cap.torch) root.querySelector('[data-cam="licht"]').hidden = false;
        if (opts.start) opts.start(api);
        raf = requestAnimationFrame(schleife);
      })();

      const datei = root.querySelector('input[type=file]');
      datei.onchange = async () => {
        const file = datei.files[0]; if (!file) return;
        try { const c = await F().vorbereiten(file, 'futter'); if (opts.nachFoto) opts.nachFoto(c, api); else { ende(c); zu(); } } catch (e) { toast(e.message); }
      };
      root.addEventListener('input', (e) => {
        const r = e.target.closest('[data-camr]'); if (!r) return;
        if (r.dataset.camr === 'ghost') { const g = root.querySelector('.cam-ghost'); if (g) g.style.opacity = r.value; }
        if (r.dataset.camr === 'zoom') {
          if (hwZoom && track) track.applyConstraints({ advanced: [{ zoom: Number(r.value) }] }).catch(() => {});
          else { zoom = Number(r.value); video.style.transform = 'scale(' + zoom + ')'; }
        }
      });
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cam]');
        if (!b) { if (opts.klick) opts.klick(e, api); return; }
        const w = b.dataset.cam;
        if (w === 'zu') zu();
        else if (w === 'datei') { datei.click(); }
        else if (w === 'licht' && track) { licht = !licht; track.applyConstraints({ advanced: [{ torch: licht }] }).catch(() => {}); b.classList.toggle('on', licht); }
        else if (w === 'foto') {
          if (opts.lupe) { if (video.paused) video.play(); else video.pause(); b.classList.toggle('on', video.paused); return; }
          const c = bildVon(opts.max || 1600); if (!c) return;
          if (navigator.vibrate) try { navigator.vibrate(15); } catch (er) { /* ignore */ }
          if (opts.nachFoto) opts.nachFoto(c, api); else { ende(c); zu(); }
        } else if (opts.klick) opts.klick(e, api);
      });
    });
  }

  /** Werkzeug auf einem Standbild: zeichnen(ctx, px) in Bildkoordinaten (px = Bildpixel je Bildschirmpixel), tippen(pt, art). */
  function werkzeug(canvas, opts) {
    const v = ansicht('<div class="cam-buehne"><canvas class="cam-bild"></canvas></div>' + kopf(opts.titel, opts.hilfe) +
      '<div class="cam-info" aria-live="polite" hidden></div><div class="cam-unten">' + (opts.leiste || '') + '</div>', 'cam-werkzeug');
    const root = v.root; const cv = root.querySelector('.cam-bild'); const buehne = root.querySelector('.cam-buehne');
    let fit = { s: 1, ox: 0, oy: 0 };
    function neu() {
      const b = buehne.getBoundingClientRect(); const dpr = Math.min(2, global.devicePixelRatio || 1);
      cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr);
      const s = Math.min(b.width / canvas.width, b.height / canvas.height);
      fit = { s, ox: (b.width - canvas.width * s) / 2, oy: (b.height - canvas.height * s) / 2 };
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * fit.ox, dpr * fit.oy);
      ctx.drawImage(canvas, 0, 0);
      if (opts.zeichnen) opts.zeichnen(ctx, 1 / s);
    }
    const punkt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - fit.ox) / fit.s, y: (e.clientY - r.top - fit.oy) / fit.s }; };
    let unten = false;
    cv.addEventListener('pointerdown', (e) => { unten = true; cv.setPointerCapture(e.pointerId); if (opts.tippen) opts.tippen(punkt(e), 'down', 1 / fit.s); neu(); });
    cv.addEventListener('pointermove', (e) => { if (unten && opts.tippen) { opts.tippen(punkt(e), 'move', 1 / fit.s); neu(); } });
    cv.addEventListener('pointerup', (e) => { unten = false; if (opts.tippen) opts.tippen(punkt(e), 'up', 1 / fit.s); neu(); });
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-cam="zu"]'); if (b) { zu(); return; } if (opts.klick) opts.klick(e); });
    const ro = new ResizeObserver(neu); ro.observe(buehne); v.weg.push(() => ro.disconnect());
    neu();
    return { root, neu, info: (t) => { const i = root.querySelector('.cam-info'); i.innerHTML = t || ''; i.hidden = !t; }, leiste: (html) => { root.querySelector('.cam-unten').innerHTML = html; } };
  }

  // =====================================================================
  // Bildverarbeitung: Grünindex, Messkarte, Homographie
  // =====================================================================
  const GRUEN = 0.06;   // ExG-Schwelle Pflanze/Boden (normiert); dunkle Pixel (Schatten) zählen nicht
  // null = nicht beurteilbar: Schatten (sehr dunkel) oder Papier/Spiegelung (hell und ungesättigt, z. B. die Messkarte)
  const exg = (r, g, b) => { const s = r + g + b; if (s < 45 || Math.min(r, g, b) > 170) return null; return (2 * g - r - b) / s; };

  /** Live: Grünanteil und Maske (rötlich = nicht grün) auf kleinem Bild. */
  function gruenMaske(c) {
    const ctx = c.getContext('2d', { willReadFrequently: true }); const im = ctx.getImageData(0, 0, c.width, c.height); const d = im.data;
    let gr = 0; let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const e = exg(d[i], d[i + 1], d[i + 2]);
      if (e === null) { d[i + 3] = 0; continue; }
      n++;
      if (e >= GRUEN) { gr++; d[i + 3] = 0; } else { d[i] = 230; d[i + 1] = 60; d[i + 2] = 40; d[i + 3] = 110; }
    }
    ctx.putImageData(im, 0, 0);
    return { anteil: n ? gr / n : null, maske: c };
  }

  // Messkarte A4 hochkant (mm, Ursprung oben links). Eckmarken-Mitten; die Marke oben links hat ein Loch (Orientierung).
  const KARTE = { w: 210, h: 297, m: [[20, 20], [190, 20], [190, 160], [20, 160]], gr: 16, loch: 6 };

  function loese(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
    return x;
  }
  /** Homographie von 4 Punktpaaren (src → dst), 3×3 als Array mit 9 Einträgen. */
  function homographie(src, dst) {
    const A = []; const b = [];
    for (let i = 0; i < 4; i++) {
      const [X, Y] = src[i]; const [x, y] = dst[i];
      A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y]); b.push(x);
      A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y]); b.push(y);
    }
    const h = loese(A, b); return h ? h.concat(1) : null;
  }
  function invers(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h; const B = -(d * i - f * g); const C = d * h - e * g;
    const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  const proj = (m, X, Y) => { const w = m[6] * X + m[7] * Y + m[8]; return { x: (m[0] * X + m[1] * Y + m[2]) / w, y: (m[3] * X + m[4] * Y + m[5]) / w }; };

  /** Sucht die vier Eckmarken der Messkarte. Liefert { ecken (Bildpixel), H (mm→Bild), Hi (Bild→mm), sicher } oder null. */
  function karteFinden(src) {
    const f = Math.min(1, 900 / Math.max(src.width, src.height));
    const w = Math.round(src.width * f); const h = Math.round(src.height * f);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    const N = w * h; const L = new Uint8Array(N); const S = new Uint8Array(N); const hist = new Uint32Array(256);
    for (let i = 0, j = 0; j < N; i += 4, j++) {
      const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
      L[j] = (r * 299 + g * 587 + b * 114) / 1000 | 0; S[j] = Math.max(r, g, b) - Math.min(r, g, b); hist[L[j]]++;
    }
    let acc = 0; let hell = 255; for (let k = 255; k >= 0; k--) { acc += hist[k]; if (acc > N * 0.03) { hell = k; break; } }
    const dunkel = Math.min(110, hell * 0.45); const weiss = Math.max(dunkel * 1.6, hell * 0.62);
    const istWeiss = (j) => L[j] > weiss && S[j] < 75;
    const lab = new Int32Array(N); const stapel = new Int32Array(N); const kand = [];
    for (let j = 0; j < N; j++) {
      if (lab[j] || !(L[j] < dunkel && S[j] < 70)) continue;
      let top = 0; stapel[top++] = j; lab[j] = kand.length + 1;
      let area = 0; let sx = 0; let sy = 0; let x0 = w; let x1 = 0; let y0 = h; let y1 = 0;
      while (top) {
        const q = stapel[--top]; const qx = q % w; const qy = (q - qx) / w;
        area++; sx += qx; sy += qy; if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        const nb = [qx > 0 ? q - 1 : -1, qx < w - 1 ? q + 1 : -1, qy > 0 ? q - w : -1, qy < h - 1 ? q + w : -1];
        for (const n of nb) if (n >= 0 && !lab[n] && L[n] < dunkel && S[n] < 70) { lab[n] = lab[j]; stapel[top++] = n; }
      }
      const bw = x1 - x0 + 1; const bh = y1 - y0 + 1; const fill = area / (bw * bh);
      kand.push({ area, x: sx / area, y: sy / area, bw, bh, fill });
    }
    const gut = kand.filter((k) => {
      if (k.area < 9 || k.area > N * 0.02 || k.bw < 3 || k.bh < 3) return false;
      const ar = k.bw / k.bh; if (ar < 0.4 || ar > 2.5 || k.fill < 0.35) return false;
      const rad = Math.max(k.bw, k.bh) * 0.95; let hellN = 0;
      for (let a = 0; a < 12; a++) {
        const px = Math.round(k.x + rad * Math.cos(a * Math.PI / 6)); const py = Math.round(k.y + rad * Math.sin(a * Math.PI / 6));
        if (px >= 0 && py >= 0 && px < w && py < h && istWeiss(py * w + px)) hellN++;
      }
      if (hellN < 8) return false;
      let lochN = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const px = Math.round(k.x) + dx; const py = Math.round(k.y) + dy; if (px >= 0 && py >= 0 && px < w && py < h && L[py * w + px] > dunkel * 1.3) lochN++; }
      k.loch = lochN >= 5;
      return true;
    }).sort((a, b) => b.area - a.area).slice(0, 18);
    if (gut.length < 4) return null;
    let best = null;
    const innen = (P, u, v) => {
      const x = (1 - v) * ((1 - u) * P[0].x + u * P[1].x) + v * ((1 - u) * P[3].x + u * P[2].x);
      const y = (1 - v) * ((1 - u) * P[0].y + u * P[1].y) + v * ((1 - u) * P[3].y + u * P[2].y);
      return { x: Math.round(x), y: Math.round(y) };
    };
    for (let a = 0; a < gut.length; a++) for (let b = a + 1; b < gut.length; b++) for (let c2 = b + 1; c2 < gut.length; c2++) for (let e = c2 + 1; e < gut.length; e++) {
      const Q = [gut[a], gut[b], gut[c2], gut[e]];
      const amax = Math.max(...Q.map((q) => q.area)); const amin = Math.min(...Q.map((q) => q.area));
      if (amax / amin > 3.5) continue;
      const mx = Q.reduce((s, q) => s + q.x, 0) / 4; const my = Q.reduce((s, q) => s + q.y, 0) / 4;
      const P = Q.slice().sort((p, q) => Math.atan2(p.y - my, p.x - mx) - Math.atan2(q.y - my, q.x - mx));
      let konvex = true; let sgn = 0;
      for (let i = 0; i < 4; i++) {
        const p0 = P[i]; const p1 = P[(i + 1) % 4]; const p2 = P[(i + 2) % 4];
        const cr = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
        if (!sgn) sgn = Math.sign(cr); else if (Math.sign(cr) !== sgn) konvex = false;
      }
      if (!konvex) continue;
      const seite = (i) => Math.hypot(P[(i + 1) % 4].x - P[i].x, P[(i + 1) % 4].y - P[i].y);
      if (Math.min(seite(0), seite(1), seite(2), seite(3)) < 4 * Math.sqrt(amax)) continue;
      let hellN = 0; let n = 0;
      for (const u of [0.25, 0.5, 0.75]) for (const vv of [0.25, 0.5, 0.75]) { const q = innen(P, u, vv); n++; if (q.x >= 0 && q.y >= 0 && q.x < w && q.y < h && istWeiss(q.y * w + q.x)) hellN++; }
      const score = hellN / n + Math.log(amax) * 0.02 - (amax / amin) * 0.01;
      if (hellN / n >= 0.75 && (!best || score > best.score)) best = { P, score };
    }
    if (!best) return null;
    let P = best.P;
    // Orientierung: Marke mit Loch = oben links; sonst lange Seite (170 mm) oben
    let start = P.findIndex((q) => q.loch);
    const sicher = start >= 0 && P.filter((q) => q.loch).length === 1;
    if (!sicher) {
      const s = [0, 1, 2, 3].map((i) => Math.hypot(P[(i + 1) % 4].x - P[i].x, P[(i + 1) % 4].y - P[i].y));
      const r = s[0] + s[2] > s[1] + s[3] ? [0, 2] : [1, 3];
      const yMitte = (i) => (P[i].y + P[(i + 1) % 4].y) / 2;
      start = yMitte(r[0]) <= yMitte(r[1]) ? r[0] : r[1];
    }
    P = [0, 1, 2, 3].map((i) => P[(start + i) % 4]);
    const ecken = P.map((q) => [q.x / f, q.y / f]);
    const H = homographie(KARTE.m, ecken); if (!H) return null;
    const Hi = invers(H); if (!Hi) return null;
    return { ecken, H, Hi, sicher };
  }

  /** Weissabgleich mit dem leeren Feld der Messkarte (Papierweiss → neutral). */
  function weissabgleich(canvas, karte) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let X = 65; X <= 145; X += 20) for (let Y = 55; Y <= 125; Y += 17.5) {
      const q = proj(karte.H, X, Y); const px = Math.round(q.x); const py = Math.round(q.y);
      if (px < 1 || py < 1 || px >= canvas.width - 1 || py >= canvas.height - 1) continue;
      const d = ctx.getImageData(px - 1, py - 1, 3, 3).data;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (n < 30) return false;
    r /= n; g /= n; b /= n;
    if (Math.min(r, g, b) < 60) return false;
    const ziel = Math.max(r, g, b); const k = [ziel / r, ziel / g, ziel / b].map((x) => Math.min(2.2, Math.max(0.6, x)));
    const im = ctx.getImageData(0, 0, canvas.width, canvas.height); const d = im.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * k[0]); d[i + 1] = Math.min(255, d[i + 1] * k[1]); d[i + 2] = Math.min(255, d[i + 2] * k[2]); }
    ctx.putImageData(im, 0, 0);
    return true;
  }
  /** Für Futterfotos (app.js): Farbe mit Messkarte abgleichen, falls im Bild. */
  function farbabgleich(canvas) {
    try { const k = karteFinden(canvas); return !!(k && weissabgleich(canvas, k)); } catch (e) { return false; }
  }

  /** Messkarte als PDF (A4) zum Ausdrucken. */
  /** AGFF-Logo (SVG, eagff.ch) als PNG für jsPDF */
  function logoPng() {
    return new Promise((ok) => {
      const im = new Image();
      im.onload = () => { const c = document.createElement('canvas'); c.width = 600; c.height = Math.round(600 * im.naturalHeight / im.naturalWidth) || 582; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); try { ok(c.toDataURL('image/png')); } catch (e) { ok(null); } };
      im.onerror = () => ok(null); im.src = 'assets/bilder/agff-logo.svg';
    });
  }
  /** Bild (gleiche Herkunft) als PNG-Daten-URL für jsPDF; w/h in Pixeln */
  function bildPng(src) {
    return new Promise((ok) => {
      const im = new Image();
      im.onload = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0); try { ok({ url: c.toDataURL('image/png'), w: c.width, h: c.height }); } catch (e) { ok(null); } };
      im.onerror = () => ok(null); im.src = src;
    });
  }
  /** Lineal an beiden Längsseiten: 0 cm = Unterkante (wie Vorderseite), mm-Teilung */
  function lineal(doc, T) {
    doc.setDrawColor(0); doc.setTextColor(0); doc.setFontSize(6.5);
    for (let mm = 0; mm <= 290; mm++) {
      const y = 297 - mm; const l = mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3.5 : 2;
      doc.setLineWidth(mm % 10 === 0 ? 0.3 : 0.12);
      doc.line(0, y, l, y); doc.line(210 - l, y, 210, y);
      if (mm % 10 === 0 && mm > 0 && mm < 290) { doc.text(String(mm / 10), 6.2, y + 1); doc.text(String(mm / 10), 203.8, y + 1, { align: 'right' }); }
    }
    doc.setFontSize(5.5); doc.text(T('cm'), 6.2, 293.5); doc.text(T('cm'), 203.8, 293.5, { align: 'right' });
  }
  /**
   * Rückseite (doppelseitig, lange Seite): Lineal, Kurzschlüssel Gräser vegetativ mit den LMZ-Zeichnungen des AGFF-Schlüssels,
   * Blattbreite und Blatthäutchen in echter Grösse, 5-m-Kreis (MB 8), Auswringprobe (K3b), QR-Code zur Wiesen-App.
   */
  async function rueckseite(doc, T, logo) {
    doc.addPage(); lineal(doc, T);
    const X = 16; const B = 178; // Inhaltsbereich zwischen den Linealen
    const fett = () => doc.setFont('helvetica', 'bold'); const normal = () => doc.setFont('helvetica', 'normal');
    const txt = (t, x, y, fs, g, opt) => { doc.setFontSize(fs); doc.setTextColor(g); doc.text(T(t), x, y, opt); };
    const box = (x, y, w, h, titel) => { doc.setDrawColor(200); doc.setLineWidth(0.3); doc.roundedRect(x, y, w, h, 2.5, 2.5); doc.setFillColor(31, 138, 76); doc.roundedRect(x, y, w, 7, 2.5, 2.5, 'F'); doc.rect(x, y + 4, w, 3, 'F'); fett(); txt(titel, x + 3, y + 5, 8.5, 255); normal(); };
    fett(); txt('AGFF Messkarte', X, 14, 13, 0); normal(); txt('Rückseite · Lineal an beiden Rändern: 0 cm = Unterkante', X, 19, 7.5, 90);
    if (logo) doc.addImage(logo, 'PNG', X + B - 14, 7, 14, 14 * 249.29 / 256.98);

    // ---- Kurzschlüssel ----
    let y = 26; box(X, y, B, 73, 'Gräser vegetativ – Spalten von links nach rechts prüfen, die erste passende gilt');
    const bilder = await Promise.all(['1a', '1b', '2', '3', '4'].map((k) => bildPng('assets/bilder/schluessel-gv-' + k + '.png')));
    const sp = [['1a', 'Borstenförmig', '< 2 mm', ['Rotschwingel', 'Gem. Rispengras', 'Borstgras']],
      ['1b', 'Doppelrille', '«Skispur»', ['Wiesenrispengras', 'Gem. Rispengras', 'Einj. Rispengras']],
      ['2', 'Behaart', 'Blatt, Scheide, Knoten', ['Wolliges Honiggras', 'Goldhafer', 'Fromental', 'Weiche Trespe']],
      ['3', 'Glänzend', 'Blattunterseite', ['Engl. Raigras', 'Ital. Raigras', 'Wiesenschwingel', 'Kammgras']],
      ['4', 'Matt', 'Unterseite wie oben', ['Knaulgras', 'Timothe', 'Wiesenfuchsschwanz', 'Straussgräser']]];
    const cw = B / 5;
    sp.forEach(([nr, t1, t2, arten], i) => {
      const x = X + i * cw; if (i) { doc.setDrawColor(225); doc.setLineWidth(0.2); doc.line(x, y + 10, x, y + 70); }
      doc.setFillColor(31, 138, 76); doc.circle(x + 6, y + 14, 3.3, 'F'); fett(); txt(nr, x + 6, y + 15.2, 7.5, 255, { align: 'center' });
      txt(t1, x + 11, y + 13.6, 8, 15); normal(); txt(t2, x + 11, y + 17, 6.5, 90);
      const b = bilder[i];
      if (b) {
        const mm = (px) => px / 300 * 25.4 * 1.5; let w = mm(b.w); let h = mm(b.h); const max = cw - 6; if (w > max) { h *= max / w; w = max; }
        const ix = x + (cw - w) / 2; const iy = y + 21 + (24 - h) / 2; doc.addImage(b.url, 'PNG', ix, iy, w, h);
        // Beschriftung wie im AGFF-Schlüssel: Unterschied Spalte 3 / 4 sonst kaum sichtbar
        if (nr === '3') { txt('oben stark gerillt', x + cw / 2, iy - 2, 6.5, 40, { align: 'center' }); fett(); txt('unten glänzend', x + cw / 2, iy + h + 4, 6.8, 20, { align: 'center' }); normal(); }
        if (nr === '4') { txt('glatt', ix + w * 0.22, iy - 2, 6.5, 40, { align: 'center' }); txt('fein gerillt', ix + w * 0.77, iy - 2, 6.5, 40, { align: 'center' }); fett(); txt('unten matt', x + cw / 2, iy + h + 4, 6.8, 20, { align: 'center' }); normal(); }
      }
      arten.forEach((a, j) => txt(a, x + 3, y + 51 + j * 4.6, 7.5, 25));
    });
    txt('Zeichnungen: AGFF-Schlüssel Wiesengräser vegetativ (© edition lmz)', X + B - 2, y + 71.3, 5.5, 130, { align: 'right' });

    // ---- Messen: Blattbreite/Haare und Blatthäutchen (Werte aus dem AGFF-Schlüssel vegetativ) ----
    y = 102; box(X, y, 86, 51, 'Blattbreite und Haare (echte Grösse)'); box(X + 90, y, 88, 51, 'Blatthäutchen');
    doc.setFillColor(35, 35, 35);
    const bx = X + 5; const tl = bx + 29; const td = bx + 43; let by = y + 15; // Balken · Mass · Beschreibung
    doc.rect(bx, by - 1, 26, 2, 'F'); fett(); txt('< 2 mm', tl, by + 1, 7, 15); normal(); txt('borstenförmig (Spalte 1a)', td, by + 1, 6.5, 90);
    by += 9; doc.rect(bx, by - 1.5, 13, 3, 'F'); doc.rect(bx + 13, by - 2, 13, 4, 'F'); fett(); txt('3–4 mm', tl, by + 1, 7, 15); normal(); txt('parallel: Engl. Raigras,', td, by - 0.4, 6.5, 90); txt('Kammgras', td, by + 2.6, 6.5, 90);
    by += 11; doc.triangle(bx, by - 2.5, bx + 26, by - 5, bx + 26, by + 5, 'F'); doc.triangle(bx, by - 2.5, bx, by + 2.5, bx + 26, by + 5, 'F');
    fett(); txt('5–10 mm', tl, by + 1, 7, 15); normal(); txt('konisch: Ital. Raigras,', td, by - 1.9, 6.5, 90); txt('Wiesen-, Rohrschwingel,', td, by + 1.1, 6.5, 90); txt('Wiesenfuchsschwanz', td, by + 4.1, 6.5, 90);
    by += 10; doc.setDrawColor(35); doc.setLineWidth(0.15); for (let i = 0; i < 5; i++) { doc.line(bx + i * 2, by, bx + i * 2 + 0.2, by - 0.5); doc.line(bx + 14 + i * 2.4, by, bx + 14.4 + i * 2.4, by - 1.2); }
    doc.setLineWidth(0.3); doc.line(bx, by, bx + 10, by); doc.line(bx + 14, by, bx + 26, by);
    fett(); txt('Haare', tl, by + 1, 7, 15); normal(); txt('0,5 mm: Wolliges Honiggras', td, by - 0.4, 6.5, 90); txt('> 1 mm: Goldhafer, Fromental …', td, by + 2.6, 6.5, 90);
    // Blatthäutchen: Skala 0–5 mm in echter Grösse, typische Längen als Balken
    const lx = X + 95; const ly = y + 16;
    doc.setDrawColor(0); doc.setLineWidth(0.2); doc.line(lx, ly, lx + 5, ly);
    for (let h = 0; h <= 10; h++) { doc.setLineWidth(h % 2 ? 0.08 : 0.16); doc.line(lx + h / 2, ly, lx + h / 2, ly - (h % 10 === 0 ? 3.5 : h % 2 ? 1.2 : 2.2)); }
    txt('0', lx, ly + 3, 6, 30, { align: 'center' }); txt('5 mm', lx + 5, ly + 3, 6, 30); txt('gegen das Licht halten', lx + 14, ly - 0.5, 6.3, 100);
    doc.setFillColor(35, 35, 35);
    [[0.8, '< 1 mm, derb', 'Wiesenschwingel'], [2, 'ca. 2 mm, durchsichtig', 'Ital. Raigras'], [3, '1–3 mm, robust', 'Wiesenfuchsschwanz'], [1, '0,5–1,5, gestutzt', 'Rotes Straussgras'], [4, '1–4 mm, spitz', 'Ausläufer-Str., Fioringras']]
      .forEach(([l, a, n], i) => { const yy = ly + 8 + i * 3.6; doc.rect(lx, yy - 2, l, 2.2, 'F'); fett(); txt(a, lx + 6, yy, 6.5, 15); normal(); txt(n, lx + 35, yy, 6.5, 70); });
    // ohne Massangabe im Schlüssel – Zeichen wie im AGFF-Schlüssel (Rechteck = gestutzt, Dreieck = zugespitzt), dazu die Blattform
    doc.setDrawColor(200); doc.setLineWidth(0.2); doc.line(lx, ly + 25, lx + 78, ly + 25);
    txt('ohne Mass im Schlüssel:', lx, ly + 28.2, 6, 110);
    doc.setFillColor(178, 214, 140); doc.setDrawColor(110, 170, 50); doc.setLineWidth(0.25);
    doc.rect(lx + 26, ly + 26.4, 3, 1.8, 'FD'); doc.triangle(lx + 26, ly + 33, lx + 29, ly + 33, lx + 27.5, ly + 30, 'FD');
    fett(); txt('kurz, gestutzt', lx + 31, ly + 28.2, 6.5, 15); normal(); txt('Wiesenrispengras', lx + 48, ly + 28.2, 6.5, 70);
    fett(); txt('zugespitzt', lx + 31, ly + 32.6, 6.5, 15); normal(); txt('Gem. Rispengras', lx + 48, ly + 32.6, 6.5, 70);
    const blaetter = await Promise.all(['wr', 'gr'].map((k) => bildPng('assets/bilder/schluessel-gv-blatt-' + k + '.png')));
    // Blattform (oben rechts im Kasten): Wiesenrispe parallel mit Kahnspitze, Gem. Rispe konisch
    blaetter.forEach((bl, i) => { if (!bl) return; const h = 10; const w = h * bl.w / bl.h; doc.addImage(bl.url, 'PNG', lx + 62 + i * 9, ly - 7.5 + (i ? 0.7 : 0), w, h); });
    txt('Wiesenr.', lx + 63.4, ly + 4.8, 5.2, 110, { align: 'center' }); txt('Gem. R.', lx + 72.4, ly + 4.8, 5.2, 110, { align: 'center' });

    // ---- Ährchenlänge (AGFF-Schlüssel ab Rispenschieben): Karten mit den Zeichnungen des Schlüssels, Massstab in echter Grösse ----
    y = 156; box(X, y, B, 50, 'Ährchenlänge ab Rispenschieben (ohne Grannen)');
    const karten = [['timothe', '4–7', 'Timothe,', 'Kammgras …'], ['fuchs', '7 *', 'Wiesen-', 'fuchsschwanz'], ['engl', '10–18', 'Engl. Raigras,', 'Quecke'], ['ital', '22 *', 'Ital. Raigras', ''], ['fieder', '> 18', 'Fiederzwenke', ''],
      ['strauss', '2,5', 'Rotes', 'Straussgras'], ['rispe', '4', 'Rispengräser', '(alle drei)'], ['wolligHG', '5', 'Wolliges', 'Honiggras'], ['gold', '6 *', 'Goldhafer', ''], ['fromental', '8 *', 'Fromental,', 'Rotschwingel'], ['wschw', '10', 'Wiesen-, Rohr-', 'schwingel'], ['aufrecht', '17–25 *', 'Trespen,', 'Flaumhafer']];
    const kbilder = await Promise.all(karten.map((k) => bildPng('assets/bilder/schluessel-gg-' + k[0] + '.png')));
    const kw = (B - 4) / karten.length; const kx0 = X + 2;
    fett(); txt('Ähren', kx0 + 2, y + 11.5, 7, 31); txt('Rispen', kx0 + 5 * kw + 3, y + 11.5, 7, 31); normal();
    doc.setDrawColor(215); doc.setLineWidth(0.25); doc.line(kx0 + 5 * kw, y + 9, kx0 + 5 * kw, y + 41);
    karten.forEach(([k, mm, n1, n2], i) => {
      const cx = kx0 + i * kw + kw / 2; const b = kbilder[i];
      if (b) { const maxH = 17; const maxW = kw - 3; let h = maxH; let w = h * b.w / b.h; if (w > maxW) { w = maxW; h = w * b.h / b.w; } if (b.h < 200) { h = Math.min(h, 9); w = h * b.w / b.h; } doc.addImage(b.url, 'PNG', cx - w / 2, y + 30.5 - h, w, h); }
      fett(); txt(mm, cx, y + 34.5, 7, 15, { align: 'center' }); normal(); txt(n1, cx, y + 37.6, 5.6, 60, { align: 'center' }); if (n2) txt(n2, cx, y + 40.2, 5.6, 60, { align: 'center' });
    });
    // Massstab 0–25 mm in echter Grösse zum Anlegen
    const rx = X + 6; const ry = y + 46.5;
    doc.setDrawColor(0); doc.setLineWidth(0.25); doc.line(rx, ry, rx + 25, ry);
    for (let m = 0; m <= 25; m++) { doc.setLineWidth(m % 5 ? 0.1 : 0.22); doc.line(rx + m, ry, rx + m, ry - (m % 5 ? 1.4 : 2.6)); }
    [0, 5, 10, 15, 20, 25].forEach((m) => txt(String(m), rx + m, ry + 2.6, 5.5, 30, { align: 'center' }));
    txt('mm – Ährchen hier anlegen (echte Grösse)', rx + 28, ry + 0.4, 6.3, 70);
    txt('* mit Grannen · Werte und Zeichnungen: AGFF-Schlüssel Wiesengräser ab Rispenschieben (© edition lmz)', X + B - 2, ry + 0.4, 5.5, 130, { align: 'right' });

    // ---- 5-m-Kreis ----
    y = 209; box(X, y, B, 36, 'Ertragsanteile schätzen – 5-m-Kreis (AGFF-Merkblatt 8)');
    const kx = X + 21; const ky = y + 21.5; const kr = 12;
    doc.setFillColor(170, 210, 140); sektor(doc, kx, ky, kr, -90, 0); doc.setFillColor(210, 232, 190); sektor(doc, kx, ky, kr, 0, 45);
    doc.setDrawColor(60); doc.setLineWidth(0.35); doc.circle(kx, ky, kr); doc.setLineWidth(0.2); doc.line(kx - kr, ky, kx + kr, ky); doc.line(kx, ky - kr, kx, ky + kr);
    doc.setLineDashPattern([0.8, 0.8], 0); doc.line(kx, ky, kx + kr * Math.SQRT1_2, ky + kr * Math.SQRT1_2); doc.setLineDashPattern([], 0);
    fett(); txt('25 %', kx + 6.2, ky - 4.5, 7, 20, { align: 'center' }); txt('12,5 %', kx + 8.6, ky + 4, 6, 20, { align: 'center' }); normal();
    const schritte = ['Kreis von ca. 5 m Durchmesser abtreten, gedanklich vierteln.', 'Zuerst Gräser / Klee / Kräuter, dann die Arten schätzen.', 'Füllt eine Art keinen Viertel: halbieren (1/8, 1/16 …).', 'An einer zweiten Stelle wiederholen, Mittel notieren.', 'In 5-%-Schritten – Blühendes wird gern überschätzt.'];
    schritte.forEach((t, i) => { doc.setFillColor(31, 138, 76); doc.circle(X + 44, y + 12 + i * 5.2, 2.1, 'F'); fett(); txt(String(i + 1), X + 44, y + 13 + i * 5.2, 6.3, 255, { align: 'center' }); normal(); txt(t, X + 49, y + 13.1 + i * 5.2, 7.6, 25); });

    // ---- Auswringprobe + QR ----
    y = 248; box(X, y, 128, 40, 'Auswringprobe Grassilage (TS)');
    const ts = [['< 20 %', 'Saft bei leichtem Pressen'], ['25 %', 'Saft bei starkem Pressen'], ['30 %', 'Saft zwischen den Fingern'], ['35 %', 'feuchte Hände, kein Saft'], ['40 %', 'Hände glänzen noch'], ['45 %', 'leichtes Feuchtegefühl'], ['> 45 %', 'Hände trocken']];
    ts.forEach(([a, b], i) => { const yy = y + 11.3 + i * 3.9; doc.setFillColor(...(i === 3 || i === 4 ? [214, 236, 220] : i % 2 === 0 ? [242, 245, 241] : [255, 255, 255])); doc.rect(X + 2, yy - 2.8, 124, 3.9, 'F'); fett(); txt(a, X + 5, yy, 7.2, 15); normal(); txt(b, X + 24, yy, 7.2, 40); });
    txt('optimal 30–40 % TS (grün) · nach AGFF-Schlüssel K3b', X + 5, y + 38.4, 6, 110);
    box(X + 132, y, 46, 40, 'Wiese-App');
    if (global.FutterIO.qrPdf) await global.FutterIO.qrPdf(doc, (/^(localhost|127\.)/.test(location.hostname) ? global.FutterIO.appUrl() + '#/wiese' : location.origin + '/wiese/'), X + 142.5, y + 7.8, 25);
    txt('Raster · Stadium · Ertrag', X + 155, y + 35.6, 6.2, 60, { align: 'center' }); txt('Pflanzen · Wiesenaufnahme', X + 155, y + 38.2, 6.2, 60, { align: 'center' });
  }
  /** Kreissektor (Grad, 0 = rechts, im Uhrzeigersinn) als gefülltes Polygon */
  function sektor(doc, cx, cy, r, a0, a1) {
    const pts = [[cx, cy]]; for (let a = a0; a <= a1 + 0.01; a += 3) pts.push([cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)]);
    doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), cx, cy, [1, 1], 'F', true);
  }
  async function messkartePdf() {
    const IO = global.FutterIO;
    await IO.loadScript('assets/vendor/jspdf.umd.min.js');
    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4' }); const T = (s) => IO.pdfText(String(s));
    doc.setFillColor(0, 0, 0);
    KARTE.m.forEach(([x, y], i) => {
      doc.rect(x - KARTE.gr / 2, y - KARTE.gr / 2, KARTE.gr, KARTE.gr, 'F');
      if (i === 0) { doc.setFillColor(255, 255, 255); doc.rect(x - KARTE.loch / 2, y - KARTE.loch / 2, KARTE.loch, KARTE.loch, 'F'); doc.setFillColor(0, 0, 0); }
    });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(T('AGFF Messkarte'), 105, 18, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90);
    doc.text(T('AGFF Wiese (Beta) · ohne Skalierung drucken («Tatsächliche Grösse»)'), 105, 23, { align: 'center' });
    // Massstab an beiden Längsseiten, 0 = Unterkante des Blatts (Boden)
    doc.setTextColor(0); doc.setDrawColor(0); doc.setFontSize(7);
    for (let cm = 1; cm <= 28; cm++) {
      const y = 297 - cm * 10;
      [[7, 1], [203, -1]].forEach(([x, s]) => { doc.setLineWidth(cm % 5 ? 0.25 : 0.5); doc.line(x, y, x + s * (cm % 5 ? 3 : 5), y); });
      if (cm % 5 === 0 && y > 32) { doc.text(String(cm), 14, y + 1); doc.text(String(cm), 196, y + 1, { align: 'right' }); }
      for (let mm = 5; mm < 10 && cm < 28; mm += 5) [[7, 1], [203, -1]].forEach(([x, s]) => { doc.setLineWidth(0.15); doc.line(x, y - mm, x + s * 1.5, y - mm); });
    }
    doc.setLineWidth(0.15); doc.setDrawColor(150); doc.rect(KARTE.m[0][0], KARTE.m[0][1], 170, 140);
    doc.setTextColor(60); doc.setFontSize(8.5);
    const zeilen = [
      'Feld innerhalb der Marken frei lassen. Alle vier Marken im Bild, Marke mit Loch oben links.',
      'Bestand: Karte flach auf den Bestand legen, senkrecht von oben fotografieren.',
      'Höhe: Karte senkrecht neben die Pflanzen stellen, Unterkante am Boden.',
      'Farbe: Karte neben Heu oder Silage legen.',
      'Drucken in tatsächlicher Grösse, doppelseitig (lange Seite), am besten auf Karton.',
    ];
    zeilen.forEach((z, i) => doc.text(T(z), 105, 184 + i * 5.6, { align: 'center' }));
    const logo = await logoPng(); if (logo) doc.addImage(logo, 'PNG', 92, 228, 26, 26 * 249.29 / 256.98);
    doc.setFontSize(7); doc.setTextColor(120); doc.text(T('Massstab: 0 cm = Unterkante des Blatts'), 105, 290, { align: 'center' });
    await rueckseite(doc, T, logo);
    const blob = doc.output('blob'); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'AGFF_Messkarte.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // =====================================================================
  // 1+2 Bestand mit Punktraster
  // =====================================================================
  const KLASSEN = [
    { id: 'rg', t: 'Raigras', f: '#1f8a4c', k: 'R' },
    { id: 'gr', t: 'andere Gräser', f: '#8bc34a', k: 'G' },
    { id: 'kl', t: 'Klee', f: '#d0457a', k: 'K' },
    { id: 'kf', t: 'Kraut fein', f: '#f2b705', k: 'f' },
    { id: 'kg', t: 'Kraut grob', f: '#e2701f', k: 'g' },
    { id: 'lu', t: 'Lücke / Boden', f: '#8d6e63', k: '·' },
  ];
  const KL = Object.fromEntries(KLASSEN.map((k) => [k.id, k]));
  const leer = () => ({ rg: 0, gr: 0, kl: 0, kf: 0, kg: 0, lu: 0 });
  let RS = null; // laufende Erhebung { pid, n, k, bilder }

  /** Vorschlag Bestandestyp aus den Punktzahlen (Grenzen wie K3a/K3b). */
  function vorschlag(n) {
    const pfl = n.rg + n.gr + n.kl + n.kf + n.kg;
    if (pfl < 10) return null;
    const gras = (n.rg + n.gr) / pfl; const rg = n.rg + n.gr ? n.rg / (n.rg + n.gr) : 0;
    const kl = n.kl / pfl; const kf = n.kf / pfl; const kg = n.kg / pfl;
    let id; let grenz = false; let notiz = '';
    if (gras > 0.7) id = rg > 0.5 ? 'GR' : 'G';
    else if (gras >= 0.5) id = rg > 0.5 ? 'AR' : 'A';
    else if (kl > 0.5) id = 'L'; else if (kf > 0.5) id = 'KF'; else if (kg > 0.5) id = 'KG';
    else { grenz = true; notiz = 'Keine Gruppe über 50 % – nächstliegender Typ gewählt.'; const m = Math.max(kl, kf, kg); id = m === kl ? 'L' : m === kf ? 'KF' : 'KG'; }
    if (!grenz && ([0.5, 0.7].some((g) => Math.abs(gras - g) < 0.05) || (gras >= 0.5 && Math.abs(rg - 0.5) < 0.05))) { grenz = true; notiz = 'Nahe an einer Grenze – mit eigener Einschätzung abgleichen.'; }
    const total = pfl + n.lu;
    return { id, gras, rg, kl, kf, kg, pfl, total, luecken: total ? n.lu / total : 0, grenz, notiz };
  }
  /** ± (95 %) für einen Anteil bei n Punkten – Zufallsfehler, ohne Klumpung. */
  const unsicher = (p, n) => (n ? 2 * Math.sqrt(p * (1 - p) / n) : 0);

  function rasterLive(ctx, w, h, api, t) {
    const s = Math.min(w, h) * 0.8; const x0 = (w - s) / 2; const y0 = (h - s) / 2;
    if (!rasterLive.t || t - rasterLive.t > 220) {
      rasterLive.t = t;
      const c = api.bildVon(120);
      if (c) { const r = gruenMaske(c); rasterLive.m = r.maske; api.info(r.anteil == null ? 'Zu dunkel' : 'Grün im Bild ≈ ' + Math.round(r.anteil * 100) + ' % · rot = Boden, Streu, Lücken'); }
    }
    if (rasterLive.m) { ctx.imageSmoothingEnabled = true; ctx.drawImage(rasterLive.m, 0, 0, w, h); }
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.strokeRect(x0, y0, s, s); ctx.setLineDash([]);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const x = x0 + s * (0.1 + i * 0.2); const y = y0 + s * (0.1 + j * 0.2);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function rasterPunkte(c, karte) {
    if (karte) {
      const pts = []; const cx = KARTE.w / 2; const cy = KARTE.h / 2;
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const dx = i * 80; const dy = j * 80;
        if (Math.abs(dx) <= 115 && Math.abs(dy) <= 158) continue; // liegt auf der Karte
        const q = proj(karte.H, cx + dx, cy + dy);
        if (q.x >= 0 && q.y >= 0 && q.x < c.width && q.y < c.height) pts.push({ x: q.x, y: q.y, cls: null });
      }
      if (pts.length >= 12) {
        const rahmen = [[-260, -260], [260, -260], [260, 260], [-260, 260]].map(([dx, dy]) => proj(karte.H, cx + dx, cy + dy));
        return { pts, rahmen, karte: true, teilweise: pts.length < 40 };
      }
    }
    const s = Math.min(c.width, c.height) * 0.8; const x0 = (c.width - s) / 2; const y0 = (c.height - s) / 2; const pts = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) pts.push({ x: x0 + s * (0.1 + i * 0.2), y: y0 + s * (0.1 + j * 0.2), cls: null });
    return { pts, rahmen: [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }], karte: false };
  }
  function autoLuecken(c, pts) {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const r = Math.max(4, Math.round(Math.min(c.width, c.height) * 0.012));
    let n = 0;
    for (const p of pts) {
      let s = 0; let k = 0; let alle = 0;
      for (let y = Math.round(p.y) - r; y <= p.y + r; y += 2) for (let x = Math.round(p.x) - r; x <= p.x + r; x += 2) {
        if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
        const i = (y * c.width + x) * 4; alle++;
        const e = exg(d[i], d[i + 1], d[i + 2]); if (e !== null) { s += e; k++; }
      }
      if (k > alle * 0.4 && s / k < GRUEN) { p.cls = 'lu'; p.auto = true; n++; }
    }
    return n;
  }

  /** Punktraster für einen Kreis der Wiesenaufnahme (aufnahme.js) */
  function rasterFuer(ziel) { RS = { pid: null, aufnahme: ziel, n: leer(), k: 0, bilder: [] }; bestandStarten(null, true); }
  async function bestandStarten(probeId, weiter) {
    if (!weiter || !RS) RS = { pid: probeId || null, n: leer(), k: 0, bilder: [] };
    const c = await kamera({ titel: 'Bestand · Aufnahme ' + (RS.k + 1), hilfe: 'Senkrecht von oben aus Brusthöhe. Für ein Raster von 50 × 50 cm die Messkarte flach in die Mitte legen.', zeichnen: rasterLive });
    if (c) rasterWerkzeug(c);
  }

  function rasterWerkzeug(c) {
    const karte = (() => { try { return karteFinden(c); } catch (e) { return null; } })();
    const R = rasterPunkte(c, karte);
    const nAuto = autoLuecken(c, R.pts);
    let aktivK = 'gr';
    const zaehlen = () => { const n = leer(); R.pts.forEach((p) => { if (p.cls) n[p.cls]++; }); return n; };
    const leiste = () => {
      const n = zaehlen(); const offen = R.pts.filter((p) => !p.cls).length;
      return '<div class="cam-palette">' + KLASSEN.map((k) => '<button class="cam-kl' + (aktivK === k.id ? ' on' : '') + '" data-rk="' + k.id + '"><i style="background:' + k.f + '">' + k.k + '</i>' + k.t + ' <b>' + n[k.id] + '</b></button>').join('') + '</div>' +
        '<div class="cam-ctrl wrap"><button class="cam-btn" data-ra="rest"' + (offen ? '' : ' disabled') + '>' + offen + ' offene → ' + KL[aktivK].t + '</button>' +
        '<button class="cam-btn" data-ra="bestimmen">Pflanze bestimmen</button><button class="cam-btn primary" data-ra="ok">Aufnahme fertig</button></div>';
    };
    const W = werkzeug(c, {
      titel: 'Bestand · Aufnahme ' + (RS.k + 1),
      hilfe: 'Klasse wählen, dann Punkte antippen: Was liegt <b>direkt unter</b> dem Punkt?' + (R.karte ? ' Raster ≈ 50 × 50 cm (Messkarte erkannt)' + (R.teilweise ? ', ragt teilweise aus dem Bild – nächstes Mal höher halten.' : '.') : '') + (nAuto ? ' ' + nAuto + ' Punkte automatisch als Lücke erkannt (gestrichelt) – bei Bedarf ändern.' : ''),
      leiste: leiste(),
      zeichnen: (ctx, px) => {
        if (R.rahmen) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2 * px; ctx.setLineDash([8 * px, 6 * px]); ctx.beginPath(); R.rahmen.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
        for (const p of R.pts) {
          const k = p.cls && KL[p.cls]; const r = 13 * px;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = k ? k.f : 'rgba(255,255,255,.35)'; ctx.fill();
          ctx.lineWidth = 2.5 * px; ctx.strokeStyle = '#fff'; if (p.auto) ctx.setLineDash([4 * px, 3 * px]); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(p.x, p.y, 2 * px, 0, 7); ctx.fillStyle = '#000'; ctx.fill();
          if (k) { ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (12 * px) + 'px system-ui'; ctx.textAlign = 'center'; ctx.fillText(k.k, p.x, p.y - 15 * px); }
        }
      },
      tippen: (pt, art, px) => {
        if (art !== 'down') return;
        let best = null; let bd = 34 * px;
        for (const p of R.pts) { const dd = Math.hypot(p.x - pt.x, p.y - pt.y); if (dd < bd) { bd = dd; best = p; } }
        if (!best) return;
        best.cls = best.cls === aktivK && !best.auto ? null : aktivK; best.auto = false;
        if (navigator.vibrate) try { navigator.vibrate(6); } catch (e) { /* ignore */ }
        W.leiste(leiste());
      },
      klick: (e) => {
        const k = e.target.closest('[data-rk]'); if (k) { aktivK = k.dataset.rk; W.leiste(leiste()); return; }
        const a = e.target.closest('[data-ra]'); if (!a) return;
        if (a.dataset.ra === 'rest') { R.pts.forEach((p) => { if (!p.cls) p.cls = aktivK; }); W.leiste(leiste()); W.neu(); }
        if (a.dataset.ra === 'bestimmen' && global.Pflanzen) global.Pflanzen.sheet((kat) => { if (kat && KL[kat]) { aktivK = kat; W.leiste(leiste()); } });
        if (a.dataset.ra === 'ok') {
          const offen = R.pts.filter((p) => !p.cls).length;
          if (offen && !confirm(offen + ' Punkte ohne Angabe – diese nicht mitzählen?')) return;
          const n = zaehlen(); Object.keys(n).forEach((k) => { RS.n[k] += n[k]; });
          RS.k++; if (RS.bilder.length < 6) RS.bilder.push(c);
          zu(); ergebnisSheet();
        }
      },
    });
  }

  function anteilBalken(n) {
    const tot = KLASSEN.reduce((s, k) => s + n[k.id], 0) || 1;
    return '<div class="wi-balken" role="img" aria-label="Anteile">' + KLASSEN.filter((k) => n[k.id]).map((k) => '<span style="flex:' + n[k.id] + ';background:' + k.f + '" title="' + esc(k.t) + '"></span>').join('') + '</div>' +
      '<div class="wi-legende">' + KLASSEN.map((k) => '<span><i style="background:' + k.f + '"></i>' + k.t + ' ' + Math.round(n[k.id] / tot * 100) + ' %</span>').join('') + '</div>';
  }
  function vorschlagHtml(v) {
    const b = K3().BESTAENDE.find((x) => x.id === v.id);
    const pm = (p) => ' <span class="muted">± ' + Math.round(unsicher(p, v.pfl) * 100) + '</span>';
    return '<div class="wi-vorschlag"><span class="lead">' + b.kurz + '</span><div><b>' + esc(b.titel) + '</b><div class="small muted">' + esc(b.text) + '</div></div></div>' +
      '<table class="wi-tab"><tr><td>Gräser</td><td>' + Math.round(v.gras * 100) + ' %' + pm(v.gras) + '</td></tr><tr><td>davon Raigras</td><td>' + Math.round(v.rg * 100) + ' %</td></tr>' +
      '<tr><td>Klee</td><td>' + Math.round(v.kl * 100) + ' %' + pm(v.kl) + '</td></tr><tr><td>Kräuter fein / grob</td><td>' + Math.round(v.kf * 100) + ' / ' + Math.round(v.kg * 100) + ' %</td></tr>' +
      '<tr><td>Lücken (aller Punkte)</td><td>' + Math.round(v.luecken * 100) + ' %</td></tr></table>' +
      (v.grenz ? '<div class="alert warn small">' + esc(v.notiz) + '</div>' : '');
  }

  function ergebnisSheet() {
    const p = RS.pid ? app().probeById(RS.pid) : null; const v = vorschlag(RS.n);
    const N = RS.n.rg + RS.n.gr + RS.n.kl + RS.n.kf + RS.n.kg + RS.n.lu;
    app().sheet('<h2>Bestand aus dem Punktraster</h2><p class="small muted" style="margin-top:0">' + N + ' Punkte aus ' + RS.k + ' Aufnahme' + (RS.k > 1 ? 'n' : '') + '</p>' + anteilBalken(RS.n) +
      (v ? vorschlagHtml(v) : '<div class="alert info">Für einen Vorschlag braucht es mindestens 10 Punkte mit Pflanzen – weitere Aufnahme machen.</div>') +
      '<p class="hint">Das Raster misst die <b>Deckung von oben</b>, massgebend ist aber der <b>Gewichtsanteil</b> beim Schnitt. Klee und Kräuter unter hohem Gras werden unterschätzt, breite Blätter (Blacken, Bärenklau) überschätzt. Mehrere Aufnahmen über die Parzelle verteilen; die ± zeigen den Zufallsfehler. Der Vorschlag ersetzt die eigene Einschätzung nicht.</p>' +
      (v && v.luecken >= 0.1 ? '<p class="hint">Lücken lassen Unkräuter wie Blacken oder Gemeine Rispe aufkommen – bei grösseren Lücken eine Übersaat prüfen.</p>' : '') +
      (p && RS.bilder.length ? '<label class="toggle"><input type="checkbox" id="wiFotos"> Aufnahmen als Fotos zur Probe speichern (' + RS.bilder.length + ')</label>' : '') +
      '<div class="stack" style="margin-top:12px"><button class="btn block" data-wi="raster-weiter">Weitere Aufnahme</button>' +
      (v && RS.aufnahme ? '<button class="btn primary block" data-wi="raster-aufnahme">In Wiesenaufnahme übernehmen (Kreis ' + (RS.aufnahme.kreis + 1) + ')</button>' : '') +
      (v && p ? '<button class="btn primary block" data-wi="raster-ok">Übernehmen: ' + esc(K3().BESTAENDE.find((x) => x.id === v.id).titel) + '</button>' : '') +
      (v && !p && !RS.aufnahme ? '<div class="section-title" style="margin-left:0">Neue Probe mit diesem Bestand</div><div class="row">' + ['gruen', 'heu', 'gras'].map((t) => '<button class="btn grow" data-wi="raster-neu" data-typ="' + t + '">' + esc(K3().TYPEN[t].kurz) + '</button>').join('') + '</div>' : '') +
      '<button class="btn ghost block" data-wi="raster-weg">Verwerfen</button></div>');
  }
  async function rasterUebernehmen(p) {
    const v = vorschlag(RS.n); if (!v || !p) return;
    p.antworten.raster = Object.assign({}, RS.n, { k: RS.k });
    p.antworten.bestand = v.id;
    const mitFotos = document.getElementById('wiFotos') && document.getElementById('wiFotos').checked;
    if (mitFotos) {
      for (const c of RS.bilder) {
        if ((p.fotos || []).length >= 12) { toast('Maximal 12 Fotos pro Probe.'); break; }
        const meta = await F().speichern(c, 'futter', p.id); meta.up = false; p.fotos = (p.fotos || []).concat(meta);
      }
    }
    RS = null;
    app().touchProbe(p); app().closeSheet();
    app().go('#/p/' + p.id + '/stadium');
    toast('Bestand übernommen.');
  }

  // =====================================================================
  // 3 Wuchshöhe mit Messkarte (oder Massstab im Bild)
  // =====================================================================
  let HS = null;
  async function hoeheStarten(probeId, weiter) {
    if (!weiter || !HS) HS = { pid: probeId || null, werte: [] };
    const c = await kamera({
      titel: 'Wuchshöhe · Messung ' + (HS.werte.length + 1),
      hilfe: 'Messkarte senkrecht neben die Pflanzen stellen, Unterkante auf den Boden; von der Seite fotografieren. Ohne Karte: Doppelmeter ins Bild halten.',
      zeichnen: (ctx, w, h) => { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5); ctx.stroke(); ctx.setLineDash([]); },
    });
    if (c) hoeheWerkzeug(c);
  }
  function hoeheWerkzeug(c) {
    const karte = (() => { try { return karteFinden(c); } catch (e) { return null; } })();
    const S = { modus: karte ? 'karte' : 'massstab', A: null, B: null, Bcm: 50, T: null, cm: null };
    const linie = (Y) => [proj(karte.H, -150, Y), proj(karte.H, KARTE.w + 150, Y)];
    function rechnen() {
      if (!S.T) { S.cm = null; return; }
      if (S.modus === 'karte') { const q = proj(karte.Hi, S.T.x, S.T.y); S.cm = (KARTE.h - q.y) / 10; }
      else if (S.A && S.B) { const bx = S.B.x - S.A.x; const by = S.B.y - S.A.y; const l2 = bx * bx + by * by; S.cm = l2 ? ((S.T.x - S.A.x) * bx + (S.T.y - S.A.y) * by) / l2 * S.Bcm : null; }
      if (S.cm != null && (S.cm < 0 || S.cm > 300)) S.cm = null;
    }
    const hilfe = () => (S.modus === 'karte' ? 'Messkarte erkannt' + (karte.sicher ? '' : ' (Ausrichtung unsicher – Marke mit Loch oben links?)') + '. Linie auf die <b>mittlere Bestandeshöhe</b> ziehen – nicht auf einzelne Halme.'
      : !S.A ? '<b>Keine Messkarte erkannt.</b> Doppelmeter im Bild? Tippen Sie zuerst auf den <b>Boden (0 cm)</b> am Massstab.'
        : !S.B ? 'Jetzt eine <b>bekannte Marke</b> am Massstab antippen und unten den Wert eintragen.' : 'Linie auf die <b>mittlere Bestandeshöhe</b> ziehen.');
    const leiste = () => (S.modus === 'massstab' && S.A ? '<label class="cam-regler">Marke bei <input class="input sm" type="number" inputmode="decimal" min="5" max="300" value="' + S.Bcm + '" data-hm="bcm" style="width:80px"> cm</label>' : '') +
      '<div class="cam-ctrl wrap"><span class="cam-wert">' + (S.cm != null ? '≈ ' + Math.round(S.cm) + ' cm' : '–') + '</span>' +
      (S.modus === 'massstab' ? '<button class="cam-btn" data-hm="neu">Neu antippen</button>' : '') +
      '<button class="cam-btn primary" data-hm="ok"' + (S.cm != null ? '' : ' disabled') + '>Messung übernehmen</button></div>';
    const W = werkzeug(c, {
      titel: 'Wuchshöhe · Messung ' + (HS.werte.length + 1), hilfe: hilfe(), leiste: leiste(),
      zeichnen: (ctx, px) => {
        ctx.lineWidth = 3 * px;
        if (S.modus === 'karte') {
          ctx.strokeStyle = '#3fb8a8'; ctx.beginPath(); [[0, 0], [KARTE.w, 0], [KARTE.w, KARTE.h], [0, KARTE.h]].forEach(([X, Y], i) => { const q = proj(karte.H, X, Y); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke();
          const [b0, b1] = linie(KARTE.h); ctx.strokeStyle = '#c9a227'; ctx.beginPath(); ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
          if (S.T) { const Y = proj(karte.Hi, S.T.x, S.T.y).y; const [t0, t1] = linie(Y); ctx.strokeStyle = '#fff'; ctx.setLineDash([10 * px, 6 * px]); ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(t1.x, t1.y); ctx.stroke(); ctx.setLineDash([]); }
        } else {
          const dot = (q, f) => { ctx.beginPath(); ctx.arc(q.x, q.y, 9 * px, 0, 7); ctx.fillStyle = f; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke(); };
          if (S.A && S.B) { ctx.strokeStyle = '#c9a227'; ctx.beginPath(); ctx.moveTo(S.A.x, S.A.y); ctx.lineTo(S.B.x, S.B.y); ctx.stroke(); }
          if (S.A) dot(S.A, '#c9a227'); if (S.B) dot(S.B, '#3fb8a8');
          if (S.T) { ctx.strokeStyle = '#fff'; ctx.setLineDash([10 * px, 6 * px]); ctx.beginPath(); ctx.moveTo(0, S.T.y); ctx.lineTo(c.width, S.T.y); ctx.stroke(); ctx.setLineDash([]); }
        }
        if (S.T && S.cm != null) { ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (20 * px) + 'px system-ui'; ctx.textAlign = 'left'; ctx.fillText('≈ ' + Math.round(S.cm) + ' cm', S.T.x + 14 * px, S.T.y - 10 * px); }
      },
      tippen: (pt, art) => {
        if (S.modus === 'massstab' && art === 'down') { if (!S.A) { S.A = pt; W.info(''); upd(); return; } if (!S.B) { S.B = pt; upd(); return; } }
        if (S.modus === 'karte' || (S.A && S.B)) { S.T = pt; rechnen(); W.leiste(leiste()); }
      },
      klick: (e) => {
        const b = e.target.closest('[data-hm]'); if (!b) return;
        if (b.dataset.hm === 'neu') { S.A = S.B = S.T = null; S.cm = null; upd(); }
        if (b.dataset.hm === 'ok' && S.cm != null) { HS.werte.push(Math.round(S.cm)); zu(); hoeheSheet(); }
      },
    });
    function upd() { W.root.querySelector('.cam-t span').innerHTML = hilfe(); W.leiste(leiste()); W.neu(); }
    W.root.addEventListener('change', (e) => { if (e.target.dataset.hm === 'bcm') { const v = Number(String(e.target.value).replace(',', '.')); if (v >= 5 && v <= 300) { S.Bcm = v; rechnen(); W.leiste(leiste()); W.neu(); } } });
  }
  /* Ertragsschätzung aus der Wuchshöhe (wie v1, Werte anpassbar):
   * a) Futterdichte: Ertrag (kg TS/ha) = Höhe (cm, unverdichtet) × Futterdichte (kg TS/ha je cm; v1-Standard 100)
   * b) Herbometer: verdichtete Höhe cmRPM ≈ unverdichtete Höhe / 1,7 (AGFF-Merkblatt 1 «Weide», 2023);
   *    Ertrag = Formel aus v1 (Standard 140 · cmRPM + 500). Richtwerte MB1: 7,5–9 cmRPM ≈ 1300 kg TS/ha verfügbares Weidefutter. */
  const ERTRAG_KEY = 'agffV2Ertrag';
  function ertragParam() {
    let z = {}; try { z = JSON.parse(localStorage.getItem(ERTRAG_KEY) || '{}') || {}; } catch (e) { z = {}; }
    return { dichte: Number(z.dichte) > 0 ? Number(z.dichte) : 100, a: Number.isFinite(Number(z.a)) && z.a !== undefined ? Number(z.a) : 140, b: Number.isFinite(Number(z.b)) && z.b !== undefined ? Number(z.b) : 500 };
  }
  function ertragHtml(h) {
    const e = ertragParam(); const rpm = h / 1.7;
    const viaDichte = h * e.dichte; const viaRpm = e.a * rpm + e.b;
    return '<section class="q" id="wiErtrag"><h3>Ertragsschätzung</h3>' +
      '<table class="wi-tab"><tr><td>Über Futterdichte<br><span class="small muted">' + Math.round(h) + ' cm × ' + fmt(e.dichte, 0) + ' kg TS/ha je cm</span></td><td><b>≈ ' + fmt(Math.round(viaDichte / 10) * 10, 0) + ' kg TS/ha</b></td></tr>' +
      '<tr><td>Über Herbometer-Höhe<br><span class="small muted">' + Math.round(h) + ' cm ÷ 1,7 ≈ ' + fmt(rpm, 1) + ' cmRPM · ' + fmt(e.a, 0) + ' × cmRPM + ' + fmt(e.b, 0) + '</span></td><td><b>≈ ' + fmt(Math.round(viaRpm / 10) * 10, 0) + ' kg TS/ha</b></td></tr></table>' +
      '<details><summary class="small" style="cursor:pointer;font-weight:650">Werte anpassen</summary><div class="grid2" style="margin-top:8px">' +
      '<label class="field"><span>Futterdichte (kg TS/ha je cm)</span><input class="input" inputmode="decimal" data-ertrag="dichte" value="' + e.dichte + '"></label>' +
      '<label class="field"><span>Formel cmRPM: a · x + b</span><span class="row" style="gap:6px"><input class="input" inputmode="decimal" data-ertrag="a" value="' + e.a + '" aria-label="a"><input class="input" inputmode="decimal" data-ertrag="b" value="' + e.b + '" aria-label="b"></span></label></div></details>' +
      '<p class="hint">Grobe Schätzung des stehenden Bestandes. Die Futterdichte hängt stark von Bestand (dicht/locker, Gräser/Kräuter) und Aufwuchs ab – am besten mit einer eigenen Schnittprobe (Mähen und Wiegen) eichen. Umrechnung unverdichtet → Herbometer (Faktor 1,7) und Richtwerte nach AGFF-Merkblatt 1 «Weide» (2023): Auftriebshöhe 7,5–9 cmRPM ≈ 1300 kg TS/ha verfügbares Weidefutter. Standardwerte wie im Futterwert-Rechner v1.</p></section>';
  }
  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-ertrag]'); if (!t) return;
    const z = ertragParam(); const v = Number(String(t.value).replace(',', '.'));
    if (Number.isFinite(v)) z[t.dataset.ertrag] = v;
    try { localStorage.setItem(ERTRAG_KEY, JSON.stringify(z)); } catch (er) { /* privat */ }
    const box = document.getElementById('wiErtrag'); const h = Number(box && box.closest('.sheet') && box.closest('.sheet').dataset.hoehe);
    if (box && h) { box.outerHTML = ertragHtml(h); const d = document.querySelector('#wiErtrag details'); if (d) d.open = true; }
  });

  function hoeheSheet() {
    const p = HS.pid ? app().probeById(HS.pid) : null;
    const m = HS.werte.reduce((s, x) => s + x, 0) / HS.werte.length;
    const el = app().sheet('<h2>Wuchshöhe</h2><p class="wi-gross">≈ ' + Math.round(m) + ' cm</p><p class="small muted" style="margin-top:0">Mittel aus ' + HS.werte.length + ' Messung' + (HS.werte.length > 1 ? 'en' : '') + ': ' + HS.werte.join(' · ') + ' cm</p>' +
      ertragHtml(m) +
      '<p class="hint">Gemessen wird die unverdichtete mittlere Bestandeshöhe in der Ebene der Karte bzw. des Massstabs. Über der Karte (29 cm) wird extrapoliert – dort ist die Messung ungenauer. Für ein gutes Mittel mehrere Stellen der Parzelle messen.</p>' +
      '<div class="stack"><button class="btn block" data-wi="hoehe-weiter">Weitere Messung</button>' +
      (p ? '<button class="btn primary block" data-wi="hoehe-ok">Zur Probe übernehmen</button>' : '') + '<button class="btn ghost block" data-wi="hoehe-weg">' + (p ? 'Verwerfen' : 'Schliessen') + '</button></div>');
    if (el) el.dataset.hoehe = m;
  }

  // =====================================================================
  // 4 Stadium mit Vergleichsbildern
  // =====================================================================
  // Zeichnung der Gräser (AGFF, Phasen 1–7) je Stadium und Leitpflanze; Fotos AGFF für Knaulgras und Rotklee
  const ZEICHNUNG = { 0: [1, 2, 3, 4, 5, 6, 7], 1: [2, 3, 4, 5, 6, 7, 7], 2: [1, 1, 2, 2, 3, 4, 5] };
  // Beschreibung der Entwicklungsstadien der Gräser (AGFF), je Phase der Zeichnung
  const PHASE_AGFF = {
    1: 'Bestockung – Beginn Schossen: Der Hauptpflanzentrieb beginnt sich zu strecken.',
    2: 'Schossen, 10-cm-Punkt: Der oberste Halmknoten (mit der Ähren-/Rispenanlage) befindet sich rund 10 cm über dem Boden.',
    3: 'Beginn Rispenschieben: Die Spitze der Ähre/Rispe tritt bei den ersten Pflanzen dieser Art aus der Blattscheide aus.',
    4: 'Volles Rispenschieben: Die Ähre/Rispe ist bei den meisten Pflanzen dieser Art in voller Länge ausgetreten.',
    5: 'Ende Rispenschieben: Ähre/Rispe in voller Länge sichtbar, kurz vor der Blüte. An einzelnen Ährchen sind Staubbeutel sichtbar.',
    6: 'Blüte: An den meisten Ährchen sind Staubbeutel sichtbar. Bei Wind oder beim Schnitt «stäubt» der Blütenstand.',
    7: 'Samenreife: Die Blütenstände haben die grüne Farbe verloren, die Samen sind fest; erste Samen fallen aus.',
  };
  // Fotos aus den AGFF-Unterlagen (K3a, Merkblatt 3): Knaulgras, Engl. Raigras, Rotklee, Löwenzahn, Scharfer Hahnenfuss
  const FOTO_REF = {
    0: { 3: ['ref-kg3', 'ref-er3'], 4: ['ref-kg4', 'ref-er4'], 6: ['ref-kg6', 'ref-er6'] },
    3: { 3: ['ref-rk3'], 5: ['ref-rk5'], 6: ['ref-rk6'] },
    4: { 3: ['ref-lz3a', 'ref-lz3b'], 4: ['ref-lz4'] },
    5: { 3: ['ref-hf3'], 4: ['ref-hf4'] },
  };
  function refsLaden() {
    const z = lesen(KEY_REF);
    return (Array.isArray(z) ? z : []).filter((r) => r && ID_RE.test(r.id || '') && r.lp >= 0 && r.lp <= 5 && r.st >= 1 && r.st <= 7).slice(-40);
  }
  function referenzen(lp) {
    const out = [];
    for (let st = 1; st <= 7; st++) {
      const name = K3().STADIEN_ERSTER[st - 1][lp]; if (!name || name === '–') continue;
      const bilder = [];
      refsLaden().filter((r) => r.lp === lp && r.st === st).forEach((r) => bilder.push({ fid: r.id, q: 'eigenes Foto' }));
      ((FOTO_REF[lp] && FOTO_REF[lp][st]) || []).forEach((f) => bilder.push({ src: 'assets/bilder/' + f + '.webp', q: 'AGFF' }));
      if (ZEICHNUNG[lp]) bilder.push({ src: 'assets/bilder/ref-st' + ZEICHNUNG[lp][st - 1] + '.webp', q: 'AGFF-Zeichnung' });
      out.push({ st, name, bilder, phase: ZEICHNUNG[lp] ? PHASE_AGFF[ZEICHNUNG[lp][st - 1]] : null });
    }
    return out;
  }
  const refUrls = new Map();
  async function refUrl(b) { if (b.src) return b.src; if (!refUrls.has(b.fid)) refUrls.set(b.fid, await F().thumbUrl(b.fid)); return refUrls.get(b.fid); }

  /** Plausibilisierung Stadium 1. Aufwuchs nach AGFF-Merkblatt 3 (grobe Zeitangaben). */
  function plausi(p) {
    const a = p.antworten || {}; const k = p.kopf || {};
    if (a.aufwuchs !== '1') return null;
    const datum = k.schnitt || (p.typ === 'gruen' ? new Date().toISOString().slice(0, 10) : null);
    if (!datum) return { html: '<p class="hint">Plausibilisierung nach AGFF-Merkblatt 3: Schnittdatum im Schritt «Probe» eintragen.</p>' };
    const n = K3().stadiumZeit(datum, k.hoehe, false); const kw = K3().stadiumZeit(datum, k.hoehe, true);
    if (!n) return null;
    const dCH = (d) => d.split('-').reverse().slice(0, 2).join('.') + '.';
    const wo = (k.hoehe ? k.hoehe + ' m ü. M.' : 'bis 600 m (Höhe nicht angegeben)');
    const alle = Array.from(new Set(n.passt.concat(kw.passt))).sort((x, y) => x - y);
    let erwartet = alle.length ? 'Stadium ' + alle[0] + (alle.length > 1 ? '–' + alle[alle.length - 1] : '') : (n.vor ? 'noch vor Stadium 1' : 'nach Stadium 7');
    const st = Number(a.stadium);
    const ok = !st || alle.includes(st);
    const quelle = 'Nach AGFF-Merkblatt 3 (Zeitperiode der Stadien, Naturwiesen; über 600 m 3–5 Tage später je 100 m, Kunstwiesen etwa eine Woche später).';
    let t = (p.typ === 'gruen' && !k.schnitt ? 'Heute' : 'Schnitt am ' + dCH(datum)) + ' auf ' + wo + ': erwartet etwa <b>' + erwartet + '</b>.';
    if (st && !ok) t += ' Gewählt ist Stadium ' + st + ' – hier üblich etwa ' + dCH(n.fenster[st][0]) + '–' + dCH(kw.fenster[st][1]) + ' Bitte prüfen; das Stadium an den Pflanzen hat Vorrang (Jahr, Witterung und Lage verschieben stark).';
    else if (st) t += ' Gewähltes Stadium ' + st + ' passt zur groben Zeitangabe.';
    return { ok, erwartet, html: '<div class="' + (ok ? 'hint' : 'alert warn small') + '" style="margin:10px 0">' + t + ' <span class="muted small">' + quelle + '</span></div>' };
  }

  async function stadiumStarten(probeId, lpWahl) {
    const p = probeId ? app().probeById(probeId) : null;
    const lp = lpWahl != null ? lpWahl : Number((p && p.antworten.leitpflanze) || 0);
    const refs = referenzen(lp); let gew = null; let bildI = 0;
    const leiste = '<div class="cam-chips">' + refs.map((r) => '<button class="cam-chip" data-st="' + r.st + '">' + (r.bilder.length ? '<img alt="" data-refimg="' + r.st + '">' : '<span class="ohne">kein Bild</span>') + '<span><b>' + r.st + '</b> ' + esc(r.name) + '</span></button>').join('') + '</div>';
    const knopf = '<button class="cam-btn primary" data-sx="nehmen" disabled>Stadium wählen</button>';
    await kamera({
      titel: 'Stadium · ' + K3().REFERENZPFLANZEN[lp], max: 1600,
      hilfe: 'Blütenstand der Leitpflanze in den Kreis. Vergleichsbild unten antippen (nochmals tippen = nächstes Bild).',
      leiste, knopf,
      start: async (api) => {
        const pl = p && plausi(p); if (pl && pl.erwartet) api.info('Nach AGFF-Merkblatt 3 erwartet: ' + pl.erwartet);
        for (const r of refs) if (r.bilder.length) { const im = api.root.querySelector('[data-refimg="' + r.st + '"]'); if (im) im.src = await refUrl(r.bilder[0]); }
      },
      zeichnen: (ctx, w, h) => {
        const r = Math.min(w, h) * 0.22; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.42, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      },
      klick: async (e, api) => {
        const chip = e.target.closest('[data-st]');
        if (chip) {
          const st = Number(chip.dataset.st); const r = refs.find((x) => x.st === st);
          bildI = gew === st ? bildI + 1 : 0; gew = st;
          api.root.querySelectorAll('[data-st]').forEach((b) => b.classList.toggle('on', Number(b.dataset.st) === st));
          api.ref(r.bilder.length ? await refUrl(r.bilder[bildI % r.bilder.length]) : null);
          api.info((r.bilder.length ? 'Vergleich: Stadium ' + st + ' – ' + esc(r.name) + ' <span class="muted">(' + r.bilder[bildI % r.bilder.length].q + ')</span>' : 'Stadium ' + st + ': noch kein Vergleichsbild – eigenes Foto als Referenz speichern.') +
            (r.phase ? '<br><small>' + esc(r.phase) + '</small>' : ''));
          const b = api.root.querySelector('[data-sx="nehmen"]'); b.disabled = false; b.textContent = 'Stadium ' + st + ' wählen';
          return;
        }
        const x = e.target.closest('[data-sx]'); if (!x) return;
        if (x.dataset.sx === 'nehmen' && gew) {
          if (p) { p.antworten.aufwuchs = '1'; p.antworten.stadium = String(gew); p.antworten.leitpflanze = lp; app().touchProbe(p); zu(); app().rerenderDetail(true); toast('Stadium ' + gew + ' übernommen.'); }
          else { zu(); toast('Stadium ' + gew + ': ' + refs.find((r) => r.st === gew).name); }
        }
        if (x.dataset.sx === 'probe' && api._bild && p) {
          if ((p.fotos || []).length >= 12) { toast('Maximal 12 Fotos pro Probe.'); return; }
          const meta = await F().speichern(api._bild, 'futter', p.id); meta.up = false; p.fotos = (p.fotos || []).concat(meta); app().touchProbe(p);
          api.panel(''); toast('Foto zur Probe gespeichert.');
        }
        if (x.dataset.sx === 'ref' && api._bild && gew) {
          const meta = await F().speichern(api._bild, 'futter', 'ref');
          const list = refsLaden().concat({ id: meta.id, lp, st: gew, at: meta.createdAt });
          while (list.length > 40) { const alt = list.shift(); F().del(alt.id).catch(() => {}); }
          schreiben(KEY_REF, list); api.panel(''); toast('Eigenes Referenzbild für Stadium ' + gew + ' gespeichert (nur auf diesem Gerät).');
        }
        if (x.dataset.sx === 'weg') { api._bild = null; api.panel(''); }
      },
      nachFoto: (c, api) => {
        api._bild = c;
        api.panel('<b>Foto aufgenommen</b><div class="row">' + (p ? '<button class="cam-btn" data-sx="probe">Zur Probe</button>' : '') +
          '<button class="cam-btn" data-sx="ref"' + (gew ? '' : ' disabled') + '>' + (gew ? 'Als eigene Referenz für Stadium ' + gew : 'Zuerst Stadium antippen') + '</button><button class="cam-btn" data-sx="weg">Verwerfen</button></div>');
      },
    });
  }

  // =====================================================================
  // 5 Fotopunkte
  // =====================================================================
  function fpLaden() {
    const z = lesen(KEY_FP);
    return (Array.isArray(z) ? z : []).filter((p) => p && ID_RE.test(p.id || '') && typeof p.name === 'string').map((p) => ({
      id: p.id, name: p.name.slice(0, 80), notiz: typeof p.notiz === 'string' ? p.notiz.slice(0, 500) : '',
      lat: typeof p.lat === 'number' && Math.abs(p.lat) <= 90 ? p.lat : null, lon: typeof p.lon === 'number' && Math.abs(p.lon) <= 180 ? p.lon : null,
      acc: typeof p.acc === 'number' ? p.acc : null, richtung: typeof p.richtung === 'number' ? p.richtung : null, createdAt: String(p.createdAt || ''),
      fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter((f) => f && ID_RE.test(f.id || '')).map((f) => ({ id: f.id, at: String(f.at || ''), w: Number(f.w) || 0, h: Number(f.h) || 0 })).slice(-60),
    }));
  }
  let FP = fpLaden();
  const fpSpeichern = () => schreiben(KEY_FP, FP);
  const fpById = (id) => FP.find((p) => p.id === id);
  const datum = (iso) => (iso ? new Date(iso).toLocaleDateString('de-CH') : '');
  const abstand = (a, b) => { const R = 6371000; const r = Math.PI / 180; const dl = (b.lat - a.lat) * r; const dn = (b.lon - a.lon) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  let richtungJetzt = null;
  function richtungHoeren(api) {
    const h = (e) => {
      const r = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.absolute && e.alpha != null ? 360 - e.alpha : null);
      if (r == null) return;
      // Bildschirm quer gedreht: Kompass auf die Blickrichtung der Kamera beziehen (iOS rechnet das selbst)
      const dreh = e.webkitCompassHeading != null ? 0 : ((global.screen && global.screen.orientation && global.screen.orientation.angle) || 0);
      richtungJetzt = Math.round(r + dreh + 360) % 360;
    };
    const ev = 'ondeviceorientationabsolute' in global ? 'deviceorientationabsolute' : 'deviceorientation';
    global.addEventListener(ev, h); api.weg(() => global.removeEventListener(ev, h));
  }
  function richtungErlauben() {
    try { if (global.DeviceOrientationEvent && typeof global.DeviceOrientationEvent.requestPermission === 'function') global.DeviceOrientationEvent.requestPermission().catch(() => {}); } catch (e) { /* ignore */ }
  }

  /** Kurs (Grad ab Norden) von a nach b */
  function peilung(a, b) {
    const r = Math.PI / 180; const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  const HIMMEL = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
  const himmel = (g) => HIMMEL[Math.round(g / 45) % 8];
  const meter = (d) => (d >= 1000 ? (d / 1000).toFixed(d >= 10000 ? 0 : 1).replace('.', ',') + ' km' : Math.round(d) + ' m');
  const drehText = (dd) => (Math.abs(dd) <= 10 ? 'geradeaus' : Math.abs(dd) >= 165 ? 'umdrehen' : Math.round(Math.abs(dd)) + '° nach ' + (dd < 0 ? 'links' : 'rechts'));
  const kleinPfeil = (g) => '<svg class="fp-mini-pfeil" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(' + Math.round(g) + 'deg)"><path d="M12 2l7 18-7-4-7 4z" fill="currentColor"/></svg>';
  /** Drehwinkel ohne Sprung über 0°/360° (CSS-Übergang dreht sonst einmal rundherum) */
  function glatt(alt, neu) { if (alt == null) return neu; let d = ((neu - alt) % 360 + 540) % 360 - 180; return alt + d; }

  /** Zum Fotopunkt führen: grosser Pfeil zum Standort, am Ziel Pfeil zur gespeicherten Blickrichtung. */
  function fpFuehren(id) {
    const pt = fpById(id); if (!pt || pt.lat == null) return;
    richtungErlauben(); richtungJetzt = null;
    const v = ansicht(kopf(pt.name, 'Zum Fotopunkt zurückfinden') +
      '<div class="fp-nav"><div class="fp-nav-phase" data-fn="phase">Standort wird gesucht …</div>' +
      '<div class="fp-nav-rose"><span class="fp-nav-n" data-fn="n">N</span><svg class="fp-nav-pfeil" data-fn="pfeil" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 L80 86 L50 70 L20 86 Z"/></svg></div>' +
      '<div class="fp-nav-dist" data-fn="dist">–</div><div class="fp-nav-text" data-fn="text" aria-live="polite"></div><div class="fp-nav-klein" data-fn="klein"></div>' +
      '<div class="fp-nav-knoepfe"><button class="btn primary" data-wi="fp-foto" data-id="' + pt.id + '">Kamera mit Ausrichtungshilfe</button></div></div>', 'fp-fuehren');
    const el = (k) => v.root.querySelector('[data-fn="' + k + '"]');
    let pos = null; let fehler = ''; let winkel = null; let nWinkel = null;
    const api = { weg: (f) => v.weg.push(f) };
    richtungHoeren(api);
    if (navigator.geolocation) {
      const w = navigator.geolocation.watchPosition((p) => { pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; fehler = ''; },
        (e) => { fehler = e && e.code === 1 ? 'Kein Zugriff auf den Standort – bitte in den Browser-Einstellungen erlauben.' : 'Standort nicht verfügbar.'; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
      v.weg.push(() => navigator.geolocation.clearWatch(w));
    } else fehler = 'Dieses Gerät liefert keinen Standort.';
    function zeigen() {
      if (!v.root.isConnected) return;
      const kompass = richtungJetzt != null;
      if (!pos) { el('phase').textContent = fehler || 'Standort wird gesucht …'; return; }
      const d = abstand(pos, pt); const tol = Math.max(8, Math.min(pos.acc || 0, 40));
      const da = d <= tol;
      let ziel; let text; let phase;
      if (!da) {
        const kurs = peilung(pos, pt);
        ziel = kompass ? kurs - richtungJetzt : kurs;
        phase = 'Zum Standort';
        text = kompass ? 'Gehen Sie ' + drehText(((ziel % 360) + 540) % 360 - 180) + ' – Richtung ' + himmel(kurs) + '.' : 'Richtung ' + himmel(kurs) + ' (' + Math.round(kurs) + '°). Ohne Kompass zeigt der Pfeil nach Norden ausgerichtet: oben = Norden.';
        el('dist').textContent = meter(d);
      } else if (pt.richtung != null) {
        ziel = kompass ? pt.richtung - richtungJetzt : pt.richtung;
        const dd = ((ziel % 360) + 540) % 360 - 180;
        phase = 'Am Standort ✓ – Blickrichtung';
        text = kompass ? (Math.abs(dd) <= 8 ? 'Richtung passt – jetzt fotografieren.' : 'Drehen Sie sich ' + drehText(dd) + '.') : 'Blick nach ' + himmel(pt.richtung) + ' (' + pt.richtung + '°) – oben = Norden.';
        el('dist').textContent = kompass && Math.abs(dd) <= 8 ? '✓' : pt.richtung + '°';
      } else {
        ziel = null; phase = 'Am Standort ✓'; text = 'Für diesen Punkt ist keine Blickrichtung gespeichert – am Vorher-Bild ausrichten.'; el('dist').textContent = '✓';
      }
      el('phase').textContent = phase; el('text').textContent = text;
      el('klein').textContent = 'GPS ± ' + Math.round(pos.acc || 0) + ' m' + (pos.acc > 30 ? ' – ungenau, kurz warten oder ins Freie gehen' : '') + (kompass ? ' · Kompass aktiv' : ' · kein Kompass');
      v.root.classList.toggle('fp-da', da); v.root.classList.toggle('fp-passt', da && kompass && pt.richtung != null && Math.abs(((pt.richtung - richtungJetzt) % 360 + 540) % 360 - 180) <= 8);
      const p = el('pfeil'); p.style.visibility = ziel == null ? 'hidden' : 'visible';
      if (ziel != null) { winkel = glatt(winkel, ziel); p.style.transform = 'rotate(' + winkel + 'deg)'; }
      const n = el('n');
      nWinkel = glatt(nWinkel, kompass ? -richtungJetzt : 0); n.style.transform = 'rotate(' + nWinkel + 'deg) translateY(-118px) rotate(' + (-nWinkel) + 'deg)';
    }
    const tick = setInterval(zeigen, 300); v.weg.push(() => clearInterval(tick));
    zeigen();
  }

  async function fpFoto(id) {
    const pt = fpById(id); if (!pt) return;
    const letzte = pt.fotos[pt.fotos.length - 1];
    const ghost = letzte ? await F().bildUrl(letzte.id) : null;
    let pos = null; richtungJetzt = null;
    const c = await kamera({
      titel: pt.name, ghost,
      hilfe: letzte ? 'Bild am Vorher-Bild ausrichten – Schieberegler ändert die Deckkraft.' : 'Ausschnitt mit festen Merkpunkten wählen (Zaunpfahl, Baum, Stein am Rand). Immer aus derselben Höhe fotografieren.',
      start: (api) => {
        richtungHoeren(api);
        if (navigator.geolocation) {
          const w = navigator.geolocation.watchPosition((p) => { pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
          api.weg(() => navigator.geolocation.clearWatch(w));
        }
        const tick = setInterval(() => {
          const t = [];
          if (pos && pt.lat != null) {
            const d = abstand(pt, pos);
            if (d < Math.max(8, Math.min(pos.acc, 40))) t.push('Standort passt (± ' + Math.round(pos.acc) + ' m)');
            else { const kurs = peilung(pos, pt); t.push((richtungJetzt != null ? kleinPfeil(kurs - richtungJetzt) + ' ' : '') + 'Noch ' + meter(d) + ' Richtung ' + himmel(kurs) + ' (± ' + Math.round(pos.acc) + ' m)'); }
          }
          if (richtungJetzt != null && pt.richtung != null) { const dd = ((pt.richtung - richtungJetzt + 540) % 360) - 180; t.push(Math.abs(dd) <= 8 ? 'Richtung passt ✓' : kleinPfeil(dd) + ' ' + Math.round(Math.abs(dd)) + '° nach ' + (dd < 0 ? 'links' : 'rechts') + ' drehen'); }
          api.info(t.join(' · '));
        }, 700);
        api.weg(() => clearInterval(tick));
      },
    });
    if (ghost) setTimeout(() => URL.revokeObjectURL(ghost), 1000);
    if (!c) return;
    const meta = await F().speichern(c, 'futter', 'fp:' + pt.id);
    pt.fotos.push({ id: meta.id, at: meta.createdAt, w: meta.w, h: meta.h });
    if (pt.lat == null && pos) Object.assign(pt, pos);
    if (pt.richtung == null && richtungJetzt != null) pt.richtung = richtungJetzt;
    fpSpeichern(); toast('Foto gespeichert (' + pt.fotos.length + ' am Fotopunkt).');
    app().go('#/fotopunkte/' + pt.id); app().render();
  }

  function fpNeuSheet() {
    app().sheet('<h2>Neuer Fotopunkt</h2><p class="small muted" style="margin-top:0">Dieselbe Stelle immer wieder fotografieren – z. B. vor und nach einer Übersaat oder über mehrere Jahre. Alles bleibt auf diesem Gerät.</p>' +
      '<div class="stack"><label class="field"><span>Name</span><input class="input" id="fpName" placeholder="z. B. Parzelle Moos, Ecke Bach" maxlength="80"></label>' +
      '<label class="field"><span>Notiz</span><input class="input" id="fpNotiz" placeholder="optional, z. B. Übersaat 12.4." maxlength="500"></label>' +
      '<label class="toggle"><input type="checkbox" id="fpGeo" checked> Standort speichern (nur auf diesem Gerät, für die Rückkehr zum Punkt)</label>' +
      '<button class="btn primary block" data-wi="fp-anlegen">Erstes Foto aufnehmen</button><button class="btn ghost block" data-close>Abbrechen</button></div>');
  }
  function fpAnlegen() {
    const name = (document.getElementById('fpName').value || '').trim() || 'Fotopunkt ' + (FP.length + 1);
    const pt = { id: app().uid(), name: name.slice(0, 80), notiz: (document.getElementById('fpNotiz').value || '').trim().slice(0, 500), lat: null, lon: null, acc: null, richtung: null, createdAt: new Date().toISOString(), fotos: [] };
    const geo = document.getElementById('fpGeo').checked;
    FP.push(pt); fpSpeichern(); app().closeSheet(); richtungErlauben();
    if (geo && navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => { pt.lat = p.coords.latitude; pt.lon = p.coords.longitude; pt.acc = p.coords.accuracy; fpSpeichern(); }, () => toast('Standort nicht verfügbar – Fotopunkt ohne Standort.'), { enableHighAccuracy: true, timeout: 15000 });
    fpFoto(pt.id);
  }

  function renderFotopunkte(id) {
    FP = fpLaden();
    const pt = id && fpById(id);
    if (pt) {
      const fotos = pt.fotos.slice().reverse();
      return '<div class="bar"><a class="icon-btn" href="#/fotopunkte" aria-label="Zurück">' + app().I.back + '</a><h2>' + esc(pt.name) + '<span class="sub">' + pt.fotos.length + ' Fotos · seit ' + datum(pt.createdAt) + '</span></h2></div><div class="pad wiese">' +
        (pt.notiz ? '<p>' + esc(pt.notiz) + '</p>' : '') +
        '<p class="small muted">' + (pt.lat != null ? 'Standort ' + pt.lat.toFixed(5) + ', ' + pt.lon.toFixed(5) + ' (± ' + Math.round(pt.acc || 0) + ' m)' : 'ohne Standort') + (pt.richtung != null ? ' · Blickrichtung ' + pt.richtung + '°' : '') + ' – nur auf diesem Gerät</p>' +
        '<div class="row"><button class="btn primary grow" data-wi="fp-foto" data-id="' + pt.id + '">Neues Foto mit Ausrichtungshilfe</button>' +
        (pt.lat != null ? '<button class="btn grow" data-wi="fp-fuehren" data-id="' + pt.id + '">' + kleinPfeil(45) + ' Zum Standort führen</button>' : '') + '</div>' +
        '<div class="row" style="margin-top:8px"><button class="btn sm" data-wi="fp-standort" data-id="' + pt.id + '">' + (pt.lat != null ? 'Standort hier neu setzen' : 'Standort hier setzen (GPS)') + '</button>' +
        (pt.lat != null ? '<button class="btn sm ghost" data-wi="fp-standort-weg" data-id="' + pt.id + '">Standort entfernen</button>' : '') + '</div>' +
        (pt.fotos.length >= 2 ? '<div class="row" style="margin-top:8px"><button class="btn grow" data-wi="fp-vergleich" data-id="' + pt.id + '">Vorher / Nachher vergleichen</button><button class="btn grow" data-wi="fp-pdf" data-id="' + pt.id + '">Verlauf als PDF</button></div>' : '') +
        '<div class="fotos" style="margin-top:14px">' + fotos.map((f) => '<button type="button" class="foto-thumb" data-wi="fp-zeigen" data-id="' + pt.id + '" data-foto="' + f.id + '"><img alt="" data-fp-img="' + f.id + '"><span class="foto-art">' + datum(f.at) + '</span></button>').join('') + '</div>' +
        '<div class="row" style="margin-top:18px"><button class="btn sm" data-wi="fp-umbenennen" data-id="' + pt.id + '">Umbenennen</button><button class="btn sm danger" data-wi="fp-loeschen" data-id="' + pt.id + '">Fotopunkt löschen</button></div></div>';
    }
    return '<div class="bar"><a class="icon-btn" href="#/wiese" aria-label="Zurück">' + app().I.back + '</a><h2>Fotopunkte<span class="sub">Dieselbe Stelle über die Zeit</span></h2></div><div class="pad wiese">' +
      '<button class="btn primary block" data-wi="fp-neu">' + app().I.plus + ' Neuer Fotopunkt</button>' +
      (FP.length ? '<ul class="list" style="margin-top:12px">' + FP.map((p) => { const l = p.fotos[p.fotos.length - 1]; return '<li><a class="item" href="#/fotopunkte/' + p.id + '">' + (l ? '<img class="fp-mini" alt="" data-fp-img="' + l.id + '">' : '<span class="avatar">FP</span>') + '<span style="min-width:0"><span class="t">' + esc(p.name) + '</span><span class="s">' + p.fotos.length + ' Fotos' + (l ? ' · zuletzt ' + datum(l.at) : '') + '</span></span></a></li>'; }).join('') + '</ul>'
        : '<p class="muted small" style="margin-top:14px">Noch keine Fotopunkte. Beim nächsten Foto blendet die App das letzte Bild halbtransparent ein – so entsteht derselbe Ausschnitt, auch nach Monaten.</p>') +
      '<p class="hint">Fotos und Standorte bleiben auf diesem Gerät und sind in der Sicherung (JSON) enthalten. Für Kurse: Verlauf als PDF teilen.</p></div>';
  }
  const fpUrls = new Map();
  async function bilderEinsetzen() {
    for (const img of document.querySelectorAll('img[data-fp-img]')) {
      const id = img.dataset.fpImg;
      if (!fpUrls.has(id)) fpUrls.set(id, await F().thumbUrl(id).catch(() => null));
      if (fpUrls.get(id)) img.src = fpUrls.get(id);
    }
    for (const img of document.querySelectorAll('img[data-ref-img]')) { const u = await F().thumbUrl(img.dataset.refImg).catch(() => null); if (u) img.src = u; }
  }

  async function fpVergleich(id) {
    const pt = fpById(id); if (!pt || pt.fotos.length < 2) return;
    let a = 0; let b = pt.fotos.length - 1;
    const opt = (sel) => pt.fotos.map((f, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + datum(f.at) + ' (' + (i + 1) + ')</option>').join('');
    const v = ansicht('<div class="cam-buehne cmp"><img class="cmp-a" alt=""><img class="cmp-b" alt=""><div class="cmp-linie"></div></div>' + kopf('Vorher / Nachher', esc(pt.name) + ' – Regler verschieben') +
      '<div class="cam-unten"><input type="range" min="0" max="100" value="50" class="cmp-regler" aria-label="Trennlinie"><div class="cam-ctrl wrap"><label>Vorher <select class="input sm" data-cmp="a">' + opt(a) + '</select></label><label>Nachher <select class="input sm" data-cmp="b">' + opt(b) + '</select></label></div></div>', 'cam-werkzeug');
    const urls = [];
    async function setzen() {
      for (const [cls, i] of [['.cmp-a', a], ['.cmp-b', b]]) { const u = await F().bildUrl(pt.fotos[i].id); if (u) { urls.push(u); v.root.querySelector(cls).src = u; } }
    }
    const teilen = (x) => { v.root.querySelector('.cmp-b').style.clipPath = 'inset(0 0 0 ' + x + '%)'; v.root.querySelector('.cmp-linie').style.left = x + '%'; };
    v.root.querySelector('.cmp-regler').addEventListener('input', (e) => teilen(e.target.value));
    v.root.addEventListener('change', (e) => { const s = e.target.closest('[data-cmp]'); if (!s) return; if (s.dataset.cmp === 'a') a = Number(s.value); else b = Number(s.value); setzen(); });
    v.root.addEventListener('click', (e) => { if (e.target.closest('[data-cam="zu"]')) zu(); });
    v.weg.push(() => urls.forEach((u) => URL.revokeObjectURL(u)));
    teilen(50); setzen();
  }
  async function fpPdf(id) {
    const pt = fpById(id); if (!pt) return;
    const IO = global.FutterIO; await IO.loadScript('assets/vendor/jspdf.umd.min.js');
    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4' }); const T = (s) => IO.pdfText(String(s));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(T('Fotopunkt: ' + pt.name), 15, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(T(pt.fotos.length + ' Fotos · ' + datum(pt.fotos[0] && pt.fotos[0].at) + ' bis ' + datum(pt.fotos[pt.fotos.length - 1].at) + (pt.notiz ? ' · ' + pt.notiz : '')), 15, 24);
    doc.setTextColor(0);
    let y = 32;
    for (const f of pt.fotos) {
      const j = await F().jpegDataUrl(f.id, 1400).catch(() => null); if (!j) continue;
      const bw = 180; const bh = Math.min(115, bw * j.h / j.w); const ww = bh * j.w / j.h;
      if (y + bh + 8 > 287) { doc.addPage(); y = 15; }
      doc.addImage(j.url, 'JPEG', 15 + (bw - ww) / 2, y, ww, bh); doc.setFontSize(9); doc.text(T(datum(f.at)), 15, y + bh + 4.5); y += bh + 10;
    }
    doc.setFontSize(7); doc.setTextColor(120); doc.text(T('AGFF Wiese (Beta) · Standort nicht enthalten'), 15, 292);
    const blob = doc.output('blob'); const url = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = url; el.download = 'Fotopunkt_' + pt.name.replace(/[^\wäöüÄÖÜ-]+/g, '_') + '.pdf'; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // =====================================================================
  // Übersicht «Wiese mit Kamera»
  // =====================================================================
  function render() {
    const refs = refsLaden();
    const karte = (wi, t, s, extra) => '<button class="wi-karte" data-wi="' + wi + '"' + (extra || '') + '><b>' + t + '</b><span>' + s + '</span></button>';
    const aufgabe = (wi, t, text, knoepfe) => '<div class="wi-aufgabe"><div class="wi-aufgabe-t"><b>' + t + '</b><span>' + text + '</span></div><div class="row">' + knoepfe + '</div></div>';
    const kn = (wi, t, primaer) => '<button class="btn' + (primaer ? ' primary' : '') + ' grow" data-wi="' + wi + '">' + t + '</button>';
    const weiter = MODUS_WIESE ? 'Ergebnisse (Bestand, Stadium) lassen sich in der <a href="' + '/futter/v2/' + '">Futterbeurteilung</a> als Probe weiterverwenden.'
      : 'Aus einer Probe in der App «Futter» heraus («Bestand» bzw. «Stadium») werden die Ergebnisse direkt übernommen. Hier ohne Probe: Ergebnis ansehen und bei Bedarf eine neue Probe anlegen.';
    return '<div class="bar"><h2>Wiese beurteilen<span class="sub">Bestand, Stadium und Ertrag – im Feld, mit dem Handy</span></h2></div><div class="pad wiese">' +
      '<p class="wi-lead">Was möchten Sie tun?</p>' +
      (kannKamera() ? '' : '<div class="alert info">Live-Kamera in diesem Browser nicht verfügbar – die Werkzeuge arbeiten dann mit einem Foto aus der Kamera-App.</div>') +
      '<div class="wi-aufgaben">' +
      aufgabe('aufnahmen', '📋 Wiese aufnehmen', 'Der ganze Ablauf nach AGFF-Merkblatt 8 in einem Formular: Bestand, Standort, Zielbestand und Massnahmen.', kn('aufnahmen', 'Wiesenaufnahme starten', true)) +
      aufgabe('raster', '🌿 Bestand schnell schätzen', 'Gräser, Klee und Kräuter in 2 Minuten: Punktraster antippen, die App schlägt den Bestandestyp vor.', kn('raster', 'Punktraster starten', true)) +
      aufgabe('stadium', '✂️ Wann mähen?', 'Entwicklungsstadium mit den AGFF-Bildern vergleichen und den Ertrag aus der Wuchshöhe schätzen.', kn('stadium', 'Stadium vergleichen') + kn('hoehe', 'Höhe &amp; Ertrag')) +
      '</div>' +
      '<div class="wi-karten wi-klein">' +
      karte('pflanzen', 'Pflanzen bestimmen', 'Nach Merkmalen, mit Kamera-Lupe') +
      karte('fotopunkte', 'Fotopunkte', 'Dieselbe Stelle über die Zeit') +
      karte('karte-pdf', 'Messkarte drucken', 'A4: Raster, Höhe, Farbe, Bestimmungshilfen') +
      '</div>' +
      '<p class="hint">' + weiter + '</p>' +
      (refs.length ? '<section class="q"><h3>Eigene Referenzbilder (' + refs.length + ')</h3><p class="qhint">Erscheinen beim Stadienvergleich zuerst. Nur auf diesem Gerät.</p><div class="fotos">' +
        refs.map((r) => '<button type="button" class="foto-thumb" data-wi="ref-loeschen" data-id="' + r.id + '" aria-label="Referenzbild löschen"><img alt="" data-ref-img="' + r.id + '"><span class="foto-art">' + esc(K3().REFERENZPFLANZEN[r.lp].split(' /')[0]) + ' · ' + r.st + '</span></button>').join('') + '</div></section>' : '') +
      '<section class="q"><h3>Grenzen</h3><ul class="small" style="margin:0;padding-left:18px"><li>Das Raster misst die Deckung von oben, nicht den Gewichtsanteil – Vorschläge immer mit dem eigenen Blick abgleichen.</li>' +
      '<li>Gegenlicht, Tau und harte Schatten stören die Lückenerkennung; am besten mit der Sonne im Rücken.</li><li>Die Lückenerkennung unterscheidet nur grün und nicht grün – Arten erkennt sie nicht.</li>' +
      '<li>Ersetzt keine botanische Bestandesaufnahme nach Fachmethode.</li></ul></section></div>';
  }

  // ---------- Eigene App «Wiesenbeurteilung»: Menü (links bzw. Startseite auf dem Handy) und Liste ----------
  function renderNav(r, umschalter, linkUnten) {
    const A = app(); const I = A.I;
    const li = (href, ico, t, sub, aktiv) => '<li><a class="item" href="' + href + '" aria-current="' + !!aktiv + '"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">' + ico + '</span><span><span class="t">' + t + '</span><span class="s">' + sub + '</span></span></a></li>';
    const lb = (wi, ico, t, sub) => '<li><button type="button" class="item" data-wi="' + wi + '" style="width:100%;text-align:left;background:none;border:0;cursor:pointer;color:inherit"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">' + ico + '</span><span><span class="t">' + t + '</span><span class="s">' + sub + '</span></span></button></li>';
    return '<div class="bar"><div class="brand"><img src="assets/icon-wiese.svg" alt=""><div><b>' + (MODUS_WIESE ? 'Wiese' : 'Wiesenbeurteilung') + '</b><span class="sub">Bestand · Stadium · Pflanzen <span class="badge-beta">' + (MODUS_WIESE ? 'Wiese Beta' : 'v2 Beta 1') + '</span></span></div></div>' +
      A.modusKnopf() + '</div>' + umschalter +
      '<div class="pad stack"><button class="btn primary block" data-wi="raster" style="min-height:56px">' + I.camera + ' Bestand schätzen (Punktraster)</button>' +
      '<div class="row"><button class="btn sm grow" data-wi="stadium">Stadium vergleichen</button><button class="btn sm grow" data-wi="hoehe">Höhe &amp; Ertrag</button></div></div>' +
      '<div class="section-title" style="padding:0 12px">Werkzeuge</div><ul class="list" style="padding:0 8px">' +
      li('#/aufnahmen', '📋', 'Wiesenaufnahme', 'Bestand, Standort, Ziel, Massnahmen (AGFF-Merkblatt 8)', r.name === 'aufnahmen') +
      li('#/pflanzen', '🌿', 'Pflanzen bestimmen', 'AGFF-Schlüssel, Suche, Porträts', r.name === 'pflanzen') +
      li('#/fotopunkte', '📍', 'Fotopunkte', FP.length ? FP.length + ' Punkte · Vorher/Nachher' : 'Dieselbe Stelle über die Zeit', r.name === 'fotopunkte') +
      lb('karte-pdf', '🖨', 'Messkarte drucken', 'Raster 50 × 50 cm, Höhe, Farbe') +
      li('#/wiese', I.camera.replace('<svg', '<svg width="22" height="22"'), 'Übersicht', 'Alle Werkzeuge und Grenzen', r.name === 'wiese') + '</ul>' +
      '<div class="section-title" style="padding:0 12px">Daten & Hilfe</div><ul class="list" style="padding:0 8px 24px">' +
      li('#/hilfe', '?', 'Hilfe & Merkblätter', 'Unterlagen, Pflanzentabelle, Quellen', r.name === 'hilfe') +
      li('#/daten', I.lock.replace('<svg', '<svg width="22" height="22"'), 'Speicherort, Sicherung', 'Daten liegen nur in diesem Browser', r.name === 'daten') + '</ul>' + (linkUnten || '');
  }
  /** Mittlere Spalte: «Meine Wiesen» – Aufnahmen und Fotopunkte nach Parzelle gruppiert, jüngste zuerst. Auf der Seite Fotopunkte: die Fotopunkt-Liste. */
  function renderListe(r) {
    FP = fpLaden();
    if (r && r.name === 'fotopunkte') return fpListe(r);
    const A = app(); const nk = (t) => String(t || '').trim().toLowerCase();
    const gruppen = new Map(); const add = (label, item) => { const k = nk(label) || '–'; if (!gruppen.has(k)) gruppen.set(k, { label: label || 'Ohne Parzelle', items: [] }); gruppen.get(k).items.push(item); };
    FP.forEach((p) => { const l = p.fotos[p.fotos.length - 1]; add(p.name, { href: '#/fotopunkte/' + p.id, ico: '📍', t: 'Fotopunkt', s: p.fotos.length + (p.fotos.length === 1 ? ' Foto' : ' Fotos') + (l ? ' · zuletzt ' + datum(l.at) : ''), d: (l && l.at) || p.createdAt, aktiv: r.name === 'fotopunkte' && r.id === p.id }); });
    ((global.Aufnahme && global.Aufnahme.liste()) || []).forEach((a) => {
      const fp = a.kopf.fotopunkt && FP.find((x) => x.id === a.kopf.fotopunkt); const e = global.Aufnahme._t.auswerten(a);
      add(fp ? fp.name : (a.kopf.parzelle || a.kopf.ort), { href: '#/aufnahmen/' + a.id, ico: '📋', t: 'Wiesenaufnahme' + (a.kopf.datum ? ' ' + datum(a.kopf.datum) : ''), s: [e.typ ? 'Typ ' + e.typText.split(' ')[0] : '', e.g != null ? 'G ' + e.g + ' · K ' + e.kl + ' · Kr ' + e.kr + ' %' : ''].filter(Boolean).join(' · ') || 'noch offen', d: a.kopf.datum || a.createdAt, aktiv: r.name === 'aufnahmen' && r.id === a.id });
    });
    const gl = [...gruppen.values()].map((g) => { g.items.sort((x, y) => (y.d > x.d ? 1 : -1)); g.neu = g.items[0].d || ''; return g; }).sort((x, y) => (y.neu > x.neu ? 1 : -1));
    return '<div class="bar"><h2>Meine Wiesen<span class="sub">' + (gl.length ? gl.length + (gl.length === 1 ? ' Parzelle' : ' Parzellen') : 'noch keine') + '</span></h2></div>' +
      '<div class="pad" style="padding-bottom:0"><div class="row"><a class="btn primary grow" href="#/aufnahmen" data-wi="aufnahmen-neu">' + A.I.plus + ' Wiesenaufnahme</a><button class="btn grow" data-wi="fp-neu">' + A.I.plus + ' Fotopunkt</button></div></div>' +
      (gl.length ? gl.map((g) => '<div class="section-title" style="padding:10px 12px 0">' + esc(g.label) + ' <span class="muted small">(' + g.items.length + ')</span></div><ul class="list" style="padding:4px 8px">' +
        g.items.map((i) => '<li><a class="item" href="' + i.href + '" aria-current="' + !!i.aktiv + '"><span class="avatar" style="background:var(--surface-2)">' + i.ico + '</span><span style="min-width:0"><span class="t">' + esc(i.t) + '</span><span class="s">' + esc(i.s) + '</span></span></a></li>').join('') + '</ul>').join('')
        : '<ul class="list" style="padding:8px"><li class="empty small">Hier erscheinen Ihre Wiesenaufnahmen und Fotopunkte, nach Parzelle geordnet. Beginnen Sie mit einer Wiesenaufnahme.</li></ul>');
  }
  function fpListe(r) {
    return '<div class="bar"><h2>Fotopunkte<span class="sub">' + (FP.length ? FP.length + ' Punkte' : 'noch keine') + '</span></h2><button class="icon-btn" data-wi="fp-neu" aria-label="Neuer Fotopunkt">' + app().I.plus + '</button></div>' +
      '<ul class="list" style="padding:8px">' + (FP.length ? FP.map((p) => { const l = p.fotos[p.fotos.length - 1]; return '<li><a class="item" href="#/fotopunkte/' + p.id + '" aria-current="' + (r.name === 'fotopunkte' && r.id === p.id) + '">' + (l ? '<img class="fp-mini" alt="" data-fp-img="' + l.id + '">' : '<span class="avatar">FP</span>') + '<span style="min-width:0"><span class="t">' + esc(p.name) + '</span><span class="s">' + p.fotos.length + ' Fotos' + (l ? ' · ' + datum(l.at) : '') + '</span></span></a></li>'; }).join('')
        : '<li class="empty small">Mit Fotopunkten dieselbe Stelle immer wieder fotografieren – z. B. vor und nach einer Übersaat.</li>') + '</ul>';
  }

  function lpSheet() {
    app().sheet('<h2>Leitpflanze wählen</h2><div class="stack">' + K3().REFERENZPFLANZEN.map((n, i) => '<button class="btn block" data-wi="stadium-lp" data-lp="' + i + '">' + esc(n) + '</button>').join('') + '<button class="btn ghost block" data-close>Abbrechen</button></div>');
  }

  /** Klicks auf [data-wi] (Seite und Sheets). */
  function handle(e) {
    const t = e.target.closest('[data-wi]'); if (!t) return false;
    const w = t.dataset.wi; const id = t.dataset.id; const A = app();
    const p = A.route().name === 'probe' ? A.probeById(A.route().id) : null;
    switch (w) {
      case 'raster': A.closeSheet(); bestandStarten(t.dataset.probe || null); break;
      case 'raster-weiter': A.closeSheet(); bestandStarten(RS && RS.pid, true); break;
      case 'raster-ok': rasterUebernehmen(RS && RS.pid ? A.probeById(RS.pid) : null); break;
      case 'raster-neu': { const v = vorschlag(RS.n); const pr = A.neueProbe(t.dataset.typ, null, { bestand: v.id, raster: Object.assign({}, RS.n, { k: RS.k }) }); RS = null; A.closeSheet(); A.go('#/p/' + pr.id + '/stadium'); break; }
      case 'raster-weg': RS = null; A.closeSheet(); break;
      case 'raster-aufnahme': { const z = RS && RS.aufnahme; const v = z && vorschlag(RS.n); RS = null; A.closeSheet(); if (z && v && global.Aufnahme) global.Aufnahme.rasterUebernehmen(z, v); break; }
      case 'hoehe': A.closeSheet(); hoeheStarten(t.dataset.probe || null); break;
      case 'hoehe-weiter': A.closeSheet(); hoeheStarten(HS && HS.pid, true); break;
      case 'hoehe-ok': { const pr = HS && HS.pid && A.probeById(HS.pid); if (pr) { pr.antworten.wuchshoehe = Math.round(HS.werte.reduce((s, x) => s + x, 0) / HS.werte.length); pr.antworten.hoeheN = HS.werte.length; A.touchProbe(pr); A.rerenderDetail(true); toast('Wuchshöhe übernommen.'); } HS = null; A.closeSheet(); break; }
      case 'hoehe-weg': HS = null; A.closeSheet(); break;
      case 'stadium': A.closeSheet(); if (t.dataset.probe) stadiumStarten(t.dataset.probe); else lpSheet(); break;
      case 'stadium-lp': A.closeSheet(); stadiumStarten(null, Number(t.dataset.lp)); break;
      case 'karte-pdf': messkartePdf().catch((er) => toast(er.message)); break;
      case 'fotopunkte': A.go('#/fotopunkte'); break;
      case 'aufnahmen-neu': e.preventDefault(); if (global.Aufnahme) global.Aufnahme.neuAnlegen(); break;
      case 'aufnahmen': A.go('#/aufnahmen'); break;
      case 'pflanzen': A.go('#/pflanzen'); break;
      case 'fp-neu': fpNeuSheet(); break;
      case 'fp-anlegen': fpAnlegen(); break;
      case 'fp-foto': richtungErlauben(); fpFoto(id); break;
      case 'fp-fuehren': fpFuehren(id); break;
      case 'fp-standort': {
        const pt = fpById(id); if (!pt) break;
        if (!navigator.geolocation) { toast('Dieses Gerät liefert keinen Standort.'); break; }
        if (pt.lat != null && !confirm('Gespeicherten Standort durch den aktuellen ersetzen?')) break;
        toast('Standort wird bestimmt …');
        navigator.geolocation.getCurrentPosition((p) => {
          const q = fpById(id); if (!q) return;
          q.lat = p.coords.latitude; q.lon = p.coords.longitude; q.acc = p.coords.accuracy; fpSpeichern();
          toast('Standort gespeichert (± ' + Math.round(q.acc) + ' m).' + (q.acc > 30 ? ' Ungenau – ggf. später im Freien wiederholen.' : '')); A.render();
        }, (e) => toast(e && e.code === 1 ? 'Kein Zugriff auf den Standort.' : 'Standort nicht verfügbar.'), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        break;
      }
      case 'fp-standort-weg': { const pt = fpById(id); if (pt && confirm('Standort und Blickrichtung dieses Fotopunkts entfernen?')) { pt.lat = pt.lon = pt.acc = pt.richtung = null; fpSpeichern(); A.render(); } break; }
      case 'fp-vergleich': fpVergleich(id); break;
      case 'fp-pdf': fpPdf(id).catch((er) => toast(er.message)); break;
      case 'fp-zeigen': {
        const pt = fpById(id); const fid = t.dataset.foto; const f = pt && pt.fotos.find((x) => x.id === fid); if (!f) break;
        F().bildUrl(fid).then((u) => A.sheet('<h2>' + esc(pt.name) + '</h2><p class="small muted" style="margin-top:0">' + datum(f.at) + '</p>' + (u ? '<img class="foto-gross" alt="" src="' + u + '">' : '<p class="muted">Foto fehlt.</p>') +
          '<div class="row"><button class="btn danger grow" data-wi="fp-foto-loeschen" data-id="' + pt.id + '" data-foto="' + fid + '">Löschen</button><button class="btn ghost grow" data-close>Schliessen</button></div>'));
        break;
      }
      case 'fp-foto-loeschen': {
        const pt = fpById(id); if (!pt || !confirm('Foto löschen?')) break;
        pt.fotos = pt.fotos.filter((f) => f.id !== t.dataset.foto); F().del(t.dataset.foto).catch(() => {}); fpUrls.delete(t.dataset.foto);
        fpSpeichern(); A.closeSheet(); A.render(); break;
      }
      case 'fp-umbenennen': { const pt = fpById(id); const n = pt && prompt('Neuer Name', pt.name); if (n && n.trim()) { pt.name = n.trim().slice(0, 80); fpSpeichern(); A.render(); } break; }
      case 'fp-loeschen': {
        const pt = fpById(id); if (!pt || !confirm('Fotopunkt «' + pt.name + '» mit ' + pt.fotos.length + ' Fotos löschen?')) break;
        pt.fotos.forEach((f) => F().del(f.id).catch(() => {})); FP = FP.filter((x) => x.id !== id); fpSpeichern(); A.go('#/fotopunkte'); break;
      }
      case 'ref-loeschen': if (confirm('Eigenes Referenzbild löschen?')) { schreiben(KEY_REF, refsLaden().filter((r) => r.id !== id)); F().del(id).catch(() => {}); A.render(); } break;
      default: return false;
    }
    void p;
    return true;
  }

  // ---------- Schnittstellen für app.js ----------
  /** Knöpfe im Schritt «Bestand». */
  function bestandKnopf(p) {
    const r = p.antworten.raster; const v = r && vorschlag(r);
    return '<div class="wi-inline"><button class="btn" data-wi="raster" data-probe="' + p.id + '">' + app().I.camera + ' Mit Kamera schätzen (Punktraster)</button>' +
      (v ? '<span class="small muted">Letzte Erhebung: ' + v.pfl + ' Pflanzenpunkte · Gräser ' + Math.round(v.gras * 100) + ' % · Klee ' + Math.round(v.kl * 100) + ' % · Kräuter ' + Math.round((v.kf + v.kg) * 100) + ' % → ' + esc(K3().BESTAENDE.find((b) => b.id === v.id).kurz) + '</span>' : '') + '</div>';
  }
  /** Knöpfe im Schritt «Stadium». */
  function stadiumKnopf(p) {
    const a = p.antworten;
    return '<div class="wi-inline">' + (a.aufwuchs === '1' ? '<button class="btn" data-wi="stadium" data-probe="' + p.id + '">' + app().I.camera + ' Mit Kamera vergleichen</button>' : '') +
      (a.wuchshoehe ? '<span class="small muted">Wuchshöhe ≈ ' + a.wuchshoehe + ' cm' + (a.hoeheN > 1 ? ' (' + a.hoeheN + ' Messungen)' : '') + '</span>' : '') + '</div>';
  }
  function fotoIds() { return fpLaden().flatMap((p) => p.fotos.map((f) => f.id)).concat(refsLaden().map((r) => r.id)); }
  function sicherung() { return { fotopunkte: fpLaden(), referenzen: refsLaden(), aufnahmen: global.Aufnahme ? global.Aufnahme.sicherung() : [] }; }
  function wiederherstellen(w) {
    if (!w || typeof w !== 'object') return;
    const alt = fpLaden(); const fp = Array.isArray(w.fotopunkte) ? w.fotopunkte : [];
    schreiben(KEY_FP, alt.concat(fp.filter((x) => x && !alt.some((a) => a.id === x.id)))); FP = fpLaden();
    const ar = refsLaden(); const rf = Array.isArray(w.referenzen) ? w.referenzen : [];
    schreiben(KEY_REF, ar.concat(rf.filter((x) => x && !ar.some((a) => a.id === x.id))));
    if (global.Aufnahme && Array.isArray(w.aufnahmen)) global.Aufnahme.wiederherstellen(w.aufnahmen);
  }
  function allesLoeschen() { try { localStorage.removeItem(KEY_FP); localStorage.removeItem(KEY_REF); } catch (e) { /* ignore */ } FP = []; RS = null; HS = null; if (global.Aufnahme) global.Aufnahme.allesLoeschen(); }

  global.Wiese = {
    render, renderFotopunkte, renderNav, renderListe, handle, rasterFuer, fotopunkte: () => fpLaden(), neuLaden: () => { FP = fpLaden(); }, plausi, nachRender: bilderEinsetzen, bestandKnopf, stadiumKnopf, farbabgleich, fotoIds, sicherung, wiederherstellen, allesLoeschen, kamera, zu,
    // für Tests
    _t: { vorschlag, homographie, invers, proj, karteFinden, KARTE, exg, unsicher },
  };
})(window);
