/* Futter v2 – Administration: Pendenzenliste und Experten (Links, Zuteilung, Anhänge, Verlauf). */
(function (global) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const datum = (d) => (d ? new Date(d).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '–');
  const STATUS = { offen: 'offen', korrektur: 'Korrektur gemeldet', erledigt: 'erledigt' };
  const ART = { notiz: 'Notiz', korrektur: 'Korrektur', erledigt: 'abgehakt', offen: 'wieder geöffnet', status: 'Status' };
  const PRIO = { 1: 'hoch', 2: 'normal', 3: 'tief' };
  /** Stellen-Link: App-Adressen (#/…) relativ zur App, sonst wie angegeben */
  const href = (u) => (u.startsWith('#') || u.startsWith('?') ? './' + u : u);
  const stellenText = (l) => (l || []).map((s) => s.label + ' | ' + s.url).join('\n');
  const stellenAus = (t) => String(t || '').split('\n').map((z) => z.split('|').map((x) => x.trim())).filter((x) => x[0] && x[1]).map(([label, url]) => ({ label, url }));
  const expLink = (token) => location.origin + location.pathname.replace(/admin\/?$/, 'experte') + '#t=' + token;
  let API = null; let D = null; let offen = {};

  async function laden(el, api) {
    API = api; D = await api('admin/pendenzen');
    const ex = D.experten;
    const offenN = D.pendenzen.filter((p) => p.status !== 'erledigt').length;
    el.innerHTML = '<h2>Pendenzen (' + offenN + ' offen)</h2>' +
      D.pendenzen.map((p) => karte(p, ex)).join('') +
      '<details class="card" style="margin:8px 0"><summary><b>+ Neue Pendenz</b></summary><form data-pf="neu" class="stack" style="margin-top:8px">' +
      '<input class="input" name="titel" placeholder="Titel" required><textarea class="input" name="text" rows="4" placeholder="Beschreibung, Auftrag an die Experten"></textarea>' +
      '<textarea class="input" name="stellen" rows="3" placeholder="Betroffene Stellen, je Zeile: Bezeichnung | Adresse (z. B. Laboranalyse | #/labor)"></textarea>' +
      '<select class="input" name="prioritaet"><option value="1">Priorität hoch</option><option value="2" selected>Priorität normal</option><option value="3">Priorität tief</option></select><button class="btn primary">Pendenz anlegen</button></form></details>' +
      '<h2>Experten (' + ex.length + ')</h2><p class="small muted">Jeder Experte erhält einen persönlichen Link und sieht nur die ihm zugeteilten Pendenzen. Der Link wird nur beim Erzeugen angezeigt; «Neuer Link» macht den alten ungültig.</p>' +
      (ex.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>E-Mail</th><th>Status</th><th>zuletzt</th><th></th></tr></thead><tbody>' + ex.map((x) => '<tr><td>' + esc(x.name) + (x.notiz ? '<br><small class="muted">' + esc(x.notiz) + '</small>' : '') + '</td><td>' + esc(x.email || '–') + '</td><td>' + (x.aktiv ? 'aktiv' : 'gesperrt') + '</td><td class="small">' + datum(x.lastSeen) + '</td><td><button class="btn sm" data-ex="' + x.id + '" data-a="link">Neuer Link</button> ' +
        (x.aktiv ? '<button class="btn sm" data-ex="' + x.id + '" data-a="sperren">Sperren</button> ' : '') + '<button class="btn sm danger" data-ex="' + x.id + '" data-a="loeschen">Entfernen</button></td></tr>').join('') + '</tbody></table></div>' : '<p class="small muted">Noch keine Experten erfasst.</p>') +
      '<form data-pf="experte" class="row" style="margin-top:8px;flex-wrap:wrap"><input class="input" name="name" placeholder="Name" required style="flex:2"><input class="input" name="email" type="email" placeholder="E-Mail (optional)" style="flex:2"><input class="input" name="notiz" placeholder="Fachgebiet, Sprache (optional)" style="flex:2"><button class="btn primary">Experte erfassen</button></form>' +
      '<div id="expLink" class="alert info" hidden></div>';
    Object.keys(offen).forEach((id) => { const d = el.querySelector('details[data-p="' + id + '"]'); if (d) d.open = true; });
  }

  function karte(p, ex) {
    return '<details class="card pend ' + p.status + '" data-p="' + p.id + '" style="margin:8px 0"><summary><span class="chip">' + esc(STATUS[p.status]) + '</span> <b>' + esc(p.titel) + '</b> <span class="small muted">· ' + PRIO[p.prioritaet] +
      (p.experten.length ? ' · ' + p.experten.map((id) => esc((ex.find((x) => x.id === id) || {}).name || '?')).join(', ') : ' · noch niemand zugeteilt') + ' · ' + datum(p.updatedAt) + '</span></summary><div class="stack" style="margin-top:8px">' +
      (p.text ? '<p style="white-space:pre-wrap;margin:0">' + esc(p.text) + '</p>' : '') +
      (p.stellen.length ? '<div><b class="small">Betroffene Stellen</b><ul class="small">' + p.stellen.map((s) => '<li><a href="' + esc(href(s.url)) + '" target="_blank" rel="noopener">' + esc(s.label) + '</a></li>').join('') + '</ul></div>' : '') +
      '<div><b class="small">Anhänge</b> ' + (p.anhaenge.length ? '<ul class="small">' + p.anhaenge.map((a) => '<li><button class="btn sm ghost" data-dl="' + a.id + '" data-name="' + esc(a.name) + '">' + esc(a.name) + '</button> <span class="muted">' + Math.round(a.bytes / 1024) + ' KB</span> <button class="btn sm danger" data-anhweg="' + a.id + '">✕</button></li>').join('') + '</ul>' : '<span class="small muted">keine</span>') +
      '<label class="btn sm" style="margin-left:6px">Datei anhängen<input type="file" data-up="' + p.id + '" hidden></label></div>' +
      '<div><b class="small">Experten zuteilen</b><div class="row" style="flex-wrap:wrap;gap:10px">' + (ex.length ? ex.map((x) => '<label class="small"><input type="checkbox" data-zu="' + p.id + '" value="' + x.id + '"' + (p.experten.includes(x.id) ? ' checked' : '') + '> ' + esc(x.name) + '</label>').join('') : '<span class="small muted">zuerst unten Experten erfassen</span>') + '</div></div>' +
      '<div><b class="small">Verlauf</b>' + (p.verlauf.length ? '<ul class="small">' + p.verlauf.map((v) => '<li><b>' + esc(v.von) + '</b> · ' + esc(ART[v.art] || v.art) + ' · ' + datum(v.at) + (v.text ? '<br><span style="white-space:pre-wrap">' + esc(v.text) + '</span>' : '') + '</li>').join('') + '</ul>' : ' <span class="small muted">noch leer</span>') + '</div>' +
      '<form data-pf="notiz" data-id="' + p.id + '" class="row"><input class="input" name="text" placeholder="Notiz hinzufügen" style="flex:1"><button class="btn sm">Speichern</button></form>' +
      '<div class="row" style="flex-wrap:wrap">' + Object.keys(STATUS).filter((s) => s !== p.status).map((s) => '<button class="btn sm" data-st="' + s + '" data-id="' + p.id + '">→ ' + STATUS[s] + '</button>').join('') +
      '<button class="btn sm danger" data-pweg="' + p.id + '">Pendenz löschen</button></div>' +
      '<details><summary class="small">Bearbeiten</summary><form data-pf="edit" data-id="' + p.id + '" class="stack" style="margin-top:6px"><input class="input" name="titel" value="' + esc(p.titel) + '"><textarea class="input" name="text" rows="5">' + esc(p.text) + '</textarea>' +
      '<textarea class="input" name="stellen" rows="4">' + esc(stellenText(p.stellen)) + '</textarea><select class="input" name="prioritaet">' + [1, 2, 3].map((n) => '<option value="' + n + '"' + (p.prioritaet === n ? ' selected' : '') + '>Priorität ' + PRIO[n] + '</option>').join('') + '</select><button class="btn sm primary">Änderungen speichern</button></form></details>' +
      '</div></details>';
  }

  async function herunterladen(pfad, name, header) {
    const r = await fetch('api/' + pfad, { headers: header, cache: 'no-store', credentials: 'omit' });
    if (!r.ok) { alert('Fehler ' + r.status); return; }
    const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function linkZeigen(name, token) {
    const box = document.getElementById('expLink'); const l = expLink(token);
    box.hidden = false; box.innerHTML = '<div>Persönlicher Link für <b>' + esc(name) + '</b> (nur jetzt sichtbar – per E-Mail weitergeben):</div><input class="input" readonly value="' + esc(l) + '" style="width:100%;margin-top:6px"><button class="btn sm" data-copy style="margin-top:6px">Kopieren</button>';
    box.querySelector('[data-copy]').addEventListener('click', () => navigator.clipboard.writeText(l).then(() => { box.querySelector('[data-copy]').textContent = 'Kopiert'; }).catch(() => {}));
  }

  async function klick(e, el, hdr) {
    const t = e.target;
    const det = t.closest('details[data-p]'); if (det && t.closest('summary') && t.closest('summary').parentElement === det) { setTimeout(() => { if (det.open) offen[det.dataset.p] = 1; else delete offen[det.dataset.p]; }, 0); }
    const b = t.closest('[data-dl],[data-anhweg],[data-st],[data-pweg],[data-ex]'); if (!b) return false;
    try {
      if (b.dataset.dl) { await herunterladen('admin/anhang/' + b.dataset.dl, b.dataset.name, hdr()); return true; }
      if (b.dataset.anhweg) { if (!confirm('Anhang löschen?')) return true; await API('admin/anhang/' + b.dataset.anhweg, { method: 'DELETE' }); }
      if (b.dataset.st) await API('admin/pendenzen/' + b.dataset.id, { method: 'POST', body: JSON.stringify({ status: b.dataset.st }) });
      if (b.dataset.pweg) { if (!confirm('Pendenz mit Verlauf und Anhängen löschen?')) return true; await API('admin/pendenzen/' + b.dataset.pweg, { method: 'DELETE' }); }
      if (b.dataset.ex) {
        const name = (D.experten.find((x) => x.id === b.dataset.ex) || {}).name;
        if (b.dataset.a === 'link') { if (!confirm('Neuen Link erzeugen? Der bisherige Link von ' + name + ' wird ungültig.')) return true; const r = await API('admin/experten/' + b.dataset.ex, { method: 'POST', body: JSON.stringify({ aktion: 'link' }) }); await laden(el, API); linkZeigen(name, r.token); return true; }
        if (b.dataset.a === 'sperren') { if (!confirm('Link von ' + name + ' sperren?')) return true; await API('admin/experten/' + b.dataset.ex, { method: 'POST', body: JSON.stringify({ aktion: 'sperren' }) }); }
        if (b.dataset.a === 'loeschen') { if (!confirm(name + ' entfernen? Zuteilungen gehen verloren, der Verlauf bleibt.')) return true; await API('admin/experten/' + b.dataset.ex, { method: 'DELETE' }); }
      }
      await laden(el, API);
    } catch (er) { alert('Fehler: ' + er.message); }
    return true;
  }
  async function aenderung(e, el, hdr) {
    const t = e.target;
    try {
      if (t.dataset.zu) { const ids = [...el.querySelectorAll('[data-zu="' + t.dataset.zu + '"]:checked')].map((x) => x.value); await API('admin/pendenzen/' + t.dataset.zu, { method: 'POST', body: JSON.stringify({ experten: ids }) }); await laden(el, API); return true; }
      if (t.dataset.up && t.files && t.files[0]) {
        const f = t.files[0]; if (f.size > 20 * 1024 * 1024) { alert('Höchstens 20 MB.'); return true; }
        const r = await fetch('api/admin/pendenzen/' + t.dataset.up + '/anhang', { method: 'POST', body: f, credentials: 'omit', headers: Object.assign(hdr(), { 'Content-Type': f.type || 'application/octet-stream', 'X-Dateiname': encodeURIComponent(f.name) }) });
        if (!r.ok) throw new Error('HTTP ' + r.status); await laden(el, API); return true;
      }
    } catch (er) { alert('Fehler: ' + er.message); return true; }
    return false;
  }
  async function senden(e, el) {
    const f = e.target; if (!f.dataset.pf) return false; e.preventDefault(); const fd = new FormData(f);
    try {
      if (f.dataset.pf === 'neu') await API('admin/pendenzen', { method: 'POST', body: JSON.stringify({ titel: fd.get('titel'), text: fd.get('text'), stellen: stellenAus(fd.get('stellen')), prioritaet: Number(fd.get('prioritaet')) }) });
      if (f.dataset.pf === 'edit') await API('admin/pendenzen/' + f.dataset.id, { method: 'POST', body: JSON.stringify({ titel: fd.get('titel'), text: fd.get('text'), stellen: stellenAus(fd.get('stellen')), prioritaet: Number(fd.get('prioritaet')) }) });
      if (f.dataset.pf === 'notiz') { if (!String(fd.get('text')).trim()) return true; await API('admin/pendenzen/' + f.dataset.id + '/eintrag', { method: 'POST', body: JSON.stringify({ text: fd.get('text') }) }); }
      if (f.dataset.pf === 'experte') { const r = await API('admin/experten', { method: 'POST', body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), notiz: fd.get('notiz') }) }); await laden(el, API); linkZeigen(String(fd.get('name')), r.token); return true; }
      await laden(el, API);
    } catch (er) { alert('Fehler: ' + er.message); }
    return true;
  }
  global.AdminPendenzen = { laden, klick, aenderung, senden };
})(window);
