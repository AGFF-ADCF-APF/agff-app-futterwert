/* Futter v2 – Konto (Anmeldung per E-Mail) und Cloud-Speicherung je App (Futter, Wiese).
 *
 * Anmeldung: 6-stelliger Code (15 Min.) oder Knopf in der E-Mail («#login=…», 24 Monate gültig, widerrufbar).
 * Cloud: je App einzeln einschaltbar. Abgleich je Datensatz (zuletzt geändert gewinnt), Löschungen werden übertragen.
 * Was vom Server kommt, läuft durch dieselben Prüfungen wie Importe (Model.clean…, Aufnahme.clean).
 * Code-Eingabe: alle Felder «name=code, inputmode=numeric» in Dialogen werden zu 6 Kästchen mit «Einfügen».
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const IO = () => global.FutterIO;
  const F = () => global.Fotos;
  const esc = (s) => app().esc(s);
  const KEY = 'agffV2Konto';           // { token, email }
  const KEY_STAND = 'agffV2KontoStand'; // { futter: {seit, recs: {id: h}, fotos: [ids]}, wiese: {...} }
  const lesen = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  const schreiben = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* voll */ } };
  let sitzung = lesen(KEY, null);
  let info = null; let infoZeit = 0;
  const status = { futter: { laeuft: false, zuletzt: null, fehler: null }, wiese: { laeuft: false, zuletzt: null, fehler: null } };
  const ICON_KOPIE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_EINF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/></svg>';

  const angemeldet = () => !!(sitzung && sitzung.token);
  const kopf = () => (angemeldet() ? { 'X-Konto': sitzung.token } : {});
  async function api(pfad, o) {
    o = o || {};
    try { return await IO().api(pfad, Object.assign({}, o, { headers: Object.assign({}, o.headers || {}, kopf()) })); } catch (e) {
      if (e.status === 404 && /^konto(\/|$)/.test(pfad) && angemeldet() && e.message === 'NOT_FOUND') { abmeldenLokal(); app().toast('Sie wurden abgemeldet (Sitzung abgelaufen oder widerrufen).'); }
      throw e;
    }
  }
  function abmeldenLokal() { sitzung = null; info = null; try { localStorage.removeItem(KEY); localStorage.removeItem(KEY_STAND); } catch (e) { /* egal */ } }

  // =====================================================================
  // Code-Eingabe: 6 Kästchen, Einfügen aus der Zwischenablage
  // =====================================================================
  function codeKaestchen(orig) {
    if (orig.dataset.code6) return; orig.dataset.code6 = '1';
    const box = document.createElement('div'); box.className = 'code6';
    box.innerHTML = '<div class="code6-felder" role="group" aria-label="6-stelliger Code">' + Array.from({ length: 6 }, (_, i) => '<input class="code6-feld" inputmode="numeric" pattern="[0-9]*" aria-label="Ziffer ' + (i + 1) + '"' + (i === 0 ? ' autocomplete="one-time-code"' : ' autocomplete="off"') + '>').join('') + '</div>' +
      '<button type="button" class="btn sm ghost code6-einf">' + ICON_EINF + ' Einfügen</button>';
    orig.type = 'hidden'; orig.after(box);
    const felder = Array.from(box.querySelectorAll('.code6-feld'));
    const sync = () => { orig.value = felder.map((f) => f.value).join(''); if (orig.value.length === 6) { const form = orig.form; const b = form && form.querySelector('.primary:not([disabled])'); if (form && b) setTimeout(() => form.requestSubmit(b), 120); } };
    const verteilen = (txt, ab) => { const z = String(txt || '').replace(/\D/g, '').slice(0, 6 - (ab || 0)); if (!z) return false; z.split('').forEach((c, i) => { felder[(ab || 0) + i].value = c; }); felder[Math.min(5, (ab || 0) + z.length)].focus(); sync(); return true; };
    felder.forEach((f, i) => {
      f.addEventListener('input', () => { const v = f.value.replace(/\D/g, ''); if (v.length > 1) { verteilen(v, i); return; } f.value = v; if (v && i < 5) felder[i + 1].focus(); sync(); });
      f.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !f.value && i > 0) { felder[i - 1].focus(); felder[i - 1].value = ''; sync(); e.preventDefault(); } if (e.key === 'ArrowLeft' && i > 0) felder[i - 1].focus(); if (e.key === 'ArrowRight' && i < 5) felder[i + 1].focus(); });
      f.addEventListener('paste', (e) => { const t = (e.clipboardData || global.clipboardData).getData('text'); if (verteilen(t, 0)) e.preventDefault(); });
      f.addEventListener('focus', () => f.select());
    });
    box.querySelector('.code6-einf').addEventListener('click', async () => {
      try { const t = await navigator.clipboard.readText(); if (!verteilen(t, 0)) app().toast('In der Zwischenablage ist kein Code.'); } catch (e) { app().toast('Einfügen nicht erlaubt – bitte ins erste Kästchen tippen und lang drücken › Einfügen.'); felder[0].focus(); }
    });
    setTimeout(() => felder[0].focus(), 60);
  }
  const beobachter = new MutationObserver(() => { document.querySelectorAll('#sheet-root input[name="code"][inputmode="numeric"]:not([data-code6])').forEach(codeKaestchen); });
  function beobachten() { const r = document.getElementById('sheet-root'); if (r) beobachter.observe(r, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', beobachten); else beobachten();

  // =====================================================================
  // Anmelden
  // =====================================================================
  function anmelden(danach) {
    const A = app();
    A.sheet('<h2>Anmelden</h2><p class="small" style="margin-top:0">Mit Ihrer E-Mail-Adresse – ohne Passwort. Sie erhalten einen Code und einen Anmelde-Knopf.</p>' +
      '<form id="koMail" class="stack"><label class="field"><span>E-Mail-Adresse</span><input class="input" type="email" name="email" required autocomplete="email" value="' + esc(A.db.prefs.email || '') + '"></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Code senden</button></div></form>', (el) => {
      el.querySelector('#koMail').addEventListener('submit', async (e) => {
        e.preventDefault(); const email = String(new FormData(e.target).get('email')).trim().toLowerCase(); const b = e.target.querySelector('.primary'); b.disabled = true;
        try { await api('konto/code', { method: 'POST', body: { email, appUrl: IO().appUrl() } }); } catch (er) { b.disabled = false; A.toast(er.message === 'RATE_LIMITED' ? 'Zu viele Anfragen – bitte später erneut versuchen.' : 'Fehler: ' + er.message); return; }
        codeSheet(email, danach);
      });
    });
  }
  function codeSheet(email, danach) {
    const A = app();
    A.sheet('<h2>Code eingeben</h2><p class="small" style="margin-top:0">An <b>' + esc(email) + '</b> gesendet – 15 Minuten gültig. Oder in der E-Mail auf <b>«In der App anmelden»</b> tippen.</p>' +
      '<form id="koCode" class="stack"><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>' +
      '<p class="small" id="koMsg" style="color:var(--schlecht);margin:0" aria-live="polite"></p>' +
      '<div class="row"><button type="button" class="btn ghost grow" id="koNeu">Neuen Code senden</button><button class="btn primary grow">Anmelden</button></div></form>' +
      '<p class="hint">Kein E-Mail erhalten? Spam-Ordner prüfen. Ein neuer Code macht frühere Anmelde-Knöpfe nicht ungültig.</p>', (el) => {
      el.querySelector('#koNeu').onclick = () => api('konto/code', { method: 'POST', body: { email, appUrl: IO().appUrl() } }).then(() => { el.querySelector('#koMsg').textContent = 'Neuer Code gesendet.'; }).catch(() => {});
      el.querySelector('#koCode').addEventListener('submit', async (e) => {
        e.preventDefault(); const b = e.target.querySelector('.primary'); if (b.disabled) return; b.disabled = true;
        try { const r = await api('konto/login', { method: 'POST', body: { email, code: String(new FormData(e.target).get('code')) } }); angemeldetMit(r); A.closeSheet(); if (danach) danach(); }
        catch (er) { b.disabled = false; el.querySelector('#koMsg').textContent = er.message === 'RATE_LIMITED' ? 'Zu viele Versuche – bitte später.' : 'Code falsch oder abgelaufen.'; el.querySelectorAll('.code6-feld').forEach((f) => { f.value = ''; }); const f0 = el.querySelector('.code6-feld'); if (f0) f0.focus(); }
      });
    });
  }
  function angemeldetMit(r) {
    sitzung = { token: r.session, email: r.email }; schreiben(KEY, sitzung);
    const A = app(); if (!A.db.prefs.email) { A.db.prefs.email = r.email; A.save(); }
    info = null; A.toast('Angemeldet als ' + r.email + '.'); A.render(); allesAbgleichen();
  }
  /** Anmelde-Link aus der E-Mail («#login=<id>.<geheimnis>») */
  async function linkLogin(token) {
    if (!/^[A-Za-z0-9_-]{6,20}\.[A-Za-z0-9_-]{43}$/.test(token || '')) { app().toast('Ungültiger Anmelde-Link.'); return; }
    try { const r = await api('konto/login', { method: 'POST', body: { link: token } }); angemeldetMit(r); app().go('#/daten'); }
    catch (e) { app().toast(e.message === 'RATE_LIMITED' ? 'Zu viele Versuche – bitte später.' : 'Anmelde-Link ungültig, abgelaufen oder widerrufen. Bitte neu anmelden.'); }
  }

  // =====================================================================
  // Daten-Seite
  // =====================================================================
  async function infoLaden(neu) {
    if (!angemeldet()) return null;
    if (info && !neu && Date.now() - infoZeit < 30000) return info;
    try { info = await api('konto'); infoZeit = Date.now(); } catch (e) { if (!angemeldet()) info = null; }
    return info;
  }
  const mb = (b) => (b / 1048576).toLocaleString('de-CH', { maximumFractionDigits: b < 10485760 ? 1 : 0 });
  const zeit = (iso) => (iso ? new Date(typeof iso === 'number' ? iso * 1000 : iso).toLocaleDateString('de-CH') : '');
  function datenHtml() {
    if (!angemeldet()) {
      return '<div class="card stack ko-karte"><p style="margin:0"><b>Konto und Cloud-Speicherung</b> – optional. Mit einem Konto (nur E-Mail, ohne Passwort) können Sie Ihre Daten in der Cloud sichern und auf mehreren Geräten verwenden; Futter und Wiese getrennt einschaltbar.</p>' +
        '<button class="btn primary" data-ko="anmelden">Anmelden / Konto erstellen</button></div>';
    }
    const i = info;
    if (!i) { infoLaden().then(() => { if (app().route().name === 'daten') app().render(); }); return '<div class="card"><p class="muted" style="margin:0">Konto wird geladen …</p></div>'; }
    const sw = (a, t, ico) => { const s = status[a]; const n = i.anzahl[a] || 0;
      return '<div class="ko-app"><label class="toggle"><input type="checkbox" data-ko="cloud" data-app="' + a + '"' + (i.cloud[a] ? ' checked' : '') + '> <span><b>' + ico + ' ' + t + ' in der Cloud</b></span></label>' +
        '<span class="small muted">' + (i.cloud[a] ? (s.laeuft ? 'wird abgeglichen …' : s.fehler ? '⚠ ' + esc(s.fehler) : (s.zuletzt ? 'abgeglichen ' + new Date(s.zuletzt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : 'eingeschaltet')) + ' · ' + n + ' Einträge' : 'aus – nur auf diesem Gerät') + '</span>' +
        (i.cloud[a] ? '<button class="btn sm ghost" data-ko="sync" data-app="' + a + '">Jetzt abgleichen</button>' : '') + '</div>'; };
    const f = i.fotos; const pz = Math.min(100, Math.round(f.bytes / Math.max(1, f.limit) * 100));
    return '<div class="card stack ko-karte"><div class="row" style="align-items:center"><span class="grow">Angemeldet als <b>' + esc(i.email) + '</b></span><button class="btn sm ghost" data-ko="abmelden">Abmelden</button></div>' +
      sw('futter', 'Futter', '🌾') + sw('wiese', 'Wiese', '🌱') +
      '<div><div class="small">Foto-Speicher: ' + mb(f.bytes) + ' von ' + mb(f.limit) + ' MB</div><div class="ko-balken"><i style="width:' + pz + '%"' + (pz >= 90 ? ' class="voll"' : '') + '></i></div>' +
      (f.antrag ? '<div class="small muted">Antrag auf ' + f.antrag.wunsch_mb + ' MB vom ' + zeit(f.antrag.created_at) + ' ist in Prüfung.</div>' : '<button class="btn sm ghost" data-ko="quota" data-bereich="konto">Mehr Speicher beantragen</button>') + '</div>' +
      '<details><summary class="small">Geräte und Anmelde-Links (' + i.geraete.length + ' / ' + i.links.length + ')</summary>' +
      '<ul class="ko-liste">' + i.geraete.map((g) => '<li><span><b>' + esc(g.geraet || 'Gerät') + '</b>' + (g.ich ? ' <span class="chip gut">dieses Gerät</span>' : '') + '<br><span class="small muted">angemeldet ' + zeit(g.createdAt) + ' per ' + (g.via === 'link' ? 'Link' : 'Code') + ' · zuletzt ' + zeit(g.lastUsed) + '</span></span>' + (g.ich ? '' : '<button class="btn sm ghost" data-ko="geraet-weg" data-id="' + esc(g.id) + '">Abmelden</button>') + '</li>').join('') + '</ul>' +
      '<p class="small" style="margin:8px 0 4px">Anmelde-Links in Ihren E-Mails: ' + i.links.length + ' gültig (je 24 Monate).</p>' +
      (i.links.length ? '<button class="btn sm danger" data-ko="links-weg">Alle Anmelde-Links widerrufen</button>' : '') + '</details>' +
      '<p class="hint" style="margin:0">Cloud-Daten liegen auf dem Server der AGFF-App (ohne Ende-zu-Ende-Verschlüsselung), nur mit Ihrer Anmeldung abrufbar. Automatische Löschung ' + Math.round((i.retentionDays || 730) / 30.4) + ' Monate nach der letzten Nutzung. <button class="linkbtn" data-ko="konto-weg">Konto und alle Cloud-Daten löschen</button></p></div>';
  }
  function cloudZustimmung(a, cb) {
    const A = app(); const t = a === 'futter' ? 'Futter (Anlässe, Proben, Fotos, Einstellungen)' : 'Wiese (Fotopunkte mit Fotos, Wiesenaufnahmen, eigene Referenzbilder)';
    A.sheet('<h2>' + (a === 'futter' ? 'Futter' : 'Wiese') + ' in der Cloud speichern?</h2><div class="consent"><ul>' +
      '<li>Alle Daten von <b>' + t + '</b> werden auf dem Server gespeichert und mit Ihren anderen angemeldeten Geräten abgeglichen.</li>' +
      '<li>Übertragung verschlüsselt (HTTPS); auf dem Server ohne Ende-zu-Ende-Verschlüsselung – Zugriff nur mit Ihrer Anmeldung sowie durch den Betreiber für Betrieb und Support.</li>' +
      '<li>Ausschalten jederzeit, wahlweise mit Löschen der Cloud-Daten. Automatische Löschung nach 24 Monaten ohne Nutzung.</li>' +
      '<li>Fotos zählen zum Foto-Speicher Ihres Kontos (mehr auf Antrag).</li></ul>' +
      '<label class="toggle" style="margin:10px 0"><input type="checkbox" id="koOk"> <span>Einverstanden. Personenangaben Dritter erfasse ich nur mit deren Einverständnis.</span></label>' +
      '<div class="row"><button class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow" id="koJa" disabled>Einschalten</button></div></div>', (el) => {
      el.querySelector('#koOk').onchange = (e) => { el.querySelector('#koJa').disabled = !e.target.checked; };
      el.querySelector('#koJa').onclick = async () => {
        try { await api('konto/cloud', { method: 'PUT', body: { app: a, an: true, consent: { accepted: true, version: (info && info.consentVersion) || '' } } }); A.closeSheet(); await infoLaden(true); cb(); }
        catch (e) { A.toast('Einschalten fehlgeschlagen: ' + e.message); }
      };
    });
  }

  // =====================================================================
  // Abgleich
  // =====================================================================
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + s.length; }
  const LS = { fp: 'agffV2Fotopunkte', ref: 'agffV2Referenzen', au: 'agffV2Aufnahmen' };
  const lsLesen = (k) => { try { const z = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(z) ? z : []; } catch (e) { return []; } };
  /** Lokale Datensätze einer App als {id: {data, updatedAt}} */
  function lokal(a) {
    const A = app(); const out = {};
    if (a === 'futter') {
      const db = A.db;
      db.anlaesse.forEach((x) => { const c = Object.assign({}, x); out['a:' + x.id] = { data: c, u: x.updatedAt || x.createdAt }; });
      db.proben.forEach((p) => { const c = Object.assign({}, p); delete c.dirty; out['p:' + p.id] = { data: c, u: p.updatedAt }; });
      const pr = Object.assign({}, db.prefs); delete pr._persistAsked; out.prefs = { data: pr, u: '' };
    } else {
      lsLesen(LS.fp).forEach((x) => { if (x && x.id) out['fp:' + x.id] = { data: x, u: x.updatedAt || x.createdAt }; });
      lsLesen(LS.ref).forEach((x) => { if (x && x.id) out['ref:' + x.id] = { data: x, u: x.createdAt }; });
      lsLesen(LS.au).forEach((x) => { if (x && x.id) out['au:' + x.id] = { data: x, u: x.updatedAt }; });
    }
    return out;
  }
  /** Eingehende Änderungen anwenden (geprüft). aenderungen: [{id, data|null}] */
  function anwenden(a, aenderungen) {
    if (!aenderungen.length) return;
    const A = app(); const M = global.Model;
    if (a === 'futter') {
      const db = A.db;
      for (const { id, data } of aenderungen) {
        const [art, rid] = id === 'prefs' ? ['prefs', ''] : [id.split(':')[0], id.slice(id.indexOf(':') + 1)];
        if (art === 'prefs') {
          if (!data) continue;
          const neu = M.cleanPrefs(data);
          // gleiche Geräte-Kennung auf allen Geräten: «Eigene Proben» stimmen überall
          if (neu.ich && db.prefs.ich && neu.ich !== db.prefs.ich) { const alt = db.prefs.ich; db.proben.forEach((p) => { if (p.autor === alt) p.autor = neu.ich; }); }
          Object.assign(db.prefs, neu, { email: db.prefs.email || neu.email });
        } else if (art === 'a') {
          const i = db.anlaesse.findIndex((x) => x.id === rid);
          if (!data) { if (i >= 0 && !db.proben.some((p) => p.anlassId === rid)) db.anlaesse.splice(i, 1); continue; }
          const c = M.cleanAnlass(data, { mitSpace: true }); if (!c || c.id !== rid) continue;
          if (i >= 0) db.anlaesse[i] = c; else db.anlaesse.push(c);
        } else if (art === 'p') {
          const i = db.proben.findIndex((x) => x.id === rid);
          if (!data) { if (i >= 0) db.proben.splice(i, 1); continue; }
          const c = M.cleanProbe(data); if (!c || c.id !== rid) continue;
          if (i >= 0) db.proben[i] = c; else db.proben.push(c);
        }
      }
      A.save();
    } else {
      const listen = { fp: lsLesen(LS.fp), ref: lsLesen(LS.ref), au: lsLesen(LS.au) };
      for (const { id, data } of aenderungen) {
        const art = id.split(':')[0]; const rid = id.slice(art.length + 1); const L = listen[art]; if (!L) continue;
        const i = L.findIndex((x) => x && x.id === rid);
        if (!data) { if (i >= 0) L.splice(i, 1); continue; }
        let c = data;
        if (art === 'au') c = global.Aufnahme._t.clean(data);
        else if (!c || typeof c !== 'object' || c.id !== rid || !/^[A-Za-z0-9_-]{6,64}$/.test(c.id) || (art === 'fp' && !Array.isArray(c.fotos))) c = null;
        if (!c) continue;
        if (i >= 0) L[i] = c; else L.push(c);
      }
      schreiben(LS.fp, listen.fp); schreiben(LS.ref, listen.ref); schreiben(LS.au, listen.au);
      if (global.Wiese && global.Wiese.neuLaden) global.Wiese.neuLaden();
    }
  }
  /** Fotos, die zu einer App gehören: [{id, owner}] (owner = Probe bzw. «fp:<id>»/«ref») */
  function fotoListe(a) {
    const A = app();
    if (a === 'futter') return A.db.proben.flatMap((p) => (p.fotos || []).map((f) => ({ id: f.id, owner: p.id, meta: f })));
    return lsLesen(LS.fp).flatMap((p) => (p.fotos || []).map((f) => ({ id: f.id, owner: 'fp:' + p.id, meta: f }))).concat(lsLesen(LS.ref).map((r) => ({ id: r.id, owner: 'ref', meta: r })));
  }
  let quotaGezeigt = false;
  async function fotosAbgleichen(a, st) {
    const liste = fotoListe(a).filter((x) => /^[A-Za-z0-9_-]{16}$/.test(x.id || ''));
    const oben = new Set(st.fotos || []);
    let hoch = 0; let runter = 0;
    for (const f of liste) {
      if (oben.has(f.id)) continue;
      const b = await F().blob(f.id).catch(() => null);
      if (!b) continue;
      const r = await fetch('api/konto/fotos/' + f.id + '?app=' + a, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, kopf()), body: b, credentials: 'omit', cache: 'no-store' });
      if (r.status === 409) { const j = await r.json().catch(() => ({})); if (j.error === 'QUOTA') { if (!quotaGezeigt) { quotaGezeigt = true; quotaHinweis({ bereich: 'konto', bytes: j.bytes, limit: j.limit }); } break; } }
      if (!r.ok) break;
      oben.add(f.id); hoch++;
    }
    // fehlende Fotos von anderen Geräten holen (je Abgleich höchstens 40)
    let serverIds = null;
    for (const f of liste) {
      if (runter >= 40) break;
      if (await F().blob(f.id).catch(() => null)) continue;
      if (!serverIds) { try { serverIds = new Set((await api('konto/fotos')).fotos.map((x) => x.id)); } catch (e) { serverIds = new Set(); } }
      if (!serverIds.has(f.id)) continue;
      const r = await fetch('api/konto/fotos/' + f.id, { headers: kopf(), credentials: 'omit', cache: 'no-store' });
      if (!r.ok) continue;
      await F().ablegen(f.id, f.owner, await F().vomServer(f.meta || {}, await r.arrayBuffer())).catch(() => {}); oben.add(f.id); runter++;
    }
    st.fotos = [...oben];
    return { hoch, runter };
  }
  const laeuft = {};
  async function abgleichen(a) {
    if (!angemeldet() || laeuft[a] || !navigator.onLine) return;
    const i = await infoLaden(); if (!i || !i.cloud[a]) return;
    laeuft[a] = true; status[a].laeuft = true; status[a].fehler = null;
    const alleStand = lesen(KEY_STAND, {}); const st = alleStand[a] || { seit: '', recs: {}, fotos: [] };
    try {
      // 1. Änderungen vom Server
      const r = await api('konto/daten/' + a + (st.seit ? '?seit=' + encodeURIComponent(st.seit) : ''));
      let lo = lokal(a); const rein = [];
      for (const rec of r.records) {
        const l = lo[rec.id]; const alt = st.recs[rec.id];
        const hr = rec.data ? hash(JSON.stringify(rec.data)) : null;
        const lokalGeaendert = l && (!alt || hash(JSON.stringify(l.data)) !== alt);
        if (!rec.data) { if (l && !lokalGeaendert) rein.push({ id: rec.id, data: null }); delete st.recs[rec.id]; continue; }
        if (!l && alt) continue; // hier gelöscht, dem Server noch nicht gemeldet → Löschung gewinnt (wird unten gesendet)
        if (!l || !lokalGeaendert || (rec.clientUpdatedAt || '') > (l.u || '')) { rein.push({ id: rec.id, data: rec.data }); st.recs[rec.id] = hr; }
      }
      anwenden(a, rein);
      if (r.stand) st.seit = r.stand;
      // 2. Eigene Änderungen hochladen
      lo = lokal(a); const raus = [];
      Object.keys(lo).forEach((id) => { const h = hash(JSON.stringify(lo[id].data)); if (st.recs[id] !== h) raus.push({ id, data: lo[id].data, updatedAt: lo[id].u || new Date().toISOString(), h }); });
      Object.keys(st.recs).forEach((id) => { if (!lo[id]) raus.push({ id, data: null, updatedAt: new Date().toISOString() }); });
      for (let j = 0; j < raus.length; j += 150) {
        const teil = raus.slice(j, j + 150);
        const res = await api('konto/daten/' + a, { method: 'PUT', body: { records: teil.map(({ id, data, updatedAt }) => ({ id, data, updatedAt })) } });
        const ok = new Set(res.ok);
        teil.forEach((x) => { if (!ok.has(x.id)) return; if (x.data) st.recs[x.id] = x.h; else delete st.recs[x.id]; });
      }
      // 3. Fotos
      await fotosAbgleichen(a, st);
      alleStand[a] = st; schreiben(KEY_STAND, alleStand);
      status[a].zuletzt = Date.now();
      if (rein.length) { app().render(); }
    } catch (e) {
      status[a].fehler = e.message === 'CLOUD_AUS' ? 'Cloud ist ausgeschaltet' : e.message === 'QUOTA' ? 'Speicher voll' : e.message === 'SPEICHER_VOLL' ? 'Datenspeicher voll' : 'Abgleich fehlgeschlagen (' + e.message + ')';
    } finally {
      laeuft[a] = false; status[a].laeuft = false;
      if (app().route().name === 'daten') { info = null; infoLaden().then(() => app().route().name === 'daten' && app().render()); }
    }
  }
  function allesAbgleichen() { if (!angemeldet()) return; ['futter', 'wiese'].reduce((p, a) => p.then(() => abgleichen(a)), Promise.resolve()); }
  const timer = {};
  /** Von app.js / wiese.js / aufnahme.js nach dem Speichern aufgerufen */
  function geaendert(a) { if (!angemeldet() || !info || !info.cloud[a]) return; clearTimeout(timer[a]); timer[a] = setTimeout(() => abgleichen(a), 4000); }
  setInterval(() => { if (document.visibilityState === 'visible') allesAbgleichen(); }, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') allesAbgleichen(); });
  global.addEventListener('online', allesAbgleichen);

  // =====================================================================
  // Foto-Speicher voll → Hinweis mit Antrag
  // =====================================================================
  function quotaHinweis(q) {
    const A = app(); q = q || {}; const bereich = q.bereich || 'konto';
    const wo = { konto: 'Ihres Kontos (Cloud)', gruppe: 'dieser Gruppe', kurs: 'in diesem Kurs' }[bereich];
    A.sheet('<h2>Foto-Speicher voll</h2><p style="margin-top:0">Der Foto-Speicher ' + wo + ' ist voll' + (q.limit ? ' (' + mb(q.bytes || q.limit) + ' von ' + mb(q.limit) + ' MB belegt)' : '') + '. Neue Fotos bleiben auf diesem Gerät, werden aber nicht hochgeladen.</p>' +
      '<p class="small">Sie können Fotos löschen – oder mehr Speicher beantragen. Der Betreiber prüft den Antrag; Sie erhalten eine E-Mail.</p>' +
      '<div class="row"><button class="btn ghost grow" data-close>Später</button><button class="btn primary grow" data-ko="quota" data-bereich="' + bereich + '">Mehr Speicher beantragen</button></div>');
  }
  function quotaAntrag(bereich) {
    const A = app(); const mitKonto = angemeldet();
    A.sheet('<h2>Mehr Foto-Speicher beantragen</h2><form id="koQuota" class="stack">' +
      '<label class="field"><span>Zusätzlicher Speicher</span><select class="input" name="mb"><option value="50">50 MB (ca. 250 Fotos)</option><option value="100" selected>100 MB</option><option value="250">250 MB</option><option value="500">500 MB</option><option value="1000">1 GB</option></select></label>' +
      '<label class="field"><span>Wofür? (optional)</span><textarea class="input" name="text" maxlength="1000" placeholder="z. B. Fotopunkte auf 30 Parzellen über mehrere Jahre, Kurs mit 25 Teilnehmenden"></textarea></label>' +
      (mitKonto ? '<p class="small muted" style="margin:0">Für ' + esc(sitzung.email) + '. Gilt für Ihr Konto sowie Gruppen und Kurse mit dieser Adresse.</p>'
        : '<label class="field"><span>E-Mail-Adresse</span><input class="input" type="email" name="email" required autocomplete="email" value="' + esc(A.db.prefs.email || '') + '"></label><p class="small muted" style="margin:0">Sie erhalten einen Code zur Bestätigung. Der zusätzliche Speicher gilt für Gruppen und Kurse mit dieser Adresse.</p>') +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">' + (mitKonto ? 'Antrag senden' : 'Code anfordern') + '</button></div></form>', (el) => {
      el.querySelector('#koQuota').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target); const body = { bereich, wunschMb: Number(fd.get('mb')), begruendung: String(fd.get('text') || '') };
        const fertig = () => { A.sheet('<h2>Antrag gesendet</h2><p>Vielen Dank. Sie erhalten eine E-Mail, sobald der Antrag geprüft ist.</p><button class="btn primary block" data-close>OK</button>'); info = null; };
        try {
          if (mitKonto) { await api('quota-antrag', { method: 'POST', body }); fertig(); return; }
          const email = String(fd.get('email')).trim().toLowerCase(); await api('quota-antrag/code', { method: 'POST', body: { email } });
          A.sheet('<h2>Code eingeben</h2><p class="small" style="margin-top:0">An <b>' + esc(email) + '</b> gesendet (15 Minuten gültig).</p><form id="koQc" class="stack"><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><p class="small" id="koQm" style="color:var(--schlecht);margin:0"></p><button class="btn primary block">Antrag senden</button></form>', (el2) => {
            el2.querySelector('#koQc').addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('quota-antrag', { method: 'POST', body: Object.assign({ email, code: String(new FormData(ev.target).get('code')) }, body) }); fertig(); } catch (er) { el2.querySelector('#koQm').textContent = 'Code falsch oder abgelaufen.'; } });
          });
        } catch (er) { A.toast(er.message === 'RATE_LIMITED' ? 'Zu viele Anfragen – bitte später.' : 'Fehler: ' + er.message); }
      });
    });
  }

  // =====================================================================
  // Klicks
  // =====================================================================
  async function handle(e) {
    const t = e.target.closest('[data-ko]'); if (!t) return false;
    const A = app(); const w = t.dataset.ko; const a = t.dataset.app;
    switch (w) {
      case 'anmelden': anmelden(() => A.go('#/daten')); break;
      case 'abmelden': if (confirm('Auf diesem Gerät abmelden? Die Daten bleiben auf dem Gerät; der Cloud-Abgleich stoppt.')) { await api('konto/logout', { method: 'POST' }).catch(() => {}); abmeldenLokal(); A.render(); } break;
      case 'cloud': {
        e.preventDefault();
        if (!info) break;
        if (!info.cloud[a]) { cloudZustimmung(a, () => { A.render(); abgleichen(a).then(() => A.render()); }); break; }
        const loeschen = confirm('Cloud-Speicherung für ' + (a === 'futter' ? 'Futter' : 'Wiese') + ' ausschalten.\n\nOK = auch die Cloud-Daten (inkl. Fotos) dieser App vom Server löschen\nAbbrechen = nichts ändern');
        if (!loeschen) break;
        try { await api('konto/cloud', { method: 'PUT', body: { app: a, an: false, loeschen: true } }); const s = lesen(KEY_STAND, {}); delete s[a]; schreiben(KEY_STAND, s); await infoLaden(true); A.toast('Ausgeschaltet und Cloud-Daten gelöscht. Auf diesem Gerät bleibt alles erhalten.'); A.render(); } catch (er) { A.toast('Fehler: ' + er.message); }
        break;
      }
      case 'sync': await abgleichen(a); A.render(); A.toast(status[a].fehler ? status[a].fehler : 'Abgeglichen.'); break;
      case 'geraet-weg': if (confirm('Dieses Gerät abmelden?')) { await api('konto/geraete/' + t.dataset.id, { method: 'DELETE' }).catch(() => {}); await infoLaden(true); A.render(); } break;
      case 'links-weg': if (confirm('Alle Anmelde-Links in Ihren E-Mails ungültig machen? Angemeldete Geräte bleiben angemeldet.')) { await api('konto/links', { method: 'DELETE' }).catch(() => {}); await infoLaden(true); A.render(); A.toast('Alle Anmelde-Links widerrufen.'); } break;
      case 'konto-weg':
        if (!confirm('Konto und alle Cloud-Daten (Futter, Wiese, Fotos) endgültig löschen? Die Daten auf diesem Gerät bleiben erhalten.')) break;
        try { await api('konto', { method: 'DELETE' }); abmeldenLokal(); A.render(); A.toast('Konto gelöscht.'); } catch (er) { A.toast('Fehler: ' + er.message); }
        break;
      case 'quota': quotaAntrag(t.dataset.bereich || 'konto'); break;
      default: return false;
    }
    return true;
  }

  global.Konto = { angemeldet, kopf, anmelden, linkLogin, datenHtml, handle, geaendert, allesAbgleichen, quotaHinweis, codeKaestchen, email: () => (sitzung ? sitzung.email : null), _t: { hash, lokal } };
})(window);
