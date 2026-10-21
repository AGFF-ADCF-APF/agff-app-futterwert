/* Futter v2 – Administration: Freischaltung Kursleitung, Einladungscodes, Probenpool, Speicher. */
(function (global) {
  'use strict';
  let pw = '';
  try { pw = sessionStorage.getItem('agffV2Admin') || ''; } catch (e) { /* egal */ }
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const datum = (d) => (d ? new Date(typeof d === 'number' ? d * 1000 : d).toLocaleDateString('de-CH') : '');
  async function api(path, o) {
    const r = await fetch('api/' + path, Object.assign({ cache: 'no-store', credentials: 'omit' }, o || {}, { headers: Object.assign({ 'Content-Type': 'application/json', 'X-Admin-Pass': pw }, (o || {}).headers || {}) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  async function laden() {
    const [u, pool, quota] = await Promise.all([api('admin/uebersicht'), api('admin/pool'), api('admin/quota').catch(() => ({ antraege: [], konten: 0 }))]);
    const s = u.statistik;
    const antraege = u.kursleitende.filter((k) => k.status === 'antrag');
    const frei = u.kursleitende.filter((k) => k.status !== 'antrag');
    $('#inhalt').innerHTML =
      '<div class="kpis"><div class="kpi"><div class="l">Kurse</div><div class="v">' + s.kurse + '</div></div><div class="kpi"><div class="l">Teilnehmende</div><div class="v">' + s.teilnehmende + '</div></div>' +
      '<div class="kpi"><div class="l">Freigaben</div><div class="v">' + s.freigaben + '</div></div><div class="kpi"><div class="l">Fotos</div><div class="v">' + Math.round(s.fotoBytes / 1048576) + '<small> / ' + Math.round(s.fotoLimit / 1048576) + ' MB</small></div></div></div>' +
      '<div id="pendenzen"></div>' +
      '<h2>Anträge Kursleitung (' + antraege.length + ')</h2>' + (antraege.length ? antraege.map((k) => '<div class="card stack" style="margin-bottom:8px"><div><b>' + esc(k.name) + '</b> · ' + esc(k.org || '–') + '<br><span class="small">' + esc(k.email) + ' · ' + datum(k.createdAt) + '</span></div>' +
        (k.text ? '<p class="small" style="margin:0">' + esc(k.text) + '</p>' : '') + '<div class="row"><button class="btn primary sm" data-e="' + k.id + '" data-s="frei">Freischalten</button><button class="btn sm danger" data-e="' + k.id + '" data-s="abgelehnt">Ablehnen</button></div></div>').join('') : '<p class="muted small">Keine offenen Anträge.</p>') +
      '<h2>Freigeschaltet</h2><p class="small muted">Zusätzlich per Domain/Adresse in .env: ' + esc((u.domains || []).join(', ') || '–') + (u.adressen ? ' · ' + u.adressen + ' Adresse(n)' : '') + '</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>E-Mail</th><th>Status</th><th>via</th><th></th></tr></thead><tbody>' + frei.map((k) => '<tr><td>' + esc(k.name || '–') + '</td><td>' + esc(k.email) + '</td><td>' + esc(k.status) + '</td><td>' + esc(k.via) + '</td><td><button class="btn sm danger" data-e="' + k.id + '" data-s="loeschen">Entfernen</button></td></tr>').join('') + '</tbody></table></div>' +
      '<h2>Einladungscodes</h2><form id="inv" class="row"><input class="input" name="notiz" placeholder="Notiz (z. B. Lehrpersonen BZ Rütti)" style="flex:2"><input class="input" name="max" type="number" min="1" max="500" value="10" style="max-width:90px" title="Anzahl Verwendungen"><input class="input" name="tage" type="number" min="1" max="365" value="30" style="max-width:90px" title="Gültig (Tage)"><button class="btn primary">Code erzeugen</button></form><p id="neuerCode" class="alert info" hidden></p>' +
      '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Code …</th><th>Notiz</th><th>Verwendet</th><th>gültig bis</th><th></th></tr></thead><tbody>' + u.einladungen.map((i) => '<tr><td>…' + esc(i.hinweis) + '</td><td>' + esc(i.notiz) + '</td><td>' + i.uses + ' / ' + i.max + '</td><td>' + (i.revoked ? 'gesperrt' : datum(i.expiresAt)) + '</td><td>' + (i.revoked ? '' : '<button class="btn sm danger" data-inv="' + i.id + '">Sperren</button>') + '</td></tr>').join('') + '</tbody></table></div>' +
      '<h2>Foto-Speicher: Anträge (' + quota.antraege.filter((a) => a.status === 'offen').length + ' offen) · ' + quota.konten + ' Konten</h2>' +
      (quota.antraege.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>E-Mail</th><th>Bereich</th><th>Wunsch</th><th>Begründung</th><th>Status</th><th></th></tr></thead><tbody>' + quota.antraege.map((a) => '<tr><td>' + esc(a.email) + '</td><td>' + esc(a.bereich) + '</td><td>' + a.wunschMb + ' MB' + (a.zusatzMb ? '<br><small>bisher +' + a.zusatzMb + ' MB</small>' : '') + '</td><td class="small">' + esc(a.text || '–') + '</td><td>' + esc(a.status) + '<br><small>' + datum(a.createdAt) + '</small></td><td>' +
        (a.status === 'offen' ? '<input class="input" type="number" min="1" max="20000" value="' + a.wunschMb + '" data-qmb="' + esc(a.id) + '" style="width:90px"> <button class="btn sm primary" data-q="' + esc(a.id) + '" data-s="ok">Freigeben</button> <button class="btn sm danger" data-q="' + esc(a.id) + '" data-s="abgelehnt">Ablehnen</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="small muted">Keine Anträge.</p>') +
      '<h2>Anonyme Beiträge</h2><p class="small muted">Für Auswertungen und Publikationen (ohne Namen, Betriebe, Parzellen).</p><button class="btn" id="csvExport">CSV herunterladen</button>' +
      '<h2>Probenpool (' + pool.eintraege.length + ')</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Titel</th><th>Futter</th><th>Quelle</th><th>Datum</th><th></th></tr></thead><tbody>' + pool.eintraege.map((p) => '<tr><td>' + esc(p.daten.titel) + '</td><td>' + esc(p.daten.typ) + '</td><td>' + esc(p.daten.quelle) + '</td><td>' + datum(p.createdAt) + '</td><td><button class="btn sm danger" data-pool="' + p.id + '">Löschen</button></td></tr>').join('') + '</tbody></table></div>';
    $('#inhalt').hidden = false; $('#login').hidden = true;
    if (global.AdminPendenzen) await global.AdminPendenzen.laden($('#pendenzen'), api).catch((e) => { $('#pendenzen').innerHTML = '<p class="alert">Pendenzen: ' + esc(e.message) + '</p>'; });
  }
  const hdr = () => ({ 'X-Admin-Pass': pw });
  document.addEventListener('click', async (e) => {
    if (global.AdminPendenzen && e.target.closest('#pendenzen') && await global.AdminPendenzen.klick(e, $('#pendenzen'), hdr)) return;
    if (e.target.id === 'csvExport') {
      const r = await fetch('api/admin/statistik.csv', { headers: { 'X-Admin-Pass': pw }, cache: 'no-store' });
      if (!r.ok) { alert('Fehler ' + r.status); return; }
      const url = URL.createObjectURL(await r.blob()); const l = document.createElement('a'); l.href = url; l.download = 'futter_beitraege_' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(l); l.click(); l.remove();
      return;
    }
    const b = e.target.closest('[data-e],[data-inv],[data-pool],[data-q]'); if (!b) return;
    try {
      if (b.dataset.e) { if (b.dataset.s !== 'frei' && !confirm('Wirklich?')) return; await api('admin/kursleitung/' + b.dataset.e, { method: 'POST', body: JSON.stringify({ status: b.dataset.s }) }); }
      if (b.dataset.inv) { if (!confirm('Code sperren?')) return; await api('admin/einladungen/' + b.dataset.inv, { method: 'DELETE' }); }
      if (b.dataset.q) { const mbI = document.querySelector('[data-qmb="' + b.dataset.q + '"]'); if (b.dataset.s !== 'ok' && !confirm('Antrag ablehnen?')) return; await api('admin/quota/' + b.dataset.q, { method: 'POST', body: JSON.stringify({ status: b.dataset.s, mb: mbI ? Number(mbI.value) : undefined }) }); }
      if (b.dataset.pool) { if (!confirm('Pool-Eintrag endgültig löschen?')) return; await api('admin/pool/' + b.dataset.pool, { method: 'DELETE' }); }
      await laden();
    } catch (er) { alert('Fehler: ' + er.message); }
  });
  document.addEventListener('change', (e) => { if (global.AdminPendenzen && e.target.closest('#pendenzen')) global.AdminPendenzen.aenderung(e, $('#pendenzen'), hdr); });
  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (global.AdminPendenzen && e.target.closest('#pendenzen') && await global.AdminPendenzen.senden(e, $('#pendenzen'))) return;
    const fd = new FormData(e.target);
    if (e.target.id === 'login') {
      pw = String(fd.get('pw'));
      try { await laden(); try { sessionStorage.setItem('agffV2Admin', pw); } catch (er) { /* egal */ } } catch (er) { $('#loginMsg').textContent = er.status === 429 ? 'Zu viele Versuche – später erneut.' : 'Passwort falsch.'; }
    }
    if (e.target.id === 'inv') {
      try {
        const r = await api('admin/einladungen', { method: 'POST', body: JSON.stringify({ notiz: fd.get('notiz'), max: Number(fd.get('max')), tage: Number(fd.get('tage')) }) });
        await laden();
        const p = $('#neuerCode'); p.hidden = false; p.innerHTML = '<div>Neuer Code (nur jetzt sichtbar): <b style="font-size:1.3rem;letter-spacing:.08em">' + esc(r.code) + '</b> · ' + r.max + '× verwendbar, ' + r.tage + ' Tage gültig</div>';
      } catch (er) { alert('Fehler: ' + er.message); }
    }
  });
  if (pw) laden().catch(() => { pw = ''; });
})(window);
