/* Futter v2 – Fotos: Aufnahme, Verkleinerung (WebP Q90), Schwärzen, Speicherung in IndexedDB.
 *
 * - Neu-Codierung über <canvas> entfernt sämtliche Metadaten (EXIF, GPS-Standort, Kamera).
 * - Laborberichte: Schwärzen-Werkzeug (z. B. Adresse) – gespeichert wird nur die geschwärzte Fassung.
 * - Jedes Foto hat einen eigenen Zufallsschlüssel (für die Server-Ablage, Ende-zu-Ende).
 */
(function (global) {
  'use strict';
  const DB_NAME = 'agff-futter-v2';
  const STORE = 'fotos';
  const MAX_KANTE = { futter: 1600, labor: 2200 };
  const QUALI = 0.9;
  let dbp = null;

  function idb() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        if (!global.indexedDB) { rej(new Error('IndexedDB nicht verfügbar')); return; }
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode); const st = t.objectStore(STORE);
      let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  const put = (rec) => tx('readwrite', (s) => s.put(rec));
  const get = (id) => tx('readonly', (s) => s.get(id));
  const del = (id) => tx('readwrite', (s) => s.delete(id));
  const alleIds = () => tx('readonly', (s) => s.getAllKeys());

  function b64u(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const neueId = () => b64u(crypto.getRandomValues(new Uint8Array(12)));
  const neuerSchluessel = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

  function canvasBlob(canvas, typ, q) { return new Promise((res) => canvas.toBlob(res, typ, q)); }
  /** WebP Q90; Browser ohne WebP-Encoder (ältere Safari) liefern PNG → dann JPEG Q90. */
  async function kodieren(canvas, q) {
    let b = await canvasBlob(canvas, 'image/webp', q);
    if (!b || b.type !== 'image/webp') b = await canvasBlob(canvas, 'image/jpeg', q);
    return b;
  }
  function zeichnen(bild, max) {
    const f = Math.min(1, max / Math.max(bild.width, bild.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bild.width * f); c.height = Math.round(bild.height * f);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bild, 0, 0, c.width, c.height);
    return c;
  }
  async function bildLaden(fileOrBlob) {
    if (global.createImageBitmap) {
      try { return await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' }); } catch (e) { /* Fallback */ }
    }
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(fileOrBlob); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Bild nicht lesbar')); };
      img.src = url;
    });
  }

  /** Datei → verkleinertes, metadatenfreies Bild (Canvas) */
  async function vorbereiten(file, art) {
    if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) throw new Error('Bitte ein Bild wählen.');
    if (file.size > 40 * 1024 * 1024) throw new Error('Bild ist zu gross.');
    const bild = await bildLaden(file);
    return zeichnen(bild, MAX_KANTE[art] || 1600);
  }

  /** Speichert das (ggf. geschwärzte) Canvas als Foto; liefert die Metadaten für die Probe. */
  async function speichern(canvas, art, probeId) {
    const blob = await kodieren(canvas, QUALI);
    const thumb = await kodieren(zeichnen(canvas, 360), 0.8);
    const meta = { id: neueId(), art, w: canvas.width, h: canvas.height, bytes: blob.size, mime: blob.type, createdAt: new Date().toISOString() };
    await put({ id: meta.id, probeId, blob, thumb, mime: blob.type });
    return meta;
  }

  async function thumbUrl(id) { const r = await get(id); return r ? URL.createObjectURL(r.thumb || r.blob) : null; }
  async function bildUrl(id) { const r = await get(id); return r ? URL.createObjectURL(r.blob) : null; }
  async function blob(id) { const r = await get(id); return r ? r.blob : null; }
  /** Vom Server geladenes Bild lokal ablegen (Vorschau neu erzeugen). */
  async function ablegen(id, probeId, b) {
    const c = zeichnen(await bildLaden(b), 360);
    await put({ id, probeId, blob: b, thumb: await kodieren(c, 0.8), mime: b.type });
  }
  /** Für PDF: JPEG-DataURL mit begrenzter Kante */
  async function jpegDataUrl(id, max) {
    const r = await get(id); if (!r) return null;
    const c = zeichnen(await bildLaden(r.blob), max || 1200);
    return { url: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
  }

  // ---------- Schwärzen-Werkzeug ----------
  /**
   * Zeigt das Bild in einem Vollbild-Editor. Rechtecke ziehen = schwärzen.
   * @returns Promise<HTMLCanvasElement|null> (null = abgebrochen)
   */
  function schwaerzen(canvas, titel) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'redact';
      wrap.innerHTML = '<div class="redact-bar"><b>' + (titel || 'Bereiche schwärzen') + '</b><span class="small">Mit dem Finger Rechtecke über Adresse, Namen o. Ä. ziehen.</span>' +
        '<div class="row"><button class="btn sm" data-r="undo">Rückgängig</button><button class="btn sm ghost" data-r="cancel">Abbrechen</button><button class="btn sm primary" data-r="ok">Übernehmen</button></div></div>' +
        '<div class="redact-stage"><canvas></canvas></div>';
      document.body.appendChild(wrap);
      const view = wrap.querySelector('canvas');
      const rects = [];
      let start = null; let cur = null;
      const stage = wrap.querySelector('.redact-stage');
      function fit() {
        const maxW = stage.clientWidth - 16, maxH = stage.clientHeight - 16;
        const f = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
        view.width = Math.round(canvas.width * f); view.height = Math.round(canvas.height * f);
        view._f = f; draw();
      }
      function draw() {
        const ctx = view.getContext('2d'); const f = view._f;
        ctx.drawImage(canvas, 0, 0, view.width, view.height);
        ctx.fillStyle = '#000';
        rects.concat(cur ? [cur] : []).forEach((r) => ctx.fillRect(r.x * f, r.y * f, r.w * f, r.h * f));
      }
      const pos = (e) => { const b = view.getBoundingClientRect(); return { x: (e.clientX - b.left) / view._f, y: (e.clientY - b.top) / view._f }; };
      view.addEventListener('pointerdown', (e) => { view.setPointerCapture(e.pointerId); start = pos(e); cur = null; });
      view.addEventListener('pointermove', (e) => { if (!start) return; const p = pos(e); cur = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }; draw(); });
      view.addEventListener('pointerup', () => { if (cur && cur.w > 4 && cur.h > 4) rects.push(cur); start = null; cur = null; draw(); });
      const done = (ok) => {
        window.removeEventListener('resize', fit); wrap.remove();
        if (!ok) { resolve(null); return; }
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000';
        rects.forEach((r) => ctx.fillRect(r.x, r.y, r.w, r.h));
        canvas._rechtecke = rects.length;
        resolve(canvas);
      };
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        if (b.dataset.r === 'undo') { rects.pop(); draw(); } else done(b.dataset.r === 'ok');
      });
      window.addEventListener('resize', fit);
      requestAnimationFrame(fit);
    });
  }

  /**
   * Automatisch schwärzen (ohne KI): Texterkennung auf dem Gerät, sichtbar bleiben nur erkannte
   * Analysezeilen – alles andere (Adresse, Namen, Kopfzeilen, Unerkanntes) wird abgedeckt.
   * Liefert null, wenn zu wenige Analysezeilen erkannt wurden.
   */
  async function autoSchwaerzen(canvas) {
    let keep = [];
    for (const winkel of [0, 90, 270]) { // Handyfotos liegen oft quer
      const k = (await global.LaborOCR.zeilen(canvas, winkel)).filter((z) => global.LaborOCR.istWertzeile(z.text));
      if (k.length > keep.length) keep = k;
      if (keep.length >= 6) break;
    }
    if (keep.filter((z) => /\d/.test(z.text)).length < 3) return null;
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, out.width, out.height);
    const pad = Math.round(canvas.width / 300);
    keep.forEach(({ bbox: b }) => {
      const x = Math.max(0, b.x0 - pad), y = Math.max(0, b.y0 - pad);
      const w = Math.min(canvas.width, b.x1 + pad) - x, h = Math.min(canvas.height, b.y1 + pad) - y;
      if (w > 0 && h > 0) ctx.drawImage(canvas, x, y, w, h, x, y, w, h);
    });
    return { canvas: out, zeilen: keep.length };
  }

  /**
   * Laborbericht: erst automatisch schwärzen, dann zum Prüfen/Ergänzen ins Schwärzen-Werkzeug.
   * Liefert {canvas, ger} oder null (abgebrochen). ger: 'auto' | 'manuell' | undefined (nichts geschwärzt → nur privat).
   */
  async function laborSchwaerzen(canvas, meldung) {
    let auto = null;
    try { if (meldung) meldung('Schwärze automatisch … (beim ersten Mal wird die Texterkennung geladen, ca. 6 MB)'); auto = await autoSchwaerzen(canvas); } catch (e) { auto = null; }
    const titel = auto ? 'Automatisch geschwärzt: nur Analysezeilen sichtbar – prüfen, ggf. weitere Bereiche abdecken'
      : 'Automatisch nicht möglich – bitte Adresse und Namen selbst abdecken';
    const c = await schwaerzen(auto ? auto.canvas : canvas, titel);
    if (!c) return null;
    let ger = auto ? 'auto' : (c._rechtecke ? 'manuell' : undefined);
    if (!ger && !global.confirm('Sie haben nichts geschwärzt.\n\nDas Foto bleibt deshalb privat: Andere (z. B. im Kurs oder Pool) bekommen es nie zu sehen. Trotzdem speichern?')) return null;
    return { canvas: c, ger };
  }

  /** Vorhandenes Foto nachträglich schwärzen (ersetzt die gespeicherte Fassung). */
  async function nachSchwaerzen(meta, probeId) {
    const r = await get(meta.id); if (!r) return null;
    const c = zeichnen(await bildLaden(r.blob), Math.max(meta.w, meta.h));
    const out = await schwaerzen(c, 'Foto nachträglich schwärzen');
    if (!out) return null;
    const blobNeu = await kodieren(out, QUALI);
    await put({ id: meta.id, probeId, blob: blobNeu, thumb: await kodieren(zeichnen(out, 360), 0.8), mime: blobNeu.type });
    return Object.assign({}, meta, { bytes: blobNeu.size, mime: blobNeu.type, key: undefined, up: false, ger: meta.ger || (out._rechtecke ? 'manuell' : undefined) });
  }

  // ---------- Übertragung zum Server: das Bild selbst (JPEG/WebP ohne Metadaten) ----------
  // Bis 2026-10 waren Fotos mit eigenem Schlüssel je Foto verschlüsselt; solche Altbestände werden noch gelesen.
  function unb64u(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out;
  }
  async function aesKey(keyB64) { return crypto.subtle.importKey('raw', unb64u(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']); }
  async function fuerServer(meta, b) { void meta; return new Uint8Array(await b.arrayBuffer()); }
  async function vomServer(meta, bytes) {
    bytes = new Uint8Array(bytes);
    if (!(bytes[0] === 1 && meta.key)) return new Blob([bytes], { type: meta.mime || 'image/webp' });
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13), additionalData: new TextEncoder().encode('agff-foto|' + meta.id) }, await aesKey(meta.key), bytes.slice(13));
    return new Blob([pt], { type: meta.mime || 'image/webp' });
  }

  async function aufraeumen(gueltigeIds) {
    const set = new Set(gueltigeIds);
    for (const id of await alleIds()) if (!set.has(id)) await del(id);
  }

  global.Fotos = { neueId, neuerSchluessel, vorbereiten, speichern, schwaerzen, laborSchwaerzen, autoSchwaerzen, nachSchwaerzen, thumbUrl, bildUrl, blob, ablegen, jpegDataUrl, del, get, aufraeumen, fuerServer, vomServer, MAX_KANTE };
})(window);
