/* Futter v2 – gelber Beta-Badge oben rechts und Rückmeldeformular («Diese App gefällt mir»).
 * Anonym: gesendet werden nur Daumen, freiwilliger Text, App (futter/wiese) und Build. Daneben der Link zurück zu v1.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const DAUMEN = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M7 10l4-7a2.5 2.5 0 0 1 3 2.8L13.4 9H19a2 2 0 0 1 2 2.3l-1.3 7.6A2.5 2.5 0 0 1 17.2 21H7"/></svg>';
  function cfg() { try { return JSON.parse(document.getElementById('agff-config').textContent) || {}; } catch (e) { return {}; } }

  function formular() {
    const A = app(); if (!A) return;
    const c = cfg(); let daumen = null;
    A.sheet('<h2>Ihre Rückmeldung zur Beta</h2>' +
      '<form id="rmForm" class="stack"><div><b>Diese App gefällt mir</b><div class="rm-daumen" role="group" aria-label="Diese App gefällt mir">' +
      '<button type="button" class="rm-d hoch" data-rm="hoch" aria-pressed="false" aria-label="Ja, Daumen hoch">' + DAUMEN + '</button>' +
      '<button type="button" class="rm-d runter" data-rm="runter" aria-pressed="false" aria-label="Nein, Daumen runter">' + DAUMEN + '</button></div></div>' +
      '<label class="field"><span>Was sollen wir wissen? <span class="muted">(freiwillig)</span></span><textarea class="input" name="text" rows="4" maxlength="2000" placeholder="Was gefällt Ihnen, was fehlt, was ist unklar?"></textarea></label>' +
      '<p class="hint">Anonym: Wir speichern nur Daumen, Text, App und Datum – keine IP-Adresse, keine Kennung. Bitte keine Namen oder Adressen eintragen.</p>' +
      '<p class="hint" id="rmMsg" role="status"></p>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow" id="rmSenden" disabled>Senden</button></div></form>' +
      '<p class="small" style="margin:14px 0 0;text-align:center"><a href="/futter/">Zur bisherigen Version 1 wechseln</a> <span class="muted">– Ihre Daten in v2 bleiben im Browser.</span></p>', (el) => {
      const senden = el.querySelector('#rmSenden'); const msg = el.querySelector('#rmMsg');
      el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        daumen = b.dataset.rm;
        el.querySelectorAll('[data-rm]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        senden.disabled = false;
      }));
      el.querySelector('#rmForm').addEventListener('submit', async (e) => {
        e.preventDefault(); if (!daumen) return;
        senden.disabled = true; msg.textContent = 'Wird gesendet …';
        try {
          const r = await fetch('api/rueckmeldung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', cache: 'no-store',
            body: JSON.stringify({ daumen, text: String(new FormData(e.target).get('text') || '').slice(0, 2000), app: c.modus === 'wiese' ? 'wiese' : 'futter', build: c.build }) });
          if (!r.ok) throw new Error(r.status === 429 ? 'Zu viele Rückmeldungen – bitte später nochmals.' : 'Senden hat nicht geklappt (' + r.status + ').');
          A.closeSheet(); A.toast('Danke für Ihre Rückmeldung!');
        } catch (er) { msg.textContent = er.message; senden.disabled = false; }
      });
    });
  }

  document.addEventListener('click', (e) => { if (e.target.closest('.beta-ecke button')) formular(); });
  global.Rueckmeldung = { formular };
})(window);
