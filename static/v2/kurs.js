/* Futter v2 – Kursmodus im Browser.
 * Kurs-Link «#k=<id>.<geheimnis>» → Kursschlüssel (E2E) + Beitritts-Token. Anmeldung per E-Mail-Code.
 * Lokal ist ein Kurs ein Anlass mit «kurs»-Feld; eigene Beurteilungen sind Proben mit «kursProbeId».
 */
(function (global) {
  'use strict';
  const C = global.FutterCrypto;
  const app = () => global.__app;
  const cache = new Map();   // anlassId → entschlüsselter Kursstand vom Server
  const keyCache = new Map(); // secret → Kursschlüssel
  const vergleichCache = new Map(); // kursProbeId → Abgaben

  async function kk(secret) {
    if (!keyCache.has(secret)) keyCache.set(secret, await C.kursKeys(secret));
    return keyCache.get(secret);
  }
  const H = (a) => ({ 'X-Kurs-Session': a.kurs.session || '' });
  const api = (path, o) => global.FutterIO.api('kurse/' + path, o);

  /** Vorschlag Anzeigename: anna.muster@… → «Anna M.» */
  function nameAusEmail(email) {
    const teile = String(email || '').split('@')[0].split(/[._-]+/).filter((x) => /[a-zà-ÿ]/i.test(x));
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    if (!teile.length) return '';
    return cap(teile[0]) + (teile[1] ? ' ' + teile[1].charAt(0).toUpperCase() + '.' : '');
  }

  const consentHtml = (leitung) => '<div class="consent"><ul>' +
    '<li>Für die Anmeldung per Code wird Ihre <b>E-Mail-Adresse verschlüsselt gespeichert</b>. Die Kursleitung sieht sie vollständig, andere Teilnehmende nur gekürzt (z. B. «an…@…le.ch").</li>' +
    '<li>Ihr <b>Anzeigename</b> (Vorname + Initiale, änderbar) und Ihre <b>abgegebenen Beurteilungen</b> sind für alle im Kurs sichtbar. Die Beurteilungen der anderen sehen Sie erst nach Ihrer eigenen Abgabe.</li>' +
    '<li>Namen, Kurstitel, Probenbezeichnungen und Notizen sind <b>Ende-zu-Ende verschlüsselt</b> (Schlüssel im Kurs-Link). Die Beurteilungsdaten selbst sind auf dem Server lesbar und können anonym ausgewertet werden.</li>' +
    '<li>Sie können jederzeit austreten – Ihre Daten werden dann gelöscht. Kurse werden ' + Math.round(((global.AGFF_V2 || {}).retentionDays || 730) / 30.4) + ' Monate nach der letzten Änderung gelöscht.</li>' +
    (leitung ? '<li>Als <b>Kursleitung</b> sehen Sie die E-Mail-Adressen der Teilnehmenden. Verwenden Sie sie nur für diesen Kurs.</li>' : '') +
    '</ul><p class="small"><a href="' + app().esc((global.AGFF_V2 || {}).privacyUrl || 'datenschutz') + '" target="_blank" rel="noopener">Datenschutzerklärung</a></p></div>';

  let kursConsentVersion = null;
  async function consentVersion() {
    if (!kursConsentVersion) kursConsentVersion = (await global.FutterIO.api('kurs-config')).consentVersion;
    return kursConsentVersion;
  }

  // ---------- Laden / Entschlüsseln ----------
  async function laden(a) {
    const k = await kk(a.kurs.secret);
    const r = await api(a.kurs.id, { headers: H(a) });
    const dec = async (box, teil) => { try { return box ? await C.decryptJSON(k.key, box, C.kursAad(a.kurs.id, teil)) : {}; } catch (e) { return {}; } };
    const meta = Object.assign({}, r.kurs.meta.analyse, await dec(r.kurs.meta.privat, 'meta'));
    const teilnehmende = [];
    for (const t of r.teilnehmende) teilnehmende.push({ id: t.id, rolle: t.rolle, email: t.email, name: (await dec(t.name, 'name|' + t.id)).name || '(ohne Namen)' });
    const proben = [];
    for (const p of r.proben) proben.push(Object.assign({ id: p.id, sort: p.sort, typ: p.analyse.typ, abgaben: p.abgaben, meineAbgabe: p.meineAbgabe }, await dec(p.privat, 'probe|' + p.id)));
    const st = { meta, teilnehmende, proben, ich: r.ich, geladen: Date.now() };
    cache.set(a.id, st);
    a.kurs.rolle = r.ich.rolle; a.kurs.ichId = r.ich.id;
    if (meta.titel) { a.titel = String(meta.titel).slice(0, 200); a.datum = meta.datum; a.ort = meta.ort; }
    // Abgabestatus vom Server übernehmen (anderes Gerät)
    app().db.proben.filter((p) => p.anlassId === a.id && p.kursProbeId).forEach((p) => {
      const kp = proben.find((x) => x.id === p.kursProbeId); if (kp && kp.meineAbgabe && !p.abgegebenAt) p.abgegebenAt = kp.meineAbgabe;
    });
    app().save();
    // Sichtbare Bereiche (Liste, Übersicht) mit dem neuen Stand zeichnen – nicht während einer Eingabe im Detail
    const rt = app().route(); if (rt.name === 'anlass' || rt.name === 'home') app().refreshChrome();
    return st;
  }
  const laedt = new Set();
  /** Lädt neu, wenn der Stand älter als 30 s ist (ohne Endlosschleife beim Neuzeichnen). */
  function frisch(a) {
    const st = cache.get(a.id);
    if (a.kurs.session && !laedt.has(a.id) && (!st || Date.now() - st.geladen > 30000) && !a.kurs.error) aktualisieren(a, true);
  }
  async function aktualisieren(a, still) {
    if (laedt.has(a.id)) return;
    laedt.add(a.id);
    try { await laden(a); a.kurs.error = null; } catch (e) {
      a.kurs.error = e.status === 404 ? 'Anmeldung abgelaufen oder Kurs gelöscht' : 'Offline – zeige letzten Stand';
      if (!still) app().toast(a.kurs.error);
    } finally { laedt.delete(a.id); }
    app().refreshChrome();
  }

  // ---------- Anmelde-Dialoge ----------
  function codeSchritt(titel, email, onCode, onResend) {
    const A = app();
    A.sheet('<h2>' + A.esc(titel) + '</h2><p class="small" style="margin-top:0">Wir haben einen 6-stelligen Code an <b>' + A.esc(email) + '</b> geschickt (gültig 15 Minuten). Bitte auch im Spam-Ordner nachsehen.</p>' +
      '<form id="codeForm" class="stack"><label class="field"><span>Code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required style="font-size:1.6rem;letter-spacing:.3em;text-align:center"></label>' +
      '<p class="hint" id="codeMsg"></p><div class="row"><button type="button" class="btn ghost grow" id="resend">Neuen Code senden</button><button class="btn primary grow">Bestätigen</button></div></form>', (el) => {
      el.querySelector('#codeForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const btn = e.target.querySelector('.primary'); btn.disabled = true;
        try { await onCode(String(new FormData(e.target).get('code')).trim()); } catch (er) {
          el.querySelector('#codeMsg').textContent = er.message === 'CODE_INVALID' ? 'Code falsch oder abgelaufen.' : er.message === 'RATE_LIMITED' ? 'Zu viele Versuche – bitte später erneut.' : 'Fehler: ' + er.message;
          btn.disabled = false;
        }
      });
      el.querySelector('#resend').addEventListener('click', async () => { try { await onResend(); el.querySelector('#codeMsg').textContent = 'Neuer Code gesendet.'; } catch (er) { el.querySelector('#codeMsg').textContent = er.message === 'RATE_LIMITED' ? 'Zu viele Anfragen – bitte später erneut.' : 'Fehler: ' + er.message; } });
    });
  }

  function nameSchritt(a, email, weiter) {
    const A = app();
    const st = cache.get(a.id);
    const ich = st && st.teilnehmende.find((t) => t.id === a.kurs.ichId);
    const vorschlag = ich && ich.name !== '(ohne Namen)' ? ich.name : nameAusEmail(email);
    A.sheet('<h2>Ihr Anzeigename im Kurs</h2><p class="small" style="margin-top:0">So erscheinen Sie in Listen und Vergleichen dieses Kurses. Vorschlag aus Ihrer E-Mail-Adresse – Sie können ihn ändern.</p>' +
      '<form id="nameForm" class="stack"><label class="field"><span>Vorname und Initiale</span><input class="input" name="name" required maxlength="60" value="' + A.esc(vorschlag) + '"></label>' +
      '<button class="btn primary block">Speichern</button></form>', (el) => {
      el.querySelector('#nameForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = String(new FormData(e.target).get('name')).trim().slice(0, 60);
        try { await nameSetzen(a, name); A.closeSheet(); if (weiter) weiter(); } catch (er) { A.toast('Speichern fehlgeschlagen: ' + er.message); }
      });
    });
  }
  async function nameSetzen(a, name) {
    const k = await kk(a.kurs.secret);
    await api(a.kurs.id + '/ich', { method: 'PUT', headers: H(a), body: { name: await C.encryptJSON(k.key, { name }, C.kursAad(a.kurs.id, 'name|' + a.kurs.ichId)) } });
    await laden(a);
  }

  async function metaSpeichern(a) {
    const k = await kk(a.kurs.secret);
    await api(a.kurs.id + '/meta', { method: 'PUT', headers: H(a), body: { analyse: a.datum ? { datum: a.datum } : {}, privat: await C.encryptJSON(k.key, { titel: a.titel, ort: a.ort || '' }, C.kursAad(a.kurs.id, 'meta')) } });
  }

  /** Kurs anlegen (Kursleitung). */
  function anlegen() {
    const A = app();
    A.sheet('<h2>Kurs anlegen</h2><p class="small" style="margin-top:0">Für Schulklassen und Gruppen: Alle beurteilen dieselben Proben und vergleichen danach ihre Ergebnisse.</p>' +
      '<form id="kursForm" class="stack"><label class="field"><span>Kurstitel *</span><input class="input" name="titel" required maxlength="200" placeholder="z. B. Silagekurs BZ Rütti, Klasse 2b"></label>' +
      '<div class="grid2"><label class="field"><span>Datum</span><input class="input" type="date" name="datum" value="' + new Date().toISOString().slice(0, 10) + '"></label><label class="field"><span>Ort</span><input class="input" name="ort" maxlength="200"></label></div>' +
      '<label class="field"><span>Ihre E-Mail-Adresse (Kursleitung) *</span><input class="input" type="email" name="email" required autocomplete="email"></label>' +
      consentHtml(true) +
      '<label class="toggle"><input type="checkbox" name="ok" required> <span>Ich habe die Hinweise gelesen und bin einverstanden.</span></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Code anfordern</button></div></form>', (el) => {
      el.querySelector('#kursForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target); const btn = e.target.querySelector('.primary'); btn.disabled = true;
        const email = String(fd.get('email')).trim().toLowerCase();
        try {
          const secret = C.newSecret(); const k = await kk(secret); const version = await consentVersion();
          const r = await global.FutterIO.api('kurse', { method: 'POST', body: { email, joinHash: k.joinHash, consent: { accepted: true, version } } });
          const a = { id: A.uid(), titel: String(fd.get('titel')).trim().slice(0, 200), datum: fd.get('datum') || undefined, ort: String(fd.get('ort') || '').trim(), createdAt: A.now(), updatedAt: A.now(),
            kurs: { id: r.id, secret, email, rolle: 'leitung' } };
          codeSchritt('Code eingeben', email, async (code) => {
            const v = await api(r.id + '/verify', { method: 'POST', body: { email, code, consent: { accepted: true, version } } });
            Object.assign(a.kurs, { session: v.session, ichId: v.ich.id, rolle: v.ich.rolle });
            A.db.anlaesse.push(a); A.save();
            await metaSpeichern(a); await laden(a);
            nameSchritt(a, email, () => { A.go('#/a/' + a.id); setTimeout(() => beitrittsQr(a), 80); }); // erst nach dem Seitenwechsel öffnen
          }, async () => { app().toast('Für einen neuen Code bitte den Kurs neu anlegen.'); });
        } catch (er) { A.toast(er.message === 'RATE_LIMITED' ? 'Zu viele Anfragen – bitte später erneut.' : 'Fehler: ' + er.message); btn.disabled = false; }
      });
    });
  }

  /** Beitritt / erneute Anmeldung über den Kurs-Link. */
  async function beitreten(token) {
    const A = app();
    const L = C.parseKursLink(token);
    if (!L) return A.toast('Ungültiger Kurs-Link.');
    let a = A.db.anlaesse.find((x) => x.kurs && x.kurs.id === L.id);
    if (a && a.kurs.session) {
      try { await laden(a); A.go('#/a/' + a.id); return; } catch (e) { if (e.status !== 404) { A.go('#/a/' + a.id); return; } }
    }
    const version = await consentVersion().catch(() => null);
    const bekannt = a && a.kurs.email;
    A.sheet('<h2>' + (bekannt ? 'Erneut anmelden' : 'Kurs beitreten') + '</h2><p class="small" style="margin-top:0">Melden Sie sich mit Ihrer E-Mail-Adresse an. Sie erhalten einen Code – ein Passwort braucht es nicht.</p>' +
      '<form id="joinForm" class="stack"><label class="field"><span>E-Mail-Adresse</span><input class="input" type="email" name="email" required autocomplete="email" value="' + A.esc(bekannt || '') + '"></label>' +
      (bekannt ? '' : consentHtml(false) + '<label class="toggle"><input type="checkbox" name="ok" required> <span>Ich habe die Hinweise gelesen und bin einverstanden.</span></label>') +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Code anfordern</button></div></form>', (el) => {
      el.querySelector('#joinForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const btn = e.target.querySelector('.primary'); btn.disabled = true;
        const email = String(new FormData(e.target).get('email')).trim().toLowerCase();
        try {
          const k = await kk(L.secret);
          const anfordern = () => global.FutterIO.api('kurse/' + L.id + '/code', { method: 'POST', body: { email, joinToken: k.joinToken } });
          await anfordern();
          codeSchritt('Code eingeben', email, async (code) => {
            const v = await api(L.id + '/verify', { method: 'POST', body: { email, code, consent: { accepted: true, version } } });
            if (!a) { a = { id: A.uid(), titel: 'Kurs', createdAt: A.now(), updatedAt: A.now(), kurs: { id: L.id, secret: L.secret } }; A.db.anlaesse.push(a); }
            Object.assign(a.kurs, { session: v.session, ichId: v.ich.id, rolle: v.ich.rolle, email });
            A.save(); await laden(a);
            if (v.neu) nameSchritt(a, email, () => A.go('#/a/' + a.id)); else { A.closeSheet(); A.go('#/a/' + a.id); A.toast('Angemeldet.'); }
          }, anfordern);
        } catch (er) { A.toast(er.status === 404 ? 'Kurs nicht gefunden oder Link ungültig.' : er.message === 'RATE_LIMITED' ? 'Zu viele Anfragen – bitte später erneut.' : 'Fehler: ' + er.message); btn.disabled = false; }
      });
    });
  }

  async function beitrittsQr(a) {
    const A = app();
    const link = global.FutterIO.appUrl() + '#k=' + a.kurs.id + '.' + a.kurs.secret;
    const el = A.sheet('<h2>Kurs-Link zum Beitreten</h2><p class="small" style="margin-top:0">Zeigen Sie den QR-Code (z. B. am Beamer) oder teilen Sie den Link. Wer beitreten will, braucht zusätzlich eine gültige E-Mail-Adresse.</p>' +
      '<div class="qr-box" id="kursQr"></div><div class="copy-field" style="margin-top:12px"><input class="input" readonly id="kursLink" value="' + A.esc(link) + '"><button class="btn" data-act="copy" data-target="#kursLink">Kopieren</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn grow" data-act="kurs-qr-gross" data-id="' + a.id + '">Vollbild für Beamer</button><button class="btn ghost grow" data-close>Schliessen</button></div>');
    const svg = await global.FutterIO.qrSvg(link); if (svg) el.querySelector('#kursQr').innerHTML = svg;
  }

  // ---------- Leitung: Kursproben ----------
  function probeDialog(a, kp) {
    const A = app(); const K3 = global.K3;
    A.sheet('<h2>' + (kp ? 'Kursprobe bearbeiten' : 'Kursprobe hinzufügen') + '</h2><form id="kpForm" class="stack">' +
      '<label class="field"><span>Bezeichnung *</span><input class="input" name="bez" required maxlength="120" value="' + A.esc(kp ? kp.bez : 'Probe ' + String.fromCharCode(65 + (cache.get(a.id) || { proben: [] }).proben.length)) + '"></label>' +
      '<label class="field"><span>Futterart</span><select class="input" name="typ"' + (kp && kp.abgaben ? ' disabled' : '') + '>' + Object.values(K3.TYPEN).map((t) => '<option value="' + t.id + '"' + (kp && kp.typ === t.id ? ' selected' : '') + '>' + t.titel + ' (' + t.merkblatt + ')</option>').join('') + '</select></label>' +
      '<label class="field"><span>Hinweis für Teilnehmende (optional)</span><input class="input" name="hinweis" maxlength="300" value="' + A.esc(kp ? kp.hinweis || '' : '') + '" placeholder="z. B. Herkunft, Lagerung, Besonderheiten"></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Speichern</button></div></form>', (el) => {
      el.querySelector('#kpForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        const id = kp ? kp.id : A.uid();
        const typ = kp && kp.abgaben ? kp.typ : String(fd.get('typ'));
        const k = await kk(a.kurs.secret);
        try {
          await api(a.kurs.id + '/proben/' + id, { method: 'PUT', headers: H(a), body: { analyse: { typ }, sort: kp ? kp.sort : (cache.get(a.id) || { proben: [] }).proben.length + 1,
            privat: await C.encryptJSON(k.key, { bez: String(fd.get('bez')).trim(), hinweis: String(fd.get('hinweis') || '').trim() }, C.kursAad(a.kurs.id, 'probe|' + id)) } });
          await laden(a); A.closeSheet(); A.refreshChrome();
        } catch (er) { A.toast('Speichern fehlgeschlagen: ' + er.message); }
      });
    });
  }

  // ---------- Teilnehmende ----------
  function teilnehmendeDialog(a) {
    const A = app(); const st = cache.get(a.id) || { teilnehmende: [] };
    const leitung = a.kurs.rolle === 'leitung';
    A.sheet('<h2>Teilnehmende (' + st.teilnehmende.length + ')</h2><ul class="list">' + st.teilnehmende.map((t) =>
      '<li class="item" style="cursor:default"><span class="avatar">' + A.esc(t.name.slice(0, 2).toUpperCase()) + '</span><span style="min-width:0;flex:1"><span class="t">' + A.esc(t.name) + (t.id === a.kurs.ichId ? ' (ich)' : '') + '</span><span class="s">' +
      A.esc(t.email || '') + (t.rolle === 'leitung' ? ' · Kursleitung' : '') + '</span></span>' +
      (leitung && t.rolle !== 'leitung' ? '<button class="btn sm danger" data-act="kurs-entfernen" data-id="' + a.id + '" data-tid="' + A.esc(t.id) + '">Entfernen</button>' : '') + '</li>').join('') + '</ul>' +
      '<div class="stack" style="margin-top:12px"><button class="btn block" data-act="kurs-name" data-id="' + a.id + '">Meinen Anzeigenamen ändern</button>' +
      (leitung ? '<button class="btn danger block" data-act="kurs-loeschen" data-id="' + a.id + '">Kurs für alle löschen</button>' : '<button class="btn danger block" data-act="kurs-austreten" data-id="' + a.id + '">Kurs verlassen & meine Daten löschen</button>') +
      '<button class="btn ghost block" data-close>Schliessen</button></div>');
  }

  // ---------- Darstellung in der Liste ----------
  function renderList(a, route) {
    const A = app(); const esc = A.esc; const st = cache.get(a.id);
    frisch(a);
    const leitung = a.kurs.rolle === 'leitung';
    const activeId = route.name === 'probe' ? (A.probeById(route.id) || {}).kursProbeId : null;
    const lokale = A.db.proben.filter((p) => p.anlassId === a.id && p.kursProbeId);
    let h = '<div class="bar"><a class="icon-btn back-btn hide-wide" href="#/" aria-label="Zurück">' + A.I.back + '</a><h2>' + esc(a.titel) +
      '<span class="sub">Kurs · ' + (leitung ? 'Kursleitung' : 'Teilnahme') + (st ? ' · ' + st.teilnehmende.length + ' Personen' : '') + '</span></h2>' +
      '<button class="icon-btn" data-act="kurs-menu" data-id="' + a.id + '" aria-label="Kurs-Aktionen">' + A.I.more + '</button></div>';
    if (a.kurs.error) h += '<div class="pad" style="padding-bottom:0"><div class="alert info">' + A.I.warn + '<div>' + esc(a.kurs.error) + (a.kurs.error.startsWith('Anmeldung') ? ' <button class="btn sm" data-act="kurs-login" data-id="' + a.id + '">Neu anmelden</button>' : '') + '</div></div></div>';
    h += '<div class="pad" style="padding-bottom:0"><div class="row"><button class="btn sm grow" data-act="kurs-teilnehmende" data-id="' + a.id + '">👥 Teilnehmende</button>' +
      (leitung ? '<button class="btn sm grow" data-act="kurs-qr" data-id="' + a.id + '">QR zum Beitreten</button>' : '') +
      '<a class="btn sm grow" href="#/a/' + a.id + '/uebersicht">' + A.I.table + ' Übersicht</a></div></div>';
    h += '<div class="section-title" style="padding:0 12px">Kursproben</div><ul class="list" style="padding:0 8px 8px">';
    if (!st) h += '<li class="empty small">Lade Kurs …</li>';
    else if (!st.proben.length) h += '<li class="empty small">' + (leitung ? 'Noch keine Kursproben. Legen Sie die Proben an, die alle beurteilen.' : 'Die Kursleitung hat noch keine Proben angelegt.') + '</li>';
    else st.proben.forEach((kp) => {
      const lp = lokale.find((p) => p.kursProbeId === kp.id);
      const abg = !!(kp.meineAbgabe || (lp && lp.abgegebenAt));
      const status = abg ? '<span class="chip gut">abgegeben ✓</span>' : lp ? '<span class="chip mittel">in Arbeit</span>' : '<span class="chip">offen</span>';
      h += '<li><a class="item" href="#" data-act="kurs-probe" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '" aria-current="' + (activeId === kp.id) + '"><span class="avatar">' + esc(global.K3.TYPEN[kp.typ].merkblatt) + '</span>' +
        '<span style="min-width:0"><span class="t">' + esc(kp.bez || 'Probe') + '</span><span class="s">' + esc(global.K3.TYPEN[kp.typ].titel + (kp.hinweis ? ' · ' + kp.hinweis : '')) + '</span></span>' +
        '<span class="meta">' + status + '<br><span class="small muted">' + kp.abgaben + ' Abgabe' + (kp.abgaben === 1 ? '' : 'n') + '</span></span></a>' +
        (leitung ? '<button class="btn sm ghost" style="margin:0 0 6px 60px" data-act="kurs-probe-edit" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '">Bearbeiten</button>' : '') + '</li>';
    });
    h += '</ul>';
    if (leitung) h += '<div class="fab-wrap"><button class="btn primary fab" data-act="kurs-probe-neu" data-id="' + a.id + '">' + A.I.plus + ' Kursprobe</button></div>';
    return h;
  }

  /** Kurs-Übersicht (Detailbereich): Fortschritt je Kursprobe, Zugang zum Vergleich. */
  function renderUebersicht(a) {
    const A = app(); const esc = A.esc; const st = cache.get(a.id);
    frisch(a);
    const leitung = a.kurs.rolle === 'leitung';
    let h = '<div class="bar"><a class="icon-btn back-btn hide-tablet" href="#/a/' + a.id + '" aria-label="Zurück">' + A.I.back + '</a><h2>Kursübersicht<span class="sub">' + esc(a.titel) + '</span></h2>' +
      (leitung ? '<button class="btn sm" data-act="kurs-qr-gross" data-id="' + a.id + '">QR für Beamer</button>' : '') + '</div><div class="pad">';
    if (!st) return h + '<div class="empty">Lade Kurs …</div></div>';
    const n = st.teilnehmende.length;
    const lokale = A.db.proben.filter((p) => p.anlassId === a.id && p.kursProbeId);
    h += '<div class="kpis"><div class="kpi"><div class="l">Personen</div><div class="v">' + n + '</div></div><div class="kpi"><div class="l">Kursproben</div><div class="v">' + st.proben.length + '</div></div>' +
      '<div class="kpi"><div class="l">Abgaben</div><div class="v">' + st.proben.reduce((x, p) => x + p.abgaben, 0) + '</div></div>' +
      '<div class="kpi"><div class="l">Meine Abgaben</div><div class="v">' + st.proben.filter((p) => p.meineAbgabe).length + '<small> / ' + st.proben.length + '</small></div></div></div>';
    if (!st.proben.length) return h + '<div class="empty">' + (leitung ? 'Legen Sie links die Kursproben an («+ Kursprobe»). Danach den QR-Code zeigen, damit alle beitreten.' : 'Die Kursleitung hat noch keine Proben angelegt.') + '</div></div>';
    h += '<div class="section-title">Fortschritt je Probe</div><div class="card"><div class="bars">' + st.proben.map((kp) => {
      const lp = lokale.find((p) => p.kursProbeId === kp.id);
      const darf = leitung || kp.meineAbgabe;
      const pct = n ? Math.round((kp.abgaben / n) * 100) : 0;
      return '<div class="b" data-act="kurs-probe" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '" title="' + esc(kp.bez) + '"><span class="lbl">' + esc(kp.bez || 'Probe') + '</span><span class="track"><span class="val" style="width:' + pct + '%;background:var(--brand)"></span></span>' +
        '<span class="n">' + kp.abgaben + '/' + n + '</span></div><div class="small muted" style="margin:-4px 0 8px">' + esc(global.K3.TYPEN[kp.typ].titel) + ' · ' +
        (kp.meineAbgabe ? 'von mir abgegeben' : lp ? 'meine Beurteilung in Arbeit' : 'noch nicht begonnen') + (darf && kp.abgaben ? ' · <a href="#" data-act="kurs-probe" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '">Vergleich ansehen →</a>' : '') + '</div>';
    }).join('') + '</div></div>';
    h += '<p class="hint">' + (leitung ? 'Als Kursleitung sehen Sie alle Abgaben jederzeit. ' : 'Den Vergleich mit den anderen sehen Sie je Probe nach Ihrer eigenen Abgabe. ') + 'Namen und Probenbezeichnungen sind Ende-zu-Ende verschlüsselt.</p></div>';
    return h;
  }

  /** Öffnet bzw. erzeugt die eigene Beurteilung einer Kursprobe. */
  function probeOeffnen(a, kpId) {
    const A = app(); const st = cache.get(a.id); const kp = st && st.proben.find((x) => x.id === kpId);
    if (!kp) return;
    let p = A.db.proben.find((x) => x.anlassId === a.id && x.kursProbeId === kpId);
    if (!p) {
      p = { id: A.uid(), typ: kp.typ, anlassId: a.id, kursProbeId: kpId, createdAt: A.now(), updatedAt: A.now(), kopf: { bez: kp.bez || 'Kursprobe', beurteiler: (st.teilnehmende.find((t) => t.id === a.kurs.ichId) || {}).name || '' }, antworten: {}, rad: {} };
      if (kp.meineAbgabe) p.abgegebenAt = kp.meineAbgabe;
      A.db.proben.push(p); A.save();
    }
    const zumVergleich = p.abgegebenAt || (a.kurs.rolle === 'leitung' && kp.abgaben > 0);
    A.go('#/p/' + p.id + '/' + (zumVergleich ? 'ergebnis' : (p.typ === 'mais' ? 'haecksel' : 'bestand')));
  }

  // ---------- Abgabe und Vergleich ----------
  async function abgeben(p) {
    const A = app(); const a = A.anlassById(p.anlassId);
    const res = A.auswertung(p);
    if (!res.vollstaendig) { A.toast('Bitte zuerst alle Angaben ausfüllen: ' + res.fehlend.join(', ')); return; }
    if (!confirm('Beurteilung jetzt abgeben?\n\nDanach können Sie sie nicht mehr ändern. Anschliessend sehen Sie die Beurteilungen der anderen.')) return;
    try {
      const k = await kk(a.kurs.secret);
      const { analyse, privat } = global.Model.split(p, 'probe');
      delete analyse.anlassId;
      const box = Object.keys(privat).length ? await C.encryptJSON(k.key, privat, C.kursAad(a.kurs.id, 'beurteilung|' + p.kursProbeId + '|' + p.id)) : null;
      await api(a.kurs.id + '/proben/' + p.kursProbeId + '/beurteilung', { method: 'PUT', headers: H(a), body: { data: { analyse, privat: box } } });
      p.abgegebenAt = A.now(); A.save(); vergleichCache.delete(p.kursProbeId);
      await laden(a).catch(() => {});
      A.toast('Abgegeben – der Vergleich ist jetzt freigeschaltet.'); A.render();
    } catch (er) {
      if (er.message === 'BEREITS_ABGEGEBEN') { p.abgegebenAt = p.abgegebenAt || A.now(); A.save(); A.render(); return; }
      A.toast('Abgabe fehlgeschlagen: ' + er.message);
    }
  }

  async function vergleichLaden(a, kpId) {
    const k = await kk(a.kurs.secret);
    const r = await api(a.kurs.id + '/proben/' + kpId + '/beurteilungen', { headers: H(a) });
    const st = cache.get(a.id) || { teilnehmende: [] };
    const out = [];
    for (const b of r.beurteilungen) {
      let privat = {};
      try { privat = b.privat ? await C.decryptJSON(k.key, b.privat, C.kursAad(a.kurs.id, 'beurteilung|' + kpId + '|' + b.analyse.id)) : {}; } catch (e) { privat = {}; }
      const probe = global.Model.cleanProbe(global.Model.merge(b.analyse, privat));
      if (!probe) continue;
      const t = st.teilnehmende.find((x) => x.id === b.teilnehmerId);
      out.push({ probe, name: t ? t.name : 'Ehemalige Person', ich: b.teilnehmerId === a.kurs.ichId });
    }
    vergleichCache.set(kpId, { liste: out, zeit: Date.now() });
    app().rerenderDetail(true);
  }

  /** Zusatz unter dem Ergebnis einer Kursprobe: Abgabe-Schaltfläche bzw. Vergleich. */
  function ergebnisExtra(p) {
    const A = app(); const esc = A.esc; const a = A.anlassById(p.anlassId);
    if (!a || !a.kurs || !p.kursProbeId) return '';
    const leitung = a.kurs.rolle === 'leitung';
    if (!p.abgegebenAt && !leitung) {
      return '<div class="card" style="margin-top:16px;border-color:var(--brand)"><h3>Beurteilung abgeben</h3><p class="small muted" style="margin:4px 0 12px">Erst nach Ihrer Abgabe sehen Sie, wie die anderen diese Probe beurteilt haben. Danach ist Ihre Beurteilung gesperrt.</p>' +
        '<button class="btn primary block" data-act="kurs-abgeben" data-id="' + p.id + '">Jetzt abgeben</button></div>';
    }
    const v = vergleichCache.get(p.kursProbeId);
    if (!v || Date.now() - v.zeit > 60000) { vergleichLaden(a, p.kursProbeId).catch((e) => A.toast(e.message === 'ERST_EIGENE_ABGEBEN' ? 'Vergleich erst nach eigener Abgabe.' : 'Vergleich nicht geladen: ' + e.message)); }
    let h = (!p.abgegebenAt && leitung ? '<div class="card" style="margin-top:16px"><div class="row"><span class="grow small">Als Kursleitung sehen Sie alle Abgaben. Eigene Abgabe optional:</span><button class="btn sm" data-act="kurs-abgeben" data-id="' + p.id + '">Abgeben</button></div></div>' : '') +
      '<div class="section-title">Vergleich im Kurs</div>';
    if (!v) return h + '<div class="card small muted">Lade Abgaben …</div>';
    const rows = v.liste.map((x) => ({ x, res: A.auswertung(x.probe) })).sort((m, n) => ((n.res.werte || {}).nel || 0) - ((m.res.werte || {}).nel || 0));
    const nels = rows.map((r) => r.res.werte && r.res.werte.nel).filter((n) => n != null);
    const mittel = nels.length ? nels.reduce((s, n) => s + n, 0) / nels.length : null;
    const meine = rows.find((r) => r.x.ich);
    h += '<div class="kpis"><div class="kpi"><div class="l">Abgaben</div><div class="v">' + rows.length + '</div></div><div class="kpi"><div class="l">Ø NEL</div><div class="v">' + A.fmt(mittel, 2) + ' <small>MJ</small></div></div>' +
      '<div class="kpi"><div class="l">Spannweite</div><div class="v" style="font-size:1.2rem">' + (nels.length ? A.fmt(Math.min(...nels), 2) + '–' + A.fmt(Math.max(...nels), 2) : '–') + '</div></div>' +
      '<div class="kpi"><div class="l">Meine Abweichung</div><div class="v" style="font-size:1.2rem">' + (meine && meine.res.werte && mittel != null ? (meine.res.werte.nel - mittel > 0 ? '+' : '') + A.fmt(meine.res.werte.nel - mittel, 2) : '–') + '</div></div></div>';
    h += '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Name</th><th>Beurteilung</th><th>Pkt./Korr.</th><th>NEL</th><th>APDE</th><th>Bestand/Stadium</th></tr></thead><tbody>' +
      rows.map(({ x, res }) => '<tr' + (x.ich ? ' style="background:var(--brand-soft)"' : '') + '><td><strong>' + esc(x.name) + (x.ich ? ' (ich)' : '') + '</strong></td><td><span class="chip ' + A.tonOf(res) + '">' + esc(res.sperre.length ? 'Nicht verfüttern' : res.klasse ? res.klasse.label : '–') + '</span></td><td>' +
        (x.probe.typ === 'heu' ? (res.korr ? A.fmt(res.korr.nel, 0) + ' %' : '–') : (res.punkte != null ? res.punkte : '–')) + '</td><td><strong>' + A.fmt(res.werte && res.werte.nel, 2) + '</strong></td><td>' + A.fmt(res.werte && res.werte.apde, 0) + '</td><td>' + esc(A.bestandStadium(x.probe)) + '</td></tr>').join('') +
      '</tbody></table></div>';
    // Antwortverteilung je Faktor – für die Besprechung im Kurs
    const typ = global.K3.TYPEN[p.typ];
    h += '<div class="section-title">Antworten im Beurteilungsrad</div><div class="card"><div class="stack">' + typ.rad.map((f) => {
      const zaehl = {}; rows.forEach(({ res }) => { const o = res.auswahl[f.id]; if (o) zaehl[o] = (zaehl[o] || 0) + 1; });
      const mein = meine && meine.res.auswahl[f.id];
      return '<div><div class="small" style="font-weight:700;margin-bottom:4px"><span class="dot" style="background:' + f.farbe + '"></span> ' + esc(f.gruppe.replace(/-/g, '') + (f.gruppe === 'Feldbedingungen' || f.gruppe === 'Sauberkeit' ? ' – ' + f.optionen[0].mitte : '')) + '</div><div class="row" style="gap:6px">' +
        f.optionen.filter((o) => zaehl[o.id]).map((o) => '<span class="chip' + (o.id === mein ? ' gut' : '') + '" title="' + esc(o.text) + '">' + esc(o.kurz === '!' ? '⚠' : o.kurz) + ' · ' + esc(o.text.split(/: | – |,/)[0].slice(0, 28)) + ' <b>×' + zaehl[o.id] + '</b></span>').join('') + '</div></div>';
    }).join('') + '</div><p class="hint">Grün = Ihre Antwort.</p></div>';
    h += '<div class="section-title">Räder aller Abgaben</div><div class="wheels">' + rows.map(({ x, res }) => '<div class="card" style="padding:8px;text-align:center' + (x.ich ? ';border-color:var(--brand)' : '') + '">' + A.wheelSvg(x.probe, res) + '<div class="small" style="font-weight:600">' + esc(x.name) + '</div></div>').join('') + '</div>';
    return h;
  }

  // ---------- Aktionen ----------
  async function handle(act, t) {
    const A = app(); const a = t.dataset.id ? A.anlassById(t.dataset.id) : null;
    switch (act) {
      case 'kurs-anlegen': A.closeSheet(); anlegen(); return true;
      case 'kurs-probe': if (a) probeOeffnen(a, t.dataset.kp); return true;
      case 'kurs-probe-neu': probeDialog(a, null); return true;
      case 'kurs-probe-edit': probeDialog(a, (cache.get(a.id) || { proben: [] }).proben.find((x) => x.id === t.dataset.kp)); return true;
      case 'kurs-qr': A.closeSheet(); beitrittsQr(a); return true;
      case 'kurs-qr-gross': {
        const link = global.FutterIO.appUrl() + '#k=' + a.kurs.id + '.' + a.kurs.secret;
        const el = A.sheet('<div style="text-align:center"><h2 style="font-size:2rem">' + A.esc(a.titel) + '</h2><p>QR-Code scannen, um dem Kurs beizutreten</p><div class="qr-box" id="qrGross" style="max-width:min(80vh,90vw);margin:0 auto"></div><button class="btn ghost block" data-close style="margin-top:12px">Schliessen</button></div>');
        el.style.maxWidth = '900px';
        const svg = await global.FutterIO.qrSvg(link); if (svg) { el.querySelector('#qrGross').innerHTML = svg; const s = el.querySelector('#qrGross svg'); s.style.width = '100%'; s.style.height = 'auto'; }
        return true;
      }
      case 'kurs-teilnehmende': await laden(a).catch(() => {}); teilnehmendeDialog(a); return true;
      case 'kurs-name': nameSchritt(a, a.kurs.email, () => teilnehmendeDialog(a)); return true;
      case 'kurs-login': beitreten(a.kurs.id + '.' + a.kurs.secret); return true;
      case 'kurs-abgeben': await abgeben(A.probeById(t.dataset.id)); return true;
      case 'kurs-menu': {
        const leitung = a.kurs.rolle === 'leitung';
        A.sheet('<h2>' + A.esc(a.titel) + '</h2><div class="stack">' +
          (leitung ? '<button class="btn block" data-act="kurs-qr" data-id="' + a.id + '">QR / Link zum Beitreten</button><button class="btn block" data-act="kurs-titel" data-id="' + a.id + '">Kurstitel bearbeiten</button>' : '') +
          '<button class="btn block" data-act="kurs-teilnehmende" data-id="' + a.id + '">Teilnehmende</button>' +
          '<button class="btn block" data-act="kurs-sync" data-id="' + a.id + '">Aktualisieren</button>' +
          '<button class="btn block" data-act="pdf-anlass" data-id="' + a.id + '">' + A.I.pdf + ' PDF meiner Beurteilungen</button>' +
          '<button class="btn block" data-act="kurs-abmelden" data-id="' + a.id + '">Auf diesem Gerät abmelden</button>' +
          '<button class="btn ghost block" data-close>Schliessen</button></div>');
        return true;
      }
      case 'kurs-titel': A.closeSheet(); A.sheetAnlass(a, async () => { try { await metaSpeichern(a); await laden(a); A.refreshChrome(); } catch (er) { A.toast('Speichern fehlgeschlagen: ' + er.message); } }); return true;
      case 'kurs-sync': A.closeSheet(); await aktualisieren(a); vergleichCache.clear(); A.render(); return true;
      case 'kurs-abmelden': {
        if (!confirm('Auf diesem Gerät abmelden? Ihre Beurteilungen bleiben im Kurs; Sie können sich mit Ihrer E-Mail-Adresse wieder anmelden.')) return true;
        await api(a.kurs.id + '/logout', { method: 'POST', headers: H(a) }).catch(() => {});
        delete a.kurs.session; A.save(); A.closeSheet(); A.render(); return true;
      }
      case 'kurs-entfernen': {
        if (!confirm('Diese Person aus dem Kurs entfernen? Ihre Abgaben werden gelöscht.')) return true;
        try { await api(a.kurs.id + '/teilnehmende/' + t.dataset.tid, { method: 'DELETE', headers: H(a) }); await laden(a); teilnehmendeDialog(a); vergleichCache.clear(); } catch (er) { A.toast('Fehler: ' + er.message); }
        return true;
      }
      case 'kurs-austreten': case 'kurs-loeschen': {
        const loeschen = act === 'kurs-loeschen';
        if (!confirm(loeschen ? 'Den ganzen Kurs mit allen Abgaben für ALLE Teilnehmenden endgültig löschen?' : 'Kurs verlassen? Ihre Abgaben und Ihre Anmeldedaten werden auf dem Server gelöscht. Ihre lokalen Beurteilungen bleiben auf diesem Gerät.')) return true;
        try {
          await api(loeschen ? a.kurs.id : a.kurs.id + '/teilnehmende/' + a.kurs.ichId, { method: 'DELETE', headers: H(a) });
          A.db.proben.filter((p) => p.anlassId === a.id).forEach((p) => { delete p.kursProbeId; delete p.abgegebenAt; });
          delete a.kurs; cache.delete(a.id); A.save(); A.closeSheet(); A.render();
          A.toast(loeschen ? 'Kurs gelöscht.' : 'Sie haben den Kurs verlassen; Ihre Daten auf dem Server sind gelöscht.');
        } catch (er) { A.toast('Fehler: ' + er.message); }
        return true;
      }
      default: return false;
    }
  }

  // Kursansicht regelmässig auffrischen (neue Teilnehmende, Abgaben)
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !app()) return;
    const r = app().route(); const a = r.name === 'anlass' && app().anlassById(r.id);
    if (a && a.kurs && a.kurs.session && !document.querySelector('.scrim')) aktualisieren(a, true);
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !app()) return;
    const r = app().route(); const aid = r.name === 'anlass' ? r.id : r.name === 'probe' ? (app().probeById(r.id) || {}).anlassId : null;
    const a = aid && app().anlassById(aid);
    if (a && a.kurs && a.kurs.session) { vergleichCache.clear(); aktualisieren(a, true); }
  });

  global.Kurs = { renderList, renderUebersicht, ergebnisExtra, handle, beitreten, anlegen, istAbgegeben: (p) => !!(p && p.abgegebenAt), nameAusEmail };
})(window);
