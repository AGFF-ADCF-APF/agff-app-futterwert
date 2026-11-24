/* Futter v2 – Tastatur am Computer.
 * 1–9 Option wählen · ↑/↓ Faktor im Rad · Enter bzw. Ctrl+Enter weiter · Alt+←/→ voriger/nächster Schritt ·
 * Esc schliessen · / oder Ctrl+K Suche (Pflanzen) · ? Übersicht · Ctrl kurz halten: Kürzel an den Knöpfen anzeigen.
 * In Textfeldern wirken nur Ctrl+Enter und Esc. Auf Touch-Geräten ohne Tastatur ändert sich nichts.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const $$ = (q, r) => Array.from((r || document).querySelectorAll(q));
  const sichtbar = (el) => !!(el && el.offsetParent !== null && !el.disabled);
  const imText = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && !/^(checkbox|radio|button|range)$/.test(el.type || '');

  const sheetOffen = () => !!document.querySelector('#sheet-root .sheet');
  const kameraOffen = () => !!document.querySelector('.cam');
  /** Bereich, auf den die Tasten wirken: offenes Sheet, sonst der Arbeitsbereich. */
  const bereich = () => document.querySelector('#sheet-root .sheet') || document.getElementById('main');

  function optionen() {
    const r = bereich(); if (!r) return [];
    const opts = $$('.opt, .seg button[data-set], .plant-chips [data-set]', r).filter(sichtbar);
    return opts.length ? opts : $$('.pf-spalte, .pf-zweig, .tier-schalter, .app-knopf', r).filter(sichtbar);
  }
  const weiterKnopf = () => (sheetOffen() ? null : document.querySelector('#main .actionbar .split-btn .btn.primary, #main .actionbar .btn.primary'));
  const ueberspringen = () => document.querySelector('#main .actionbar .split-neben');
  function schritt(d) {
    const chips = $$('#main .steps .step-chip'); const i = chips.findIndex((c) => c.getAttribute('aria-current') === 'step');
    const z = chips[i + d]; if (z) z.click();
  }
  function faktor(d) {
    const fs = $$('#main .factor-nav [data-fokus]'); if (!fs.length) return false;
    const i = fs.findIndex((f) => f.getAttribute('aria-current') === 'true');
    fs[(i + d + fs.length) % fs.length].click(); return true;
  }

  // ---------- Kürzel anzeigen (Ctrl halten) ----------
  let hinweisTimer = 0;
  function hinweiseAn() {
    hinweiseAus();
    optionen().slice(0, 9).forEach((el, i) => { el.dataset.kb = String(i + 1); });
    const w = weiterKnopf(); if (w) w.dataset.kb = '⏎';
    const u = ueberspringen(); if (u) u.dataset.kb = 'Alt →';
    $$('#main .factor-nav [aria-current="true"]').forEach((el) => { el.dataset.kb = '↑↓'; });
    const s = document.querySelector('.pf-such-badge'); if (s) s.dataset.kb = '/';
    document.documentElement.classList.add('kb-hinweise');
  }
  function hinweiseAus() {
    clearTimeout(hinweisTimer);
    document.documentElement.classList.remove('kb-hinweise');
    $$('[data-kb]').forEach((el) => { delete el.dataset.kb; });
  }

  function uebersicht() {
    const z = (k, t) => '<tr><td><kbd>' + k.split(' + ').join('</kbd> + <kbd>') + '</kbd></td><td>' + t + '</td></tr>';
    app().sheet('<h2>Tastaturkürzel</h2><table class="wi-tab kb-tab">' +
      z('1 … 9', 'Option wählen (im Rad: Ausprägung des aktiven Faktors)') +
      z('↑ / ↓', 'Im Rad: vorheriger / nächster Faktor') +
      z('Enter', 'Weiter (nächster Faktor bzw. nächster Schritt)') +
      z('Ctrl + Enter', 'Weiter – auch aus einem Textfeld heraus') +
      z('Alt + →', 'Nächster Schritt (im Rad: direkt zum Ergebnis)') +
      z('Alt + ←', 'Vorheriger Schritt') +
      z('Esc', 'Dialog oder Kamera schliessen') +
      z('/ oder Ctrl + K', 'Suche (Pflanzen bestimmen)') +
      z('?', 'Diese Übersicht') +
      z('Ctrl (halten)', 'Kürzel an den Knöpfen anzeigen') + '</table>' +
      '<p class="hint">In Textfeldern wirken nur Ctrl+Enter und Esc. Mit Tab und Leertaste lässt sich wie gewohnt jedes Element bedienen.</p><button class="btn block" data-close>Schliessen</button>');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !e.repeat && !e.altKey && !e.shiftKey && !e.metaKey) { clearTimeout(hinweisTimer); hinweisTimer = setTimeout(hinweiseAn, 450); return; }
    if (e.key !== 'Control') hinweiseAus();
    if (kameraOffen() || e.metaKey) return;
    const t = e.target; const text = imText(t);
    // Ctrl+Enter: weiter, auch aus Textfeldern
    if (e.key === 'Enter' && (e.ctrlKey)) { const w = weiterKnopf(); if (w) { e.preventDefault(); if (text) t.blur(); w.click(); } return; }
    if ((e.key === 'k' || e.key === 'K') && e.ctrlKey && !e.altKey) { const s = document.querySelector('.pf-such-badge') || document.getElementById('pfSuche'); if (s) { e.preventDefault(); if (s.id === 'pfSuche') s.focus(); else s.click(); } return; }
    if (text || e.ctrlKey) return;
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      if (sheetOffen()) return;
      e.preventDefault();
      if (e.key === 'ArrowRight') { const u = ueberspringen(); if (u) u.click(); else schritt(1); } else schritt(-1);
      return;
    }
    if (e.altKey) return;
    if (/^[1-9]$/.test(e.key)) { const o = optionen()[Number(e.key) - 1]; if (o) { e.preventDefault(); o.click(); } return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !sheetOffen() && document.querySelector('#main .factor-nav')) { e.preventDefault(); faktor(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter') {
      // Enter auf einem fokussierten Knopf wirkt normal – ausser auf einer bereits gewählten Option (sonst würde sie abgewählt)
      if (t && t.closest && t.closest('button, a, summary, [role="button"]') && t !== document.body && !t.closest('.opt')) return;
      const w = weiterKnopf(); if (w) { e.preventDefault(); w.click(); }
      return;
    }
    if (e.key === '/') { const s = document.querySelector('.pf-such-badge'); if (s) { e.preventDefault(); s.click(); } return; }
    if (e.key === '?') { e.preventDefault(); uebersicht(); }
  });
  document.addEventListener('keyup', (e) => { if (e.key === 'Control') hinweiseAus(); });
  global.addEventListener('blur', hinweiseAus);

  global.Tastatur = { uebersicht };
})(window);
