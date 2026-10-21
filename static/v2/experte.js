/* Futter v2 – Seite für Expertinnen und Experten: zugeteilte Pendenzen abhaken, Korrektur melden, Notiz hinterlassen.
 * Zugang über den persönlichen Link (#t=…); das Token bleibt im Browser und geht nur als Kopfzeile an den Server. */
(function () {
  'use strict';
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{43})/.exec(location.hash || '');
  const token = m ? m[1] : '';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const datum = (d) => (d ? new Date(d).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const STATUS = { offen: 'offen', korrektur: 'Korrektur gemeldet', erledigt: 'erledigt' };
  const ART = { notiz: 'Notiz', korrektur: 'Korrektur', erledigt: 'abgehakt', offen: 'wieder geöffnet', status: 'Status' };
  const href = (u) => (u.startsWith('#') || u.startsWith('?') ? './' + u : u);
  async function api(pfad, o) {
    const r = await fetch('api/' + pfad, Object.assign({ cache: 'no-store', credentials: 'omit' }, o || {}, { headers: { 'Content-Type': 'application/json', 'X-Experte': token } }));
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r;
  }
  async function laden() {
    if (!token) { $('#inhalt').innerHTML = '<p class="alert">Dieser Link ist unvollständig. Bitte den ganzen Link aus der E-Mail verwenden.</p>'; return; }
    let d;
    try { d = await (await api('experte/pendenzen')).json(); } catch (e) {
      $('#inhalt').innerHTML = '<p class="alert">' + (e.status === 429 ? 'Zu viele Versuche – bitte später erneut.' : 'Dieser Link ist nicht (mehr) gültig. Bitte bei der AGFF einen neuen Link anfordern.') + '</p>'; return;
    }
    const offen = d.pendenzen.filter((p) => p.status !== 'erledigt').length;
    $('#inhalt').innerHTML = '<p>Guten Tag ' + esc(d.name) + '. Ihnen ' + (d.pendenzen.length === 1 ? 'ist eine Pendenz' : 'sind ' + d.pendenzen.length + ' Pendenzen') + ' zugeteilt' + (d.pendenzen.length ? ', davon ' + offen + ' offen' : '') + '.</p>' +
      '<p class="small muted">Bitte die betroffenen Stellen prüfen. Danach abhaken, eine Korrektur melden (was soll geändert werden?) oder eine Notiz hinterlassen. Die AGFF sieht Ihre Einträge in der Administration.</p>' +
      (d.pendenzen.length ? d.pendenzen.map(karte).join('') : '<p class="muted">Zurzeit keine Pendenzen.</p>');
  }
  function karte(p) {
    return '<section class="card stack pend ' + p.status + '" style="margin:10px 0"><div><span class="chip">' + esc(STATUS[p.status]) + '</span> <b>' + esc(p.titel) + '</b></div>' +
      (p.text ? '<p style="white-space:pre-wrap;margin:0">' + esc(p.text) + '</p>' : '') +
      (p.stellen.length ? '<div><b class="small">Betroffene Stellen</b><ul>' + p.stellen.map((s) => '<li><a href="' + esc(href(s.url)) + '" target="_blank" rel="noopener">' + esc(s.label) + ' ↗</a></li>').join('') + '</ul></div>' : '') +
      (p.anhaenge.length ? '<div><b class="small">Anhänge</b><ul>' + p.anhaenge.map((a) => '<li><button class="btn sm ghost" data-dl="' + a.id + '" data-name="' + esc(a.name) + '">⬇ ' + esc(a.name) + '</button> <span class="small muted">' + Math.round(a.bytes / 1024) + ' KB</span></li>').join('') + '</ul></div>' : '') +
      (p.verlauf.length ? '<details><summary class="small">Verlauf (' + p.verlauf.length + ')</summary><ul class="small">' + p.verlauf.map((v) => '<li><b>' + esc(v.von) + '</b> · ' + esc(ART[v.art] || v.art) + ' · ' + datum(v.at) + (v.text ? '<br><span style="white-space:pre-wrap">' + esc(v.text) + '</span>' : '') + '</li>').join('') + '</ul></details>' : '') +
      '<form class="stack" data-id="' + p.id + '"><textarea class="input" name="text" rows="3" placeholder="Korrektur (was genau ändern?) oder Notiz"></textarea>' +
      '<div class="row" style="flex-wrap:wrap"><button class="btn" data-a="korrektur">Korrektur melden</button><button class="btn" data-a="notiz">Notiz speichern</button>' +
      (p.status === 'erledigt' ? '<button class="btn" data-a="offen">Wieder öffnen</button>' : '<button class="btn primary" data-a="erledigt">✓ Geprüft, abhaken</button>') + '</div></form></section>';
  }
  document.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-dl]');
    if (dl) {
      try { const r = await api('experte/anhang/' + dl.dataset.dl); const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = dl.dataset.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
      catch (er) { alert('Download nicht möglich (' + er.message + ').'); }
      return;
    }
    const b = e.target.closest('form [data-a]'); if (!b) return;
    e.preventDefault();
    const f = b.closest('form'); const text = f.elements.text.value.trim(); const aktion = b.dataset.a;
    if ((aktion === 'korrektur' || aktion === 'notiz') && !text) { f.elements.text.focus(); f.elements.text.placeholder = 'Bitte zuerst Text eingeben'; return; }
    b.disabled = true;
    try { await api('experte/pendenzen/' + f.dataset.id, { method: 'POST', body: JSON.stringify({ aktion, text }) }); await laden(); }
    catch (er) { alert('Speichern nicht möglich (' + er.message + ').'); b.disabled = false; }
  });
  document.addEventListener('submit', (e) => e.preventDefault());
  laden();
})();
