/* Futter v2 – Kursmodus im Browser.
 *
 * Kurs-Link «#k=<id>.<geheimnis>[.<probe>]» → Kursschlüssel (E2E) + Beitritts-Token.
 * - Kursleitung (freigeschaltet) legt den Kurs an, druckt QR-Etiketten (leere, nummerierte Proben)
 *   und legt fest, welche Angaben als Hilfestellung erscheinen.
 * - Teilnehmende scannen ein Etikett: Beitritt nur mit Namen; leere Probe → Ersterfassung;
 *   erfasste Probe → Beurteilung. E-Mail optional (Zugriff von anderen Geräten).
 * - Lokal ist ein Kurs ein Anlass mit «kurs»-Feld; eigene Beurteilungen sind Proben mit «kursProbeId».
 */
(function (global) {
  'use strict';
  const C = global.FutterCrypto;
  const app = () => global.__app;
  const F = () => global.Fotos;
  const cache = new Map();          // anlassId → entschlüsselter Kursstand
  const keyCache = new Map();       // secret → Kursschlüssel
  const vergleichCache = new Map(); // kursProbeId → Abgaben
  const kfotoUrls = new Map();      // fotoId → Object-URL (Vorschau)
  const laedt = new Set();

  async function kk(secret) {
    if (!keyCache.has(secret)) keyCache.set(secret, await C.kursKeys(secret));
    return keyCache.get(secret);
  }
  const H = (a) => ({ 'X-Kurs-Session': a.kurs.session || '' });
  const api = (path, o) => global.FutterIO.api('kurse/' + path, o);
  const fehlerText = (e) => ({
    RATE_LIMITED: 'Zu viele Anfragen – bitte später erneut versuchen.', CODE_INVALID: 'Code falsch oder abgelaufen.',
    NICHT_FREIGESCHALTET: 'Diese Adresse ist noch nicht für Kurse freigeschaltet.', BEREITS_ERFASST: 'Diese Probe wurde bereits von jemand anderem erfasst.',
    QUOTA: 'Ihr Foto-Speicher in diesem Kurs ist voll (20 MB).', SERVER_VOLL: 'Der Server-Speicher für Fotos ist voll.', EMAIL_VERGEBEN: 'Diese E-Mail-Adresse ist im Kurs bereits verwendet.',
    UNBEKANNT: 'Zu dieser Adresse gibt es im Kurs keine Teilnahme.', TYP_FEST: 'Die Futterart kann nach den ersten Abgaben nicht mehr geändert werden.',
  }[e && e.message] || ('Fehler: ' + (e && e.message)));

  /** Vorschlag Anzeigename: anna.muster@… → «Anna M.» */
  function nameAusEmail(email) {
    const teile = String(email || '').split('@')[0].split(/[._-]+/).filter((x) => /[a-zà-ÿ]/i.test(x));
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    if (!teile.length) return '';
    return cap(teile[0]) + (teile[1] ? ' ' + teile[1].charAt(0).toUpperCase() + '.' : '');
  }
  const monate = () => Math.round(((global.AGFF_V2 || {}).retentionDays || 730) / 30.4);
  const dsLink = () => '<a href="' + app().esc((global.AGFF_V2 || {}).privacyUrl || 'datenschutz') + '" target="_blank" rel="noopener">Datenschutzerklärung</a>';

  function consentHtml(leitung) {
    return '<div class="consent"><p class="small" style="margin-top:0"><b>Im Kurs wird alles auf dem Server gespeichert</b>, damit die Gruppe gemeinsam beurteilen und vergleichen kann:</p><ul>' +
      '<li>Ihr <b>Vorname</b> (Anzeigename) und – falls angegeben – Ihre <b>E-Mail-Adresse</b>' + (leitung ? ' (für die Kursleitung Pflicht, Anmeldung per Code)' : ' (freiwillig, damit Sie Ihre Proben auch auf anderen Geräten sehen)') + '.</li>' +
      '<li>Alle <b>Angaben zu den Proben</b>: Bezeichnung, Schnitt, Notizen, <b>Standort</b> (PLZ, Ort, Höhe, ungefähre Position), <b>Fotos vom Futter</b>, <b>Fotos von Laborberichten</b> und Laborwerte.</li>' +
      '<li>Ihre <b>Beurteilungen</b> inklusive Fotos und Laborimport.</li>' +
      '<li><b>Wer sieht was:</b> Die Kursleitung sieht alles, auch die vollständigen E-Mail-Adressen. Kursmitglieder sehen Namen, Proben und Beurteilungen der anderen – Beurteilungen und Laborwerte erst nach der eigenen Abgabe; E-Mail-Adressen nur gekürzt.</li>' +
      '<li>Die Daten sind auf dem Server mit dem Kursschlüssel (im Kurs-Link bzw. auf dem QR-Etikett) verschlüsselt; die Beurteilungsdaten ohne Namen sind lesbar und können anonym ausgewertet werden. Laborberichte: Adresse vor dem Fotografieren abdecken oder schwärzen.</li>' +
      '<li>Sie können jederzeit austreten – Ihre Daten werden gelöscht. Kurse werden ' + monate() + ' Monate nach der letzten Änderung gelöscht.</li>' +
      '</ul><p class="small">' + dsLink() + '</p></div>';
  }

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
    for (const t of r.teilnehmende) teilnehmende.push({ id: t.id, rolle: t.rolle, email: t.email, mitEmail: t.mitEmail, name: (await dec(t.name, 'name|' + t.id)).name || '(ohne Namen)' });
    const proben = [];
    for (const p of r.proben) {
      const pv = p.status === 'erfasst' ? await dec(p.privat, 'probe|' + p.id) : {};
      const lab = p.labor ? await dec(p.labor, 'labor|' + p.id) : null;
      proben.push(Object.assign({ id: p.id, nr: p.nr, status: p.status, eigene: p.eigene, ownerId: p.ownerId, typ: p.analyse.typ, abgaben: p.abgaben, meineAbgabe: p.meineAbgabe, hatLabor: p.hatLabor, labor: lab }, pv));
    }
    const st = { meta, hinweise: r.hinweise, teilnehmende, proben, ich: r.ich, geladen: Date.now() };
    cache.set(a.id, st);
    a.kurs.rolle = r.ich.rolle; a.kurs.ichId = r.ich.id;
    if (meta.titel) { a.titel = String(meta.titel).slice(0, 200); a.datum = meta.datum; a.ort = meta.ort; }
    app().db.proben.filter((p) => p.anlassId === a.id && p.kursProbeId).forEach((p) => {
      const kp = proben.find((x) => x.id === p.kursProbeId); if (kp && kp.meineAbgabe && !p.abgegebenAt) p.abgegebenAt = kp.meineAbgabe;
    });
    app().save();
    const rt = app().route(); if (rt.name === 'anlass' || rt.name === 'home') app().refreshChrome();
    return st;
  }
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

  // ---------- Dialog-Bausteine ----------
  function codeSchritt(titel, email, onCode, onResend, gueltig) {
    const A = app();
    A.sheet('<h2>' + A.esc(titel) + '</h2><p class="small" style="margin-top:0">Wir haben einen 6-stelligen Code an <b>' + A.esc(email) + '</b> geschickt (gültig ' + (gueltig || '15 Minuten') + '). Bitte auch im Spam-Ordner nachsehen.</p>' +
      '<form id="codeForm" class="stack"><label class="field"><span>Code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required style="font-size:1.6rem;letter-spacing:.3em;text-align:center"></label>' +
      '<p class="hint" id="codeMsg"></p><div class="row"><button type="button" class="btn ghost grow" id="resend">Neuen Code senden</button><button class="btn primary grow">Bestätigen</button></div></form>', (el) => {
      el.querySelector('#codeForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const btn = e.target.querySelector('.primary'); btn.disabled = true;
        try { await onCode(String(new FormData(e.target).get('code')).trim()); } catch (er) { el.querySelector('#codeMsg').textContent = fehlerText(er); btn.disabled = false; }
      });
      el.querySelector('#resend').addEventListener('click', async () => { try { await onResend(); el.querySelector('#codeMsg').textContent = 'Neuer Code gesendet.'; } catch (er) { el.querySelector('#codeMsg').textContent = fehlerText(er); } });
    });
  }

  function nameSchritt(a, vorschlag, weiter) {
    const A = app();
    A.sheet('<h2>Ihr Anzeigename im Kurs</h2><p class="small" style="margin-top:0">So erscheinen Sie in Listen und Vergleichen dieses Kurses, z. B. «Anna M.».</p>' +
      '<form id="nameForm" class="stack"><label class="field"><span>Vorname und Initiale</span><input class="input" name="name" required maxlength="60" value="' + A.esc(vorschlag || '') + '" autocomplete="nickname"></label>' +
      '<button class="btn primary block">Speichern</button></form>', (el) => {
      el.querySelector('#nameForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await nameSetzen(a, String(new FormData(e.target).get('name')).trim().slice(0, 60)); A.closeSheet(); if (weiter) weiter(); } catch (er) { A.toast(fehlerText(er)); }
      });
    });
  }
  async function nameSetzen(a, name) {
    const k = await kk(a.kurs.secret);
    await api(a.kurs.id + '/ich', { method: 'PUT', headers: H(a), body: { name: await C.encryptJSON(k.key, { name }, C.kursAad(a.kurs.id, 'name|' + a.kurs.ichId)) } });
    await laden(a);
  }
  async function metaSpeichern(a, hinweise) {
    const k = await kk(a.kurs.secret);
    const st = cache.get(a.id);
    const h = hinweise || (st && st.hinweise) || undefined;
    await api(a.kurs.id + '/meta', { method: 'PUT', headers: H(a), body: { analyse: Object.assign(a.datum ? { datum: a.datum } : {}, h ? { hinweise: h } : {}),
      privat: await C.encryptJSON(k.key, { titel: a.titel, ort: a.ort || '' }, C.kursAad(a.kurs.id, 'meta')) } });
  }

  // ---------- Kurs anlegen (freigeschaltete Kursleitung) ----------
  // Entwurf merken, falls die Kursleitung erst freigeschaltet werden muss (nur auf diesem Gerät)
  const ENTWURF = 'agffV2KursEntwurf';
  const entwurf = {
    lesen() { try { return JSON.parse(localStorage.getItem(ENTWURF) || 'null'); } catch (e) { return null; } },
    merken(d) { try { localStorage.setItem(ENTWURF, JSON.stringify({ titel: d.titel, datum: d.datum, ort: d.ort, email: d.email })); } catch (e) { /* egal */ } },
    weg() { try { localStorage.removeItem(ENTWURF); } catch (e) { /* egal */ } },
  };

  function anlegen(vorher) {
    const A = app(); const v = vorher || entwurf.lesen() || {};
    A.sheet('<h2>Kurs anlegen</h2><p class="small" style="margin-top:0">Für Schulklassen und Gruppen: Teilnehmende erfassen Proben per QR-Etikett und beurteilen sie gegenseitig. Kurse anlegen können freigeschaltete Kursleitende.</p>' +
      '<form id="kursForm" class="stack"><label class="field"><span>Kurstitel *</span><input class="input" name="titel" required maxlength="200" value="' + A.esc(v.titel || '') + '" placeholder="z. B. Silagekurs BZ Rütti, Klasse 2b"></label>' +
      '<div class="grid2"><label class="field"><span>Datum</span><input class="input" type="date" name="datum" value="' + A.esc(v.datum || new Date().toISOString().slice(0, 10)) + '"></label><label class="field"><span>Ort</span><input class="input" name="ort" maxlength="200" value="' + A.esc(v.ort || '') + '"></label></div>' +
      '<label class="field"><span>Ihre E-Mail-Adresse *</span><input class="input" type="email" name="email" required autocomplete="email" value="' + A.esc(v.email || '') + '"></label>' +
      '<label class="field"><span>Einladungscode (falls vorhanden)</span><input class="input" name="einladung" maxlength="20" value="' + A.esc(v.einladung || '') + '" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters"></label>' +
      consentHtml(true) + '<label class="toggle"><input type="checkbox" name="ok" required> <span>Ich habe die Hinweise gelesen und bin einverstanden.</span></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Weiter</button></div></form>', (el) => {
      el.querySelector('#kursForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target); const btn = e.target.querySelector('.primary'); btn.disabled = true;
        const d = { titel: String(fd.get('titel')).trim().slice(0, 200), datum: fd.get('datum') || undefined, ort: String(fd.get('ort') || '').trim(), email: String(fd.get('email')).trim().toLowerCase(), einladung: String(fd.get('einladung') || '').trim() };
        try { await anlegenSenden(d); } catch (er) {
          btn.disabled = false;
          if (er.message === 'NICHT_FREIGESCHALTET') freischalten(d); else A.toast(fehlerText(er));
        }
      });
    });
  }
  async function anlegenSenden(d) {
    const A = app();
    const secret = C.newSecret(); const k = await kk(secret); const version = await consentVersion();
    const r = await global.FutterIO.api('kurse', { method: 'POST', body: { email: d.email, joinHash: k.joinHash, consent: { accepted: true, version }, einladung: d.einladung || undefined } });
    codeSchritt('E-Mail bestätigen', d.email, async (code) => {
      const v = await api(r.id + '/aktivieren', { method: 'POST', body: { email: d.email, code } });
      const a = { id: A.uid(), titel: d.titel, datum: d.datum, ort: d.ort, createdAt: A.now(), updatedAt: A.now(), kurs: { id: r.id, secret, email: d.email, session: v.session, ichId: v.ich.id, rolle: 'leitung' } };
      entwurf.weg();
      A.db.anlaesse.push(a); A.save();
      await metaSpeichern(a, null); await laden(a);
      nameSchritt(a, nameAusEmail(d.email), () => { A.go('#/a/' + a.id); setTimeout(() => etikettenDialog(a), 80); });
    }, () => A.toast('Bitte das Formular erneut absenden, um einen neuen Code zu erhalten.'));
  }
  function freischalten(d) {
    const A = app(); entwurf.merken(d);
    A.sheet('<h2>Noch nicht freigeschaltet</h2><p class="small" style="margin-top:0"><b>' + A.esc(d.email) + '</b> ist noch nicht als Kursleitung freigeschaltet. Sie haben zwei Möglichkeiten:</p>' +
      '<div class="stack"><form id="invForm" class="card stack"><b>Einladungscode eingeben</b><input class="input" name="einladung" required placeholder="XXXX-XXXX-XXXX" autocapitalize="characters"><button class="btn primary">Mit Code fortfahren</button></form>' +
      '<div class="card stack"><b>Antrag stellen</b><p class="small muted" style="margin:0">Der Betreiber prüft Ihren Antrag und schaltet Sie per E-Mail frei.</p><button class="btn" id="antragBtn">Antrag stellen …</button></div>' +
      '<button class="btn ghost block" data-close>Abbrechen</button></div>', (el) => {
      el.querySelector('#invForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const code = String(new FormData(e.target).get('einladung')).trim();
        try { await anlegenSenden(Object.assign({}, d, { einladung: code })); } catch (er) { A.toast(er.message === 'NICHT_FREIGESCHALTET' ? 'Einladungscode ungültig oder bereits verwendet.' : fehlerText(er)); }
      });
      el.querySelector('#antragBtn').addEventListener('click', () => antrag(d));
    });
  }
  function antrag(d) {
    const A = app();
    A.sheet('<h2>Antrag: Kurse anlegen</h2><form id="antragForm" class="stack">' +
      '<label class="field"><span>Name *</span><input class="input" name="name" required maxlength="120" autocomplete="name"></label>' +
      '<label class="field"><span>Organisation / Schule</span><input class="input" name="org" maxlength="200" autocomplete="organization"></label>' +
      '<label class="field"><span>Wofür möchten Sie Kurse anlegen?</span><textarea class="input" name="text" maxlength="1000" placeholder="z. B. Futterbaukurs an der Landwirtschaftsschule"></textarea></label>' +
      '<p class="small muted">E-Mail: <b>' + A.esc(d.email) + '</b> (wird bestätigt). Name, Organisation und Begründung werden verschlüsselt gespeichert und nur vom Betreiber zur Prüfung gelesen. ' + dsLink() + '</p>' +
      '<label class="toggle"><input type="checkbox" name="ok" required> <span>Einverstanden</span></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Code anfordern</button></div></form>', (el) => {
      el.querySelector('#antragForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        const daten = { email: d.email, name: String(fd.get('name')).trim(), org: String(fd.get('org') || '').trim(), text: String(fd.get('text') || '').trim(), consent: { accepted: true } };
        const anfordern = () => global.FutterIO.api('kursleitung/antrag/code', { method: 'POST', body: { email: d.email } });
        try {
          await anfordern();
          codeSchritt('E-Mail bestätigen', d.email, async (code) => {
            const r = await global.FutterIO.api('kursleitung/antrag', { method: 'POST', body: Object.assign({ code }, daten) });
            if (r.status === 'frei') { A.toast('Sie sind freigeschaltet.'); await anlegenSenden(d); return; }
            A.sheet('<h2>Antrag gesendet</h2><p>Vielen Dank. Sie erhalten eine E-Mail an <b>' + A.esc(d.email) + '</b>, sobald Ihr Antrag geprüft ist. Danach können Sie den Kurs anlegen.</p><button class="btn primary block" data-close>OK</button>');
          }, anfordern);
        } catch (er) { A.toast(fehlerText(er)); }
      });
    });
  }

  // ---------- Beitreten / Etikett scannen ----------
  async function beitreten(token) {
    const A = app();
    const L = C.parseKursLink(token);
    if (!L) return A.toast('Ungültiger Kurs-Link.');
    const a = A.db.anlaesse.find((x) => x.kurs && x.kurs.id === L.id);
    if (a && a.kurs.session) {
      try { await laden(a); a.kurs.error = null; } catch (e) { if (e.status === 404) { delete a.kurs.session; A.save(); return beitretenDialog(L, a); } }
      if (L.probe) return scan(a, L.probe);
      A.go('#/a/' + a.id); return;
    }
    beitretenDialog(L, a);
  }
  function beitretenDialog(L, vorhanden) {
    const A = app();
    A.sheet('<h2>' + (L.probe ? 'Probe im Kurs' : 'Kurs beitreten') + '</h2><p class="small" style="margin-top:0">Zum Mitmachen genügt ein Anzeigename – ohne Konto, ohne Passwort.</p>' +
      '<form id="joinForm" class="stack"><label class="field"><span>Anzeigename (z. B. Vorname und Initiale)</span><input class="input" name="name" required maxlength="60" autocomplete="nickname"></label>' +
      '<label class="field"><span>E-Mail-Adresse <span class="muted">(empfohlen)</span></span><input class="input" type="email" name="email" maxlength="200" autocomplete="email" placeholder="damit Sie Ihre Proben später wiederfinden"></label>' +
      consentHtml(false) + '<label class="toggle"><input type="checkbox" name="ok" required> <span>Ich habe die Hinweise gelesen und bin einverstanden.</span></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Mitmachen</button></div></form>' +
      '<button class="btn ghost block" id="emailLogin" style="margin-top:8px">Schon dabei? Mit E-Mail anmelden</button>', (el) => {
      el.querySelector('#joinForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const btn = e.target.querySelector('.primary'); btn.disabled = true;
        const fd = new FormData(e.target);
        const name = String(fd.get('name')).trim().slice(0, 60); const email = String(fd.get('email') || '').trim().toLowerCase();
        try {
          const k = await kk(L.secret); const version = await consentVersion();
          const v = await api(L.id + '/beitreten', { method: 'POST', body: { joinToken: k.joinToken, consent: { accepted: true, version } } });
          const a = anlassFuer(L, vorhanden, v);
          await nameSetzen(a, name); A.closeSheet();
          if (email) await mailSenden(a, email).catch((er) => A.toast('Bestätigungsmail nicht gesendet: ' + fehlerText(er)));
          if (L.probe) scan(a, L.probe); else A.go('#/a/' + a.id);
        } catch (er) { btn.disabled = false; A.toast(er.status === 404 ? 'Kurs nicht gefunden oder Etikett ungültig.' : fehlerText(er)); }
      });
      el.querySelector('#emailLogin').addEventListener('click', () => emailAnmelden(L, vorhanden));
    });
  }
  function anlassFuer(L, vorhanden, v) {
    const A = app();
    let a = vorhanden;
    if (!a) { a = { id: A.uid(), titel: 'Kurs', createdAt: A.now(), updatedAt: A.now(), kurs: { id: L.id, secret: L.secret } }; A.db.anlaesse.push(a); }
    Object.assign(a.kurs, { session: v.session, ichId: v.ich.id, rolle: v.ich.rolle }); a.kurs.error = null;
    A.save();
    return a;
  }
  function emailAnmelden(L, vorhanden) {
    const A = app();
    A.sheet('<h2>Mit E-Mail anmelden</h2><p class="small" style="margin-top:0">Wenn Sie in diesem Kurs schon eine E-Mail-Adresse bestätigt haben, erhalten Sie einen Code.</p>' +
      '<form id="loginForm" class="stack"><label class="field"><span>E-Mail-Adresse</span><input class="input" type="email" name="email" required autocomplete="email"></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Code anfordern</button></div></form>', (el) => {
      el.querySelector('#loginForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const email = String(new FormData(e.target).get('email')).trim().toLowerCase();
        try {
          const k = await kk(L.secret);
          const anfordern = () => api(L.id + '/email/code', { method: 'POST', body: { email, joinToken: k.joinToken } });
          await anfordern();
          codeSchritt('Code eingeben', email, async (code) => {
            const v = await api(L.id + '/email/verify', { method: 'POST', body: { email, code, joinToken: k.joinToken } });
            const a = anlassFuer(L, vorhanden, v); a.kurs.email = email; A.save();
            await laden(a); A.closeSheet(); A.toast('Angemeldet.');
            if (L.probe) scan(a, L.probe); else A.go('#/a/' + a.id);
          }, anfordern);
        } catch (er) { A.toast(fehlerText(er)); }
      });
    });
  }
  /** Bestätigungsmail mit Link senden; die Teilnahme läuft sofort weiter, die Adresse gilt erst nach Bestätigung. */
  async function mailSenden(a, email) {
    const A = app();
    await api(a.kurs.id + '/email/code', { method: 'POST', headers: H(a), body: { email } });
    a.kurs.emailPending = email; A.save();
    A.toast('Bestätigungsmail an ' + email + ' gesendet – Link in der Mail antippen.');
  }
  async function mailBestaetigen(a, code) {
    const A = app(); const email = a.kurs.emailPending;
    await api(a.kurs.id + '/email/verify', { method: 'POST', headers: H(a), body: { email, code } });
    a.kurs.email = email; delete a.kurs.emailPending; A.save(); await laden(a).catch(() => {});
    A.closeSheet(); A.toast('E-Mail bestätigt – Ihre Proben sind jetzt auch auf anderen Geräten erreichbar.'); A.render();
  }
  /** Link aus der Bestätigungsmail (#km=<kursId>.<code>) */
  async function mailLink(token) {
    const A = app(); const m = /^([A-Za-z0-9_-]{6,64})\.(\d{6})$/.exec(token || '');
    const a = m && A.db.anlaesse.find((x) => x.kurs && x.kurs.id === m[1]);
    if (!a || !a.kurs.session || !a.kurs.emailPending) {
      A.sheet('<h2>E-Mail bestätigen</h2><p>Bitte öffnen Sie den Link auf dem Gerät, mit dem Sie im Kurs mitmachen – oder geben Sie dort den Code aus der Mail ein' + (m ? ': <b style="letter-spacing:.2em">' + m[2] + '</b>' : '') + '.</p><button class="btn primary block" data-close>OK</button>');
      return;
    }
    try { await mailBestaetigen(a, m[2]); A.go('#/a/' + a.id); } catch (er) { A.toast('Bestätigung fehlgeschlagen: ' + fehlerText(er) + '. Bitte neuen Link anfordern.'); A.go('#/a/' + a.id); }
  }
  /** E-Mail angeben oder korrigieren (Ermunterung), damit die Proben später wieder sichtbar sind. */
  function emailVerknuepfen(a) {
    const A = app();
    A.sheet('<h2>' + (a.kurs.emailPending ? 'E-Mail-Adresse ändern' : 'Proben später wiederfinden') + '</h2><p class="small" style="margin-top:0">Ohne bestätigte E-Mail ist Ihre Teilnahme an dieses Gerät gebunden. Mit bestätigter Adresse können Sie sich jederzeit auf einem anderen Gerät anmelden. Die Kursleitung sieht Ihre Adresse, andere nur gekürzt.</p>' +
      '<form id="mailForm" class="stack"><label class="field"><span>E-Mail-Adresse</span><input class="input" type="email" name="email" required autocomplete="email" value="' + A.esc(a.kurs.emailPending || '') + '"></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Später</button><button class="btn primary grow">Bestätigungsmail senden</button></div></form>', (el) => {
      el.querySelector('#mailForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const email = String(new FormData(e.target).get('email')).trim().toLowerCase();
        try { await mailSenden(a, email); A.closeSheet(); A.render(); } catch (er) { A.toast(fehlerText(er)); }
      });
    });
  }
  function codeEingeben(a) {
    codeSchritt('E-Mail bestätigen', a.kurs.emailPending, (code) => mailBestaetigen(a, code), () => mailSenden(a, a.kurs.emailPending), '48 Stunden');
  }


  /** Etikett gescannt: leer → erfassen, erfasst → beurteilen. */
  async function scan(a, pid) {
    const A = app();
    try {
      const s = await api(a.kurs.id + '/proben/' + pid + '/status', { headers: H(a) });
      await laden(a).catch(() => {});
      if (s.status === 'leer') { A.go('#/a/' + a.id); setTimeout(() => erfassen(a, pid, null, s.nr), 80); return; }
      const kp = (cache.get(a.id) || { proben: [] }).proben.find((x) => x.id === pid);
      if (kp && kp.eigene && !kp.meineAbgabe) { A.go('#/a/' + a.id); setTimeout(() => eigeneProbeDialog(a, kp), 80); return; }
      probeOeffnen(a, pid);
    } catch (e) { A.toast(e.status === 404 ? 'Diese Probe gehört nicht zu diesem Kurs.' : fehlerText(e)); A.go('#/a/' + a.id); }
  }
  function eigeneProbeDialog(a, kp) {
    const A = app();
    A.sheet('<h2>Nr. ' + kp.nr + ' – ' + A.esc(kp.bez || 'Ihre Probe') + '</h2><p class="small" style="margin-top:0">Diese Probe haben Sie erfasst.</p><div class="stack">' +
      '<button class="btn primary block" data-act="kurs-probe" data-id="' + a.id + '" data-kp="' + A.esc(kp.id) + '">Selbst beurteilen</button>' +
      '<button class="btn block" data-act="kurs-erfassen" data-id="' + a.id + '" data-kp="' + A.esc(kp.id) + '">Angaben bearbeiten</button>' +
      '<button class="btn ghost block" data-close>Schliessen</button></div>');
  }

  // ---------- Ersterfassung einer Probe ----------
  function erfassen(a, pid, kp, nr, opts) {
    const A = app(); const esc = A.esc; const K3 = global.K3;
    const istNeu = (opts && opts.neu) || !kp;
    const d = kp ? JSON.parse(JSON.stringify(kp)) : { typ: null, fotos: [], standort: {}, labor: null };
    d.fotos = (d.fotos || []).map((f) => Object.assign({}, f)); d.standort = d.standort || {}; d.labor = d.labor || {};
    const titel = 'Nr. ' + (kp && kp.nr ? kp.nr : (nr || 'neu')) + ' erfassen';
    const fotosHtml = () => '<div class="fotos">' + d.fotos.map((f) => '<div class="foto-thumb"><img alt="" data-kfoto="' + esc(f.id) + '" data-kprobe="' + esc(pid) + '" data-kanlass="' + a.id + '"><span class="foto-art">' + (f.art === 'labor' ? 'Labor' : 'Futter') + '</span></div>').join('') +
      '<button type="button" class="foto-add" data-ef-foto="futter">' + A.I.plus + '<span>Futter</span></button><button type="button" class="foto-add" data-ef-foto="labor">' + A.I.plus + '<span>Laborbericht</span></button></div>';
    const lw = (k, l, u) => '<label class="field"><span>' + l + ' <span class="muted">' + u + '</span></span><input class="input" name="lab_' + k + '" inputmode="decimal" value="' + esc(d.labor[k] != null ? String(d.labor[k]).replace('.', ',') : '') + '"></label>';
    const lbl = (t) => '<span style="display:block;font-size:.86rem;font-weight:650;color:var(--ink-2);margin-bottom:6px">' + t + '</span>';
    A.sheet('<h2>' + titel + '</h2><p class="small" style="margin-top:0">Angaben zu Ihrer Probe. Die Kursleitung bestimmt, was andere davon als Hilfestellung sehen. Alles wird Ende-zu-Ende verschlüsselt.</p>' +
      '<form id="efForm" class="stack"><div>' + lbl('Futterart *') + '<div class="opts cols-wide">' +
      Object.values(K3.TYPEN).map((t) => '<label class="opt"><input type="radio" name="typ" value="' + t.id + '"' + (d.typ === t.id ? ' checked' : '') + (kp && kp.abgaben ? ' disabled' : '') + ' required style="accent-color:var(--brand)"><span class="body"><b>' + t.titel + '</b><small>' + t.merkblatt + '</small></span></label>').join('') + '</div></div>' +
      '<label class="field"><span>Bezeichnung</span><input class="input" name="bez" maxlength="120" value="' + esc(d.bez || '') + '" placeholder="z. B. Rundballen 1. Schnitt"></label>' +
      '<label class="field"><span>Schnittdatum (für «Alter in Wochen»)</span><input class="input" type="date" name="schnitt" value="' + esc(d.schnitt || '') + '"></label>' +
      '<div class="grid2"><label class="field"><span>PLZ</span><input class="input" name="plz" inputmode="numeric" maxlength="6" value="' + esc(d.standort.plz || '') + '"></label><label class="field"><span>Ort</span><input class="input" name="ortname" maxlength="80" value="' + esc(d.standort.ort || '') + '"></label></div>' +
      '<div class="grid2"><label class="field"><span>Höhe (m ü. M.)</span><input class="input" name="hoehe" inputmode="numeric" maxlength="5" value="' + esc(d.standort.hoehe || '') + '"></label><div>' + lbl('Position') + '<button type="button" class="btn block" id="efGeo">' + (d.standort.lat ? 'Position gespeichert ✓' : 'Ungefähre Position') + '</button></div></div>' +
      '<p class="hint" style="margin-top:-4px">Die Position wird auf ca. 1 km gerundet.</p>' +
      '<div>' + lbl('Fotos') + '<div id="efFotos">' + fotosHtml() + '</div><p class="hint">Laborbericht: Adresse vor dem Fotografieren abdecken – danach können Sie zusätzlich schwärzen.</p></div>' +
      '<details' + (Object.keys(d.labor).length ? ' open' : '') + '><summary style="font-weight:650;cursor:pointer">Laborwerte (falls vorhanden)</summary><button type="button" class="btn sm block" id="efOcr" style="margin-top:8px">Aus Laborbericht lesen (PDF/Foto)</button><div class="grid2" style="margin-top:8px">' +
      lw('ts', 'TS', '%') + lw('nel', 'NEL', 'MJ/kg TS') + lw('apde', 'APDE', 'g/kg TS') + lw('apdn', 'APDN', 'g/kg TS') + lw('rp', 'Rohprotein', 'g/kg TS') + lw('ph', 'pH', '') + '</div></details>' +
      '<label class="field"><span>Notiz</span><textarea class="input" name="notiz" maxlength="1000" placeholder="Lagerung, Besonderheiten …">' + esc(d.notiz || '') + '</textarea></label>' +
      '<p class="hint" id="efMsg"></p><div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Speichern</button></div></form>', (el) => {
      nachRender();
      el.querySelector('#efOcr').addEventListener('click', async () => {
        const vorher = Object.fromEntries(new FormData(el.querySelector('#efForm')));
        const fotos = [];
        for (const f of d.fotos.filter((x) => x.art === 'labor')) { const b = await F().blob(f.id).catch(() => null); if (b) fotos.push({ id: f.id, blob: b }); }
        const r = await global.LaborOCR.dialog({ fotos });
        // Dialog ersetzt das Formular: mit gemerkten Eingaben und erkannten Laborwerten neu öffnen
        Object.assign(d, { typ: vorher.typ || d.typ, bez: vorher.bez, schnitt: vorher.schnitt, notiz: vorher.notiz });
        d.standort = Object.assign({}, d.standort, { plz: vorher.plz, ort: vorher.ortname, hoehe: vorher.hoehe });
        if (r) Object.keys(r.werte).forEach((k) => { if (['ts', 'nel', 'apde', 'apdn', 'rp', 'ph'].includes(k)) d.labor[k] = r.werte[k]; });
        erfassen(a, pid, Object.assign({}, kp || {}, d, { nr: kp ? kp.nr : nr, abgaben: kp ? kp.abgaben : 0 }), nr, { neu: istNeu });
      });
      el.querySelector('#efGeo').addEventListener('click', () => {
        if (!navigator.geolocation) return A.toast('Position nicht verfügbar.');
        navigator.geolocation.getCurrentPosition((pos) => {
          d.standort.lat = Math.round(pos.coords.latitude * 100) / 100; d.standort.lon = Math.round(pos.coords.longitude * 100) / 100;
          if (pos.coords.altitude && !el.querySelector('[name=hoehe]').value) el.querySelector('[name=hoehe]').value = Math.round(pos.coords.altitude);
          el.querySelector('#efGeo').textContent = 'Position gespeichert ✓';
        }, () => A.toast('Position konnte nicht bestimmt werden.'), { enableHighAccuracy: false, timeout: 10000 });
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ef-foto]'); if (!b) return;
        const art = b.dataset.efFoto;
        if (d.fotos.length >= 8) { A.toast('Maximal 8 Fotos.'); return; }
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'kursFotoInput'; inp.hidden = true;
        el.appendChild(inp);
        inp.onchange = async () => {
          const file = inp.files[0]; inp.remove(); if (!file) return;
          try {
            let c = await F().vorbereiten(file, art);
            let ger;
            if (art === 'labor') { const r = await F().laborSchwaerzen(c, A.toast); if (!r) return; c = r.canvas; ger = r.ger; }
            const meta = await F().speichern(c, art, pid); meta.up = false; if (ger) meta.ger = ger;
            d.fotos.push(meta); el.querySelector('#efFotos').innerHTML = fotosHtml(); nachRender();
          } catch (er) { A.toast(er.message); }
        };
        inp.click();
      });
      el.querySelector('#efForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target); const btn = e.target.querySelector('.primary'); btn.disabled = true;
        const msg = el.querySelector('#efMsg');
        const typ = fd.get('typ') || d.typ;
        const zahl = (k) => { const v = String(fd.get('lab_' + k) || '').replace(',', '.').trim(); const n = Number(v); return v && isFinite(n) ? n : undefined; };
        const labor = {}; ['ts', 'nel', 'apde', 'apdn', 'rp', 'ph'].forEach((k) => { const n = zahl(k); if (n != null) labor[k] = n; });
        const privat = { bez: String(fd.get('bez') || '').trim(), schnitt: fd.get('schnitt') || undefined, notiz: String(fd.get('notiz') || '').trim() || undefined,
          standort: { plz: String(fd.get('plz') || '').trim() || undefined, ort: String(fd.get('ortname') || '').trim() || undefined, hoehe: String(fd.get('hoehe') || '').trim() || undefined, lat: d.standort.lat, lon: d.standort.lon } };
        try {
          const k = await kk(a.kurs.secret);
          for (const f of d.fotos.filter((x) => x.up === false)) {
            msg.textContent = 'Lade Foto hoch …';
            const b = await F().blob(f.id);
            const r = await fetch('api/kurse/' + a.kurs.id + '/fotos/' + f.id + '?probe=' + encodeURIComponent(pid) + '&art=' + f.art, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, H(a)), body: await F().verschluesseln(f, b), credentials: 'omit' });
            if (!r.ok) { let j = {}; try { j = await r.json(); } catch (er) { /* leer */ } throw new Error(j.error || 'Foto-Upload ' + r.status); }
            f.up = true;
          }
          privat.fotos = d.fotos.map((f) => { const c = Object.assign({}, f); delete c.up; return c; });
          await api(a.kurs.id + '/proben/' + pid, { method: 'PUT', headers: H(a), body: { analyse: { typ },
            privat: await C.encryptJSON(k.key, privat, C.kursAad(a.kurs.id, 'probe|' + pid)),
            labor: Object.keys(labor).length ? await C.encryptJSON(k.key, labor, C.kursAad(a.kurs.id, 'labor|' + pid)) : null } });
          await laden(a); A.closeSheet(); A.refreshChrome();
          const neu = (cache.get(a.id) || { proben: [] }).proben.find((x) => x.id === pid);
          A.toast('Probe gespeichert.');
          if (istNeu && neu) eigeneProbeDialog(a, neu);
        } catch (er) { btn.disabled = false; msg.textContent = fehlerText(er); }
      });
    });
  }

  // ---------- Hilfestellung beim Beurteilen ----------
  const alterWochen = (datum) => { const t = Date.parse(datum); return isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / (7 * 864e5))) : null; };
  function hinweisKarte(p) {
    const A = app(); const esc = A.esc;
    const a = p && p.anlassId && A.anlassById(p.anlassId);
    if (!a || !a.kurs || !p.kursProbeId) return '';
    const st = cache.get(a.id); const kp = st && st.proben.find((x) => x.id === p.kursProbeId);
    if (!kp) return '';
    const alle = a.kurs.rolle === 'leitung' || kp.eigene || p.abgegebenAt;
    const h = Object.assign({}, st.hinweise || {});
    const zeig = (k) => alle || h[k];
    const zeilen = [];
    if (zeig('bezeichnung') && kp.bez) zeilen.push(['Bezeichnung', esc(kp.bez)]);
    if (zeig('alter') && kp.schnitt) zeilen.push(['Alter', alterWochen(kp.schnitt) + ' Wochen seit dem Schnitt']);
    if (zeig('standort') && kp.standort && (kp.standort.plz || kp.standort.ort || kp.standort.hoehe)) zeilen.push(['Standort', esc([[kp.standort.plz, kp.standort.ort].filter(Boolean).join(' '), kp.standort.hoehe ? kp.standort.hoehe + ' m ü. M.' : ''].filter(Boolean).join(', '))]);
    if (zeig('notiz') && kp.notiz) zeilen.push(['Notiz', esc(kp.notiz)]);
    if (kp.labor && Object.keys(kp.labor).length) zeilen.push(['Labor', esc(Object.entries(kp.labor).map(([k, v]) => ({ ts: 'TS ' + v + ' %', nel: 'NEL ' + v + ' MJ', apde: 'APDE ' + v + ' g', apdn: 'APDN ' + v + ' g', rp: 'RP ' + v + ' g', ph: 'pH ' + v })[k]).join(' · '))]);
    // Laborberichte anderer nur, wenn nachweislich geschwärzt (Kursleitung und Erfassende sehen alles)
    const fotos = (kp.fotos || []).filter((f) => (f.art === 'futter' && zeig('foto')) || (f.art === 'labor' && (alle || h.labor) && (a.kurs.rolle === 'leitung' || kp.eigene || f.ger)));
    if (!zeilen.length && !fotos.length) return '';
    return '<details class="card hinweis" open style="margin-bottom:14px"><summary style="font-weight:750;cursor:pointer">Hilfestellung zur Probe Nr. ' + kp.nr + '</summary>' +
      (fotos.length ? '<div class="fotos" style="margin:10px 0">' + fotos.map((f) => '<button type="button" class="foto-thumb" data-act="kurs-foto" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '" data-foto="' + esc(f.id) + '"><img alt="" data-kfoto="' + esc(f.id) + '" data-kprobe="' + esc(kp.id) + '" data-kanlass="' + a.id + '"><span class="foto-art">' + (f.art === 'labor' ? 'Labor' : 'Futter') + '</span></button>').join('') + '</div>' : '') +
      zeilen.map(([k, v]) => '<div class="rating"><span class="small muted" style="font-weight:700">' + k + '</span><span>' + v + '</span></div>').join('') + '</details>';
  }

  /** Lädt Kursfotos (verschlüsselt) und setzt Vorschaubilder ein. */
  async function kursFotoUrl(aid, kpId, fid, gross) {
    const A = app(); const a = A.anlassById(aid);
    if (!gross && kfotoUrls.has(fid)) return kfotoUrls.get(fid);
    let url = gross ? await F().bildUrl(fid) : await F().thumbUrl(fid);
    if (!url && a && a.kurs) {
      const st = cache.get(a.id); const kp = st && st.proben.find((x) => x.id === kpId);
      let meta = kp && (kp.fotos || []).find((f) => f.id === fid);
      if (!meta) { // Foto aus einer abgegebenen Beurteilung
        const v = vergleichCache.get(kpId);
        meta = v && v.liste.map((x) => (x.probe.fotos || []).find((f) => f.id === fid)).find(Boolean);
      }
      if (!meta) return null;
      const r = await fetch('api/kurse/' + a.kurs.id + '/fotos/' + fid, { headers: H(a), cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return null;
      await F().ablegen(fid, kpId, await F().entschluesseln(meta, await r.arrayBuffer()));
      url = gross ? await F().bildUrl(fid) : await F().thumbUrl(fid);
    }
    if (url && !gross) kfotoUrls.set(fid, url);
    return url;
  }
  async function nachRender() {
    for (const img of document.querySelectorAll('img[data-kfoto]')) {
      if (img.getAttribute('src')) continue;
      try { const u = await kursFotoUrl(img.dataset.kanlass, img.dataset.kprobe, img.dataset.kfoto); if (u) img.src = u; } catch (e) { /* ohne Vorschau */ }
    }
  }

  // ---------- Kursleitung: Hilfestellungen, Etiketten ----------
  function hinweiseDialog(a) {
    const A = app(); const st = cache.get(a.id) || {}; const h = Object.assign({}, st.hinweise || {});
    const opt = (k, t, s) => '<label class="toggle"><input type="checkbox" name="' + k + '"' + (h[k] ? ' checked' : '') + '> <span><b>' + t + '</b><br><span class="small muted">' + s + '</span></span></label>';
    A.sheet('<h2>Hilfestellungen beim Beurteilen</h2><p class="small" style="margin-top:0">Welche Angaben aus der Ersterfassung sehen die Teilnehmenden, <b>bevor</b> sie ihre Beurteilung abgeben? Nach der Abgabe sehen alle alles.</p>' +
      '<form id="hwForm" class="stack">' + opt('foto', 'Foto des Futters', 'Hilft bei Farbe und Struktur') + opt('alter', 'Alter in Wochen', 'Seit dem Schnitt – hilft beim Stadium von Folgeaufwüchsen') +
      opt('standort', 'Standort', 'PLZ, Ort, Höhe') + opt('bezeichnung', 'Bezeichnung', 'Name der Probe') + opt('notiz', 'Notiz der erfassenden Person', 'Lagerung, Besonderheiten') +
      opt('labor', 'Laboranalyse', 'Werte und Laborbericht – verrät das Ergebnis, daher normalerweise aus. Wird vom Server erst freigegeben, wenn eingeschaltet.') +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Speichern</button></div></form>', (el) => {
      el.querySelector('#hwForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        const neu = {}; ['foto', 'alter', 'standort', 'bezeichnung', 'notiz', 'labor'].forEach((k) => { neu[k] = fd.get(k) === 'on'; });
        try { await metaSpeichern(a, neu); await laden(a); A.closeSheet(); A.toast('Hilfestellungen gespeichert.'); } catch (er) { A.toast(fehlerText(er)); }
      });
    });
  }

  const FORMATE = {
    rund50: { titel: 'Rund Ø 50 mm, 20 pro Bogen (z. B. ENDI-Haft GA00050-20)', w: 50, h: 50, rund: true, cols: 4, rows: 5, oben: 13.5, links: 3, dx: 52, dy: 55 },
    l7160: { titel: 'Rechteckig 63,5 × 38,1 mm, 21 pro Bogen (z. B. Avery L7160)', w: 63.5, h: 38.1, rund: false, cols: 3, rows: 7, oben: 15.15, links: 7.25, dx: 66.04, dy: 38.1 },
  };
  function etikettenDialog(a) {
    const A = app(); const st = cache.get(a.id) || { proben: [] };
    const leer = st.proben.filter((p) => p.status === 'leer').length;
    let fmtId = 'rund50';
    try { fmtId = localStorage.getItem('agffV2EtikettFormat') || 'rund50'; } catch (e) { /* egal */ }
    if (!FORMATE[fmtId]) fmtId = 'rund50';
    // Angepasste Ränder je Format auf diesem Gerät merken (Drucker verschieben oft um 1–2 mm)
    const RAND = 'agffV2EtikettRand';
    const eigene = () => { try { return JSON.parse(localStorage.getItem(RAND) || '{}')[fmtId] || {}; } catch (e) { return {}; } };
    const f = () => Object.assign({}, FORMATE[fmtId], eigene());
    A.sheet('<h2>QR-Etiketten drucken</h2><p class="small" style="margin-top:0">Jedes Etikett ist eine nummerierte, noch leere Probe dieses Kurses. Teilnehmende kleben es auf ihre Probe und scannen es: beim ersten Mal erfassen, danach beurteilen.</p>' +
      '<form id="etForm" class="stack"><label class="field"><span>Etikettenformat</span><select class="input" name="format">' + Object.entries(FORMATE).map(([id, x]) => '<option value="' + id + '"' + (id === fmtId ? ' selected' : '') + '>' + x.titel + '</option>').join('') + '</select></label>' +
      '<div class="grid2"><label class="field"><span>Anzahl Proben</span><input class="input" type="number" name="anzahl" min="1" max="100" value="10" inputmode="numeric"></label>' +
      '<label class="field"><span>Inhalt</span><select class="input" name="welche"><option value="neu">Neue leere Etiketten</option>' + (leer ? '<option value="leer">Vorhandene leere (' + leer + ') nochmals</option>' : '') + '<option value="erfasst">Bereits erfasste Proben</option>' + (st.proben.length ? '<option value="nr">Bestimmte Nummern nachdrucken</option>' : '') + '</select></label></div>' +
      '<div class="grid2" id="etNr" hidden><label class="field"><span>Nr. von</span><input class="input" type="number" name="von" min="1" value="1" inputmode="numeric"></label><label class="field"><span>Nr. bis</span><input class="input" type="number" name="bis" min="1" value="' + Math.max(1, ...st.proben.map((p) => p.nr)) + '" inputmode="numeric"></label></div>' +
      '<label class="field"><span>Exemplare pro Probe</span><select class="input" name="exemplare">' + [1, 2, 3, 4, 5, 6].map((n) => '<option value="' + n + '">' + n + (n === 1 ? ' Etikett' : ' Etiketten (z. B. für Probe, Beutel, Laborauftrag)') + '</option>').join('') + '</select></label>' +
      '<p class="small muted" id="etInfo" style="margin:-4px 0 0"></p>' +
      '<details><summary style="font-weight:650;cursor:pointer">Ränder anpassen (Testdruck auf Normalpapier)</summary><div class="grid2" style="margin-top:8px">' +
      ['oben', 'links', 'dx', 'dy'].map((k) => '<label class="field"><span>' + ({ oben: 'Rand oben', links: 'Rand links', dx: 'Spaltenabstand (Anfang–Anfang)', dy: 'Zeilenabstand (Anfang–Anfang)' })[k] + ' mm</span><input class="input" name="' + k + '" inputmode="decimal" value="' + f()[k] + '"></label>').join('') +
      '</div><label class="toggle" style="margin-top:8px"><input type="checkbox" name="linien"> Hilfslinien drucken (für Normalpapier)</label></details>' +
      '<p class="hint">Im Druckdialog «Tatsächliche Grösse» bzw. 100 % wählen (nicht «an Seite anpassen»).</p>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">PDF erstellen</button></div></form>', (el) => {
      const auswahl = (welche) => {
        if (welche === 'nr') {
          const von = parseInt(el.querySelector('[name=von]').value, 10) || 1; const bis = parseInt(el.querySelector('[name=bis]').value, 10) || von;
          return st.proben.filter((p) => p.nr >= Math.min(von, bis) && p.nr <= Math.max(von, bis));
        }
        return st.proben.filter((p) => p.status === (welche === 'leer' ? 'leer' : 'erfasst'));
      };
      const info = () => {
        const welche = el.querySelector('[name=welche]').value; const feld = el.querySelector('[name=anzahl]');
        feld.disabled = welche !== 'neu'; el.querySelector('#etNr').hidden = welche !== 'nr';
        const n = welche === 'neu' ? Math.max(1, Math.min(100, parseInt(feld.value, 10) || 1)) : auswahl(welche).length;
        const ex = parseInt(el.querySelector('[name=exemplare]').value, 10) || 1; const pro = f().cols * f().rows;
        const b = Math.ceil(n * ex / pro);
        el.querySelector('#etInfo').textContent = n + ' Probe' + (n === 1 ? '' : 'n') + (ex > 1 ? ' × ' + ex + ' Exemplare (direkt nacheinander)' : '') + ' = ' + n * ex + ' Etiketten auf ' + b + ' Bogen' + (b === 1 ? '' : 'en') + ' à ' + pro + '.';
      };
      el.querySelector('[name=format]').addEventListener('change', (e) => {
        fmtId = e.target.value; try { localStorage.setItem('agffV2EtikettFormat', fmtId); } catch (er) { /* egal */ }
        ['oben', 'links', 'dx', 'dy'].forEach((k) => { el.querySelector('[name=' + k + ']').value = f()[k]; });
        info();
      });
      el.querySelector('[name=von]').addEventListener('change', () => {
        const von = el.querySelector('[name=von]'); const bis = el.querySelector('[name=bis]');
        if ((parseInt(bis.value, 10) || 0) < (parseInt(von.value, 10) || 1)) bis.value = von.value;
        info();
      });
      ['anzahl', 'welche', 'exemplare', 'von', 'bis'].forEach((k) => { el.querySelector('[name=' + k + ']').addEventListener('input', info); el.querySelector('[name=' + k + ']').addEventListener('change', info); });
      info();
      el.querySelector('#etForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target); const btn = e.target.querySelector('.primary'); btn.disabled = true;
        const num = (k) => Number(String(fd.get(k)).replace(',', '.'));
        const layout = Object.assign({}, f(), { oben: num('oben'), links: num('links'), dx: num('dx'), dy: num('dy'), linien: fd.get('linien') === 'on' });
        try {
          const alle = JSON.parse(localStorage.getItem(RAND) || '{}'); const std = FORMATE[fmtId]; const mein = {};
          ['oben', 'links', 'dx', 'dy'].forEach((k) => { if (isFinite(layout[k]) && layout[k] !== std[k]) mein[k] = layout[k]; });
          if (Object.keys(mein).length) alle[fmtId] = mein; else delete alle[fmtId];
          localStorage.setItem(RAND, JSON.stringify(alle));
        } catch (er) { /* egal */ }
        const anzahl = Math.max(1, Math.min(100, parseInt(fd.get('anzahl'), 10) || 1));
        const ex = Math.max(1, Math.min(6, parseInt(fd.get('exemplare'), 10) || 1));
        try {
          let liste;
          const welche = fd.get('welche');
          if (welche === 'neu') liste = (await api(a.kurs.id + '/etiketten', { method: 'POST', headers: H(a), body: { anzahl } })).proben;
          else { await laden(a); st.proben = cache.get(a.id).proben; liste = auswahl(welche).sort((x, y) => x.nr - y.nr).map((p) => ({ id: p.id, nr: p.nr, bez: p.bez })); }
          if (!liste.length) { A.toast('Keine Etiketten für diese Auswahl.'); btn.disabled = false; return; }
          const proben = liste.length;
          liste = liste.flatMap((p) => Array(ex).fill(p)); // Exemplare einer Probe nebeneinander
          const blob = await etikettenPdf(a, liste, layout);
          const url = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = url; l.download = 'Kurs-Etiketten_' + (a.titel || 'Kurs').replace(/[^\w-]+/g, '_').slice(0, 40) + '.pdf'; document.body.appendChild(l); l.click(); l.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          await laden(a).catch(() => {}); A.closeSheet(); A.toast(liste.length + ' Etiketten erstellt' + (ex > 1 ? ' (' + proben + ' Proben × ' + ex + ')' : '') + '.');
        } catch (er) { btn.disabled = false; A.toast(fehlerText(er)); }
      });
    });
  }

  async function etikettenPdf(a, liste, L) {
    const IO = global.FutterIO;
    await IO.loadScript('assets/vendor/jspdf.umd.min.js'); await IO.loadScript('assets/vendor/qrcode.js');
    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const base = IO.appUrl() + '#k=' + a.kurs.id + '.' + a.kurs.secret + '.';
    const titel = IO.pdfText(a.titel || 'Kurs');
    const pro = L.cols * L.rows;
    const qrZeichnen = (text, x, y, size) => {
      const qr = global.qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
      const n = qr.getModuleCount(); const m = size / n;
      doc.setFillColor(0, 0, 0);
      for (let r = 0; r < n; r++) { let c = 0; while (c < n) { if (qr.isDark(r, c)) { let e = c; while (e + 1 < n && qr.isDark(r, e + 1)) e++; doc.rect(x + c * m, y + r * m, (e - c + 1) * m + 0.01, m + 0.01, 'F'); c = e + 1; } else c++; } }
    };
    liste.forEach((p, i) => {
      if (i > 0 && i % pro === 0) doc.addPage();
      const j = i % pro; const col = j % L.cols; const row = Math.floor(j / L.cols);
      const x = L.links + col * L.dx; const y = L.oben + row * L.dy;
      if (L.linien) { doc.setDrawColor(190); doc.setLineWidth(0.2); if (L.rund) doc.circle(x + L.w / 2, y + L.h / 2, L.w / 2, 'S'); else doc.roundedRect(x, y, L.w, L.h, 2.5, 2.5, 'S'); }
      doc.setTextColor(20);
      if (L.rund) {
        const cx = x + L.w / 2; const q = 25;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Nr. ' + p.nr, cx, y + 9.2, { align: 'center' });
        qrZeichnen(base + p.id, cx - q / 2, y + 11, q);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.6); doc.setTextColor(70);
        doc.text(titel.slice(0, 30), cx, y + 39.6, { align: 'center' });
        doc.text('Scannen: erfassen / beurteilen', cx, y + 42.4, { align: 'center' });
      } else {
        const q = 31;
        qrZeichnen(base + p.id, x + 3, y + (L.h - q) / 2, q);
        const tx = x + q + 6; const tw = L.w - q - 8;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('Nr. ' + p.nr, tx, y + 11);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(60);
        doc.text(doc.splitTextToSize(titel, tw).slice(0, 3), tx, y + 16.5);
        if (p.bez) { doc.setTextColor(20); doc.text(doc.splitTextToSize(IO.pdfText(p.bez), tw).slice(0, 2), tx, y + 26); }
        doc.setFontSize(5.4); doc.setTextColor(110); doc.text('Scannen: erfassen / beurteilen', tx, y + L.h - 3.5);
      }
    });
    doc.setProperties({ title: 'QR-Etiketten ' + titel, creator: 'AGFF Futterbeurteilung v2' });
    return doc.output('blob');
  }

  // ---------- Darstellung in der Liste ----------
  function renderList(a, route) {
    const A = app(); const esc = A.esc; const st = cache.get(a.id);
    frisch(a);
    const leitung = a.kurs.rolle === 'leitung';
    const activeId = route.name === 'probe' ? (A.probeById(route.id) || {}).kursProbeId : null;
    const lokale = A.db.proben.filter((p) => p.anlassId === a.id && p.kursProbeId);
    const ich = st && st.teilnehmende.find((t) => t.id === a.kurs.ichId);
    let h = '<div class="bar"><a class="icon-btn back-btn hide-wide" href="#/" aria-label="Zurück">' + A.I.back + '</a><h2>' + esc(a.titel) +
      '<span class="sub">Kurs · ' + (leitung ? 'Kursleitung' : 'Teilnahme') + (st ? ' · ' + st.teilnehmende.length + ' Personen' : '') + '</span></h2>' +
      '<button class="icon-btn" data-act="kurs-menu" data-id="' + a.id + '" aria-label="Kurs-Aktionen">' + A.I.more + '</button></div>';
    if (a.kurs.error) h += '<div class="pad" style="padding-bottom:0"><div class="alert info">' + A.I.warn + '<div>' + esc(a.kurs.error) + (a.kurs.error.startsWith('Anmeldung') ? ' <button class="btn sm" data-act="kurs-login" data-id="' + a.id + '">Neu anmelden</button>' : '') + '</div></div></div>';
    if (st && ich && !ich.mitEmail && !leitung) {
      h += '<div class="pad" style="padding-bottom:0"><div class="alert info">' + A.I.lock + '<div style="flex:1">' + (a.kurs.emailPending
        ? 'Bitte bestätigen Sie Ihre E-Mail: Wir haben einen Link an <b>' + A.esc(a.kurs.emailPending) + '</b> geschickt – in der Mail antippen (auch Spam-Ordner prüfen). Sie können inzwischen normal weiterarbeiten.<div class="row" style="margin-top:8px;gap:6px"><button class="btn sm" data-act="kurs-code" data-id="' + a.id + '">Code eingeben</button><button class="btn sm" data-act="kurs-mail-neu" data-id="' + a.id + '">Nochmals senden</button><button class="btn sm ghost" data-act="kurs-email" data-id="' + a.id + '">Adresse ändern</button></div>'
        : 'Ihre Teilnahme ist an dieses Gerät gebunden. <b>Mit E-Mail bestätigen</b>, um Ihre Proben später wiederzufinden. <button class="btn sm" data-act="kurs-email" data-id="' + a.id + '">E-Mail angeben</button>') + '</div></div></div>';
    }
    h += '<div class="pad" style="padding-bottom:0"><div class="row"><button class="btn sm grow" data-act="kurs-teilnehmende" data-id="' + a.id + '">Teilnehmende</button>' +
      (leitung ? '<button class="btn sm grow" data-go="#/a/' + a.id + '/sammel">Sammelerfassung</button><button class="btn sm grow" data-act="kurs-etiketten" data-id="' + a.id + '">QR-Etiketten</button><button class="btn sm grow" data-act="kurs-hinweise" data-id="' + a.id + '">Hilfestellungen</button><button class="btn sm grow" data-act="kurs-pool" data-id="' + a.id + '">Probenpool</button>' : '') +
      '<a class="btn sm grow" href="#/a/' + a.id + '/uebersicht">' + A.I.table + ' Übersicht</a></div></div>';
    h += '<div class="section-title" style="padding:0 12px">Proben</div><ul class="list" style="padding:0 8px 8px">';
    if (!st) h += '<li class="empty small">Lade Kurs …</li>';
    else {
      const erfasst = st.proben.filter((p) => p.status === 'erfasst');
      const leer = st.proben.length - erfasst.length;
      if (!erfasst.length) h += '<li class="empty small">' + (leitung ? 'Noch keine erfassten Proben. Drucken Sie QR-Etiketten und verteilen Sie sie – oder erfassen Sie selbst eine Probe.' : 'Noch keine Proben erfasst. Scannen Sie das Etikett auf Ihrer Probe, um sie zu erfassen.') + '</li>';
      erfasst.forEach((kp) => {
        const lp = lokale.find((p) => p.kursProbeId === kp.id);
        const abg = !!(kp.meineAbgabe || (lp && lp.abgegebenAt));
        const status = abg ? '<span class="chip gut">abgegeben ✓</span>' : lp ? '<span class="chip mittel">in Arbeit</span>' : kp.eigene ? '<span class="chip">von mir erfasst</span>' : '<span class="chip">offen</span>';
        h += '<li><a class="item typ-' + kp.typ + '" href="#" data-act="kurs-probe" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '" aria-current="' + (activeId === kp.id) + '"><span class="avatar typ-avatar">' + kp.nr + '</span>' +
          '<span style="min-width:0"><span class="t">' + esc(kp.bez || ('Probe Nr. ' + kp.nr)) + '</span><span class="s">' + (global.K3.TYPEN[kp.typ] ? A.typBadge(kp.typ) + ' ' : '') + esc(global.K3.TYPEN[kp.typ] ? global.K3.TYPEN[kp.typ].titel : '') + (kp.eigene ? ' · von mir erfasst' : '') + '</span></span>' +
          '<span class="meta">' + status + '<br><span class="small muted">' + kp.abgaben + ' Abgabe' + (kp.abgaben === 1 ? '' : 'n') + '</span></span></a>' +
          ((leitung || kp.eigene) ? '<span class="row" style="margin:0 0 6px 60px;gap:6px">' + (kp.poolId ? '<span class="chip">aus Pool</span>' : '<button class="btn sm ghost" data-act="kurs-erfassen" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '">Angaben bearbeiten</button>') +
            (leitung && !kp.poolId ? '<button class="btn sm ghost" data-act="kurs-in-pool" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '">In Pool stellen</button>' : '') + '</span>' : '') + '</li>';
      });
      if (leitung && leer) h += '<li class="small muted" style="padding:8px 12px">' + leer + ' leere Etiketten noch nicht erfasst.</li>';
    }
    h += '</ul>';
    if (leitung) h += '<div class="fab-wrap"><button class="btn primary fab" data-act="kurs-erfassen" data-id="' + a.id + '">' + A.I.plus + ' Probe erfassen</button></div>';
    return h;
  }

  function renderUebersicht(a) {
    const A = app(); const esc = A.esc; const st = cache.get(a.id);
    frisch(a);
    const leitung = a.kurs.rolle === 'leitung';
    let h = '<div class="bar"><a class="icon-btn back-btn hide-tablet" href="#/a/' + a.id + '" aria-label="Zurück">' + A.I.back + '</a><h2>Kursübersicht<span class="sub">' + esc(a.titel) + '</span></h2>' +
      (leitung ? '<button class="btn sm" data-act="kurs-qr-gross" data-id="' + a.id + '">QR für Beamer</button>' : '') + '</div><div class="pad">';
    if (!st) return h + '<div class="empty">Lade Kurs …</div></div>';
    const n = st.teilnehmende.length;
    const erfasst = st.proben.filter((p) => p.status === 'erfasst');
    h += '<div class="kpis"><div class="kpi"><div class="l">Personen</div><div class="v">' + n + '</div></div><div class="kpi"><div class="l">Proben erfasst</div><div class="v">' + erfasst.length + (leitung ? '<small> / ' + st.proben.length + '</small>' : '') + '</div></div>' +
      '<div class="kpi"><div class="l">Abgaben</div><div class="v">' + erfasst.reduce((x, p) => x + p.abgaben, 0) + '</div></div>' +
      '<div class="kpi"><div class="l">Meine Abgaben</div><div class="v">' + erfasst.filter((p) => p.meineAbgabe).length + '<small> / ' + erfasst.length + '</small></div></div></div>';
    if (!erfasst.length) return h + '<div class="empty">' + (leitung ? 'Drucken Sie QR-Etiketten («QR-Etiketten») und verteilen Sie sie an die Teilnehmenden.' : 'Noch keine Proben erfasst.') + '</div></div>';
    h += '<div class="section-title">Fortschritt je Probe</div><div class="card"><div class="bars">' + erfasst.map((kp) => {
      const darf = leitung || kp.meineAbgabe; const pct = n ? Math.round((kp.abgaben / n) * 100) : 0;
      return '<div class="b" data-act="kurs-probe" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '"><span class="lbl">Nr. ' + kp.nr + ' ' + esc(kp.bez || '') + '</span><span class="track"><span class="val" style="width:' + pct + '%;background:var(--brand)"></span></span>' +
        '<span class="n">' + kp.abgaben + '/' + n + '</span></div><div class="small muted" style="margin:-4px 0 8px">' + esc(global.K3.TYPEN[kp.typ] ? global.K3.TYPEN[kp.typ].titel : '') + (kp.hatLabor ? ' · Laborwerte vorhanden' : '') +
        (darf && kp.abgaben ? ' · <a href="#" data-act="kurs-probe" data-id="' + a.id + '" data-kp="' + esc(kp.id) + '">Vergleich ansehen →</a>' : '') + '</div>';
    }).join('') + '</div></div><p class="hint">' + (leitung ? 'Als Kursleitung sehen Sie alle Abgaben jederzeit. ' : 'Den Vergleich mit den anderen sehen Sie je Probe nach Ihrer eigenen Abgabe. ') + 'Namen und Probenangaben sind Ende-zu-Ende verschlüsselt.</p></div>';
    return h;
  }

  /** Öffnet bzw. erzeugt die eigene Beurteilung einer Kursprobe. */
  function probeOeffnen(a, kpId) {
    const A = app(); const st = cache.get(a.id); const kp = st && st.proben.find((x) => x.id === kpId);
    if (!kp) return;
    if (kp.status !== 'erfasst') { erfassen(a, kp.id, null, kp.nr); return; }
    let p = A.db.proben.find((x) => x.anlassId === a.id && x.kursProbeId === kpId);
    if (!p) {
      p = { id: A.uid(), typ: kp.typ, anlassId: a.id, kursProbeId: kpId, createdAt: A.now(), updatedAt: A.now(), kopf: { bez: 'Nr. ' + kp.nr + (kp.bez ? ' – ' + kp.bez : ''), beurteiler: (st.teilnehmende.find((t) => t.id === a.kurs.ichId) || {}).name || '' }, antworten: {}, rad: {} };
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
      // Im Kurs wird alles gespeichert: auch Fotos und Laborimport der Beurteilung (verschlüsselt mit dem Kursschlüssel)
      for (const f of (privat.fotos || [])) {
        const b = await F().blob(f.id).catch(() => null);
        if (!b) continue;
        const r = await fetch('api/kurse/' + a.kurs.id + '/fotos/' + f.id + '?probe=' + encodeURIComponent(p.kursProbeId) + '&art=' + (f.art === 'labor' ? 'labor' : 'futter') + '&zu=beurteilung',
          { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, H(a)), body: await F().verschluesseln(f, b), credentials: 'omit' });
        if (!r.ok) { let j = {}; try { j = await r.json(); } catch (er) { /* leer */ } throw new Error(j.error || 'Foto-Upload ' + r.status); }
      }
      const box = Object.keys(privat).length ? await C.encryptJSON(k.key, privat, C.kursAad(a.kurs.id, 'beurteilung|' + p.kursProbeId + '|' + p.id)) : null;
      await api(a.kurs.id + '/proben/' + p.kursProbeId + '/beurteilung', { method: 'PUT', headers: H(a), body: { data: { analyse, privat: box } } });
      p.abgegebenAt = A.now(); A.save(); vergleichCache.delete(p.kursProbeId);
      await laden(a).catch(() => {});
      A.toast('Abgegeben – der Vergleich ist jetzt freigeschaltet.'); A.render();
    } catch (er) {
      if (er.message === 'BEREITS_ABGEGEBEN') { p.abgegebenAt = p.abgegebenAt || A.now(); A.save(); A.render(); return; }
      A.toast('Abgabe fehlgeschlagen: ' + fehlerText(er));
    }
  }

  async function vergleichLaden(a, kpId) {
    const k = await kk(a.kurs.secret);
    const r = await api(a.kurs.id + '/proben/' + kpId + '/beurteilungen', { headers: H(a) });
    await laden(a).catch(() => {}); // Laborwerte sind nach der Abgabe freigegeben
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
    (r.referenzen || []).forEach((ref, i) => {
      const probe = global.Model.cleanProbe(Object.assign({}, ref.analyse, { id: 'ref' + i + kpId.slice(0, 10) }));
      if (probe) out.push({ probe, name: ref.label + ' (Pool)', ich: false, referenz: true });
    });
    vergleichCache.set(kpId, { liste: out, zeit: Date.now() });
    app().rerenderDetail(true);
  }

  function ergebnisExtra(p) {
    const A = app(); const esc = A.esc; const a = A.anlassById(p.anlassId);
    if (!a || !a.kurs || !p.kursProbeId) return '';
    const leitung = a.kurs.rolle === 'leitung';
    if (!p.abgegebenAt && !leitung) {
      return '<div class="card" style="margin-top:16px;border-color:var(--brand)"><h3>Beurteilung abgeben</h3><p class="small muted" style="margin:4px 0 12px">Erst nach Ihrer Abgabe sehen Sie, wie die anderen diese Probe beurteilt haben – und die Laborwerte, falls vorhanden. Danach ist Ihre Beurteilung gesperrt.</p>' +
        '<button class="btn primary block" data-act="kurs-abgeben" data-id="' + p.id + '">Jetzt abgeben</button></div>';
    }
    const v = vergleichCache.get(p.kursProbeId);
    if (!v || Date.now() - v.zeit > 60000) { vergleichLaden(a, p.kursProbeId).catch((e) => A.toast(e.message === 'ERST_EIGENE_ABGEBEN' ? 'Vergleich erst nach eigener Abgabe.' : 'Vergleich nicht geladen: ' + e.message)); }
    let h = (!p.abgegebenAt && leitung ? '<div class="card" style="margin-top:16px"><div class="row"><span class="grow small">Als Kursleitung sehen Sie alle Abgaben. Eigene Abgabe optional:</span><button class="btn sm" data-act="kurs-abgeben" data-id="' + p.id + '">Abgeben</button></div></div>' : '') +
      '<div class="section-title">Vergleich im Kurs</div>';
    if (!v) return h + '<div class="card small muted">Lade Abgaben …</div>';
    const st = cache.get(a.id); const kp = st && st.proben.find((x) => x.id === p.kursProbeId);
    const rows = v.liste.map((x) => ({ x, res: A.auswertung(x.probe) })).sort((m, n) => (m.x.referenz ? -1 : 0) - (n.x.referenz ? -1 : 0) || ((n.res.werte || {}).nel || 0) - ((m.res.werte || {}).nel || 0));
    const nels = rows.filter((r) => !r.x.referenz).map((r) => r.res.werte && r.res.werte.nel).filter((n) => n != null);
    const mittel = nels.length ? nels.reduce((s, n) => s + n, 0) / nels.length : null;
    const meine = rows.find((r) => r.x.ich);
    const lab = kp && kp.labor;
    const diff = (x, ref) => (x - ref > 0 ? '+' : '') + A.fmt(x - ref, 2);
    h += '<div class="kpis"><div class="kpi"><div class="l">Abgaben</div><div class="v">' + rows.filter((r) => !r.x.referenz).length + '</div></div><div class="kpi"><div class="l">Ø NEL Schätzung</div><div class="v">' + A.fmt(mittel, 2) + ' <small>MJ</small></div></div>' +
      (lab && lab.nel != null ? '<div class="kpi"><div class="l">NEL Labor</div><div class="v">' + A.fmt(lab.nel, 2) + ' <small>MJ</small></div><div class="d muted">Ø Schätzung ' + (mittel != null ? diff(mittel, lab.nel) : '–') + '</div></div>'
        : '<div class="kpi"><div class="l">Spannweite</div><div class="v" style="font-size:1.2rem">' + (nels.length ? A.fmt(Math.min(...nels), 2) + '–' + A.fmt(Math.max(...nels), 2) : '–') + '</div></div>') +
      '<div class="kpi"><div class="l">Meine Abweichung</div><div class="v" style="font-size:1.2rem">' + (meine && meine.res.werte ? (lab && lab.nel != null ? diff(meine.res.werte.nel, lab.nel) + ' <small>zu Labor</small>' : mittel != null ? diff(meine.res.werte.nel, mittel) + ' <small>zu Ø</small>' : '–') : '–') + '</div></div></div>';
    h += '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Name</th><th>Beurteilung</th><th>Pkt./Korr.</th><th>NEL</th><th>APDE</th><th>Bestand/Stadium</th></tr></thead><tbody>' +
      (lab && (lab.nel != null || lab.apde != null) ? '<tr style="background:var(--surface-2)"><td><strong>Labor</strong></td><td>–</td><td>' + (lab.ph != null ? 'pH ' + A.fmt(lab.ph, 1) : '–') + '</td><td><strong>' + A.fmt(lab.nel, 2) + '</strong></td><td>' + A.fmt(lab.apde, 0) + '</td><td>' + (lab.ts != null ? 'TS ' + A.fmt(lab.ts, 0) + ' %' : '') + '</td></tr>' : '') +
      rows.map(({ x, res }) => '<tr' + (x.ich ? ' style="background:var(--brand-soft)"' : x.referenz ? ' style="background:var(--surface-2)"' : '') + '><td><strong>' + esc(x.name) + (x.ich ? ' (ich)' : '') + '</strong></td><td><span class="chip ' + A.tonOf(res) + '">' + esc(res.sperre.length ? 'Nicht verfüttern' : res.klasse ? res.klasse.label : '–') + '</span></td><td>' +
        (x.probe.typ === 'heu' ? (res.korr ? A.fmt(res.korr.nel, 0) + ' %' : '–') : (res.punkte != null ? res.punkte : '–')) + '</td><td><strong>' + A.fmt(res.werte && res.werte.nel, 2) + '</strong></td><td>' + A.fmt(res.werte && res.werte.apde, 0) + '</td><td>' + esc(A.bestandStadium(x.probe)) + '</td></tr>').join('') +
      '</tbody></table></div>';
    const typ = global.K3.TYPEN[p.typ];
    h += '<div class="section-title">Antworten im Beurteilungsrad</div><div class="card"><div class="stack">' + typ.rad.map((f) => {
      const zaehl = {}; rows.forEach(({ res }) => { const o = res.auswahl[f.id]; if (o) zaehl[o] = (zaehl[o] || 0) + 1; });
      const mein = meine && meine.res.auswahl[f.id];
      return '<div><div class="small" style="font-weight:700;margin-bottom:4px"><span class="dot" style="background:' + f.farbe + '"></span> ' + esc(f.gruppe.replace(/-/g, '') + (f.gruppe === 'Feldbedingungen' || f.gruppe === 'Sauberkeit' ? ' – ' + f.optionen[0].mitte : '')) + '</div><div class="row" style="gap:6px">' +
        f.optionen.filter((o) => zaehl[o.id]).map((o) => '<span class="chip' + (o.id === mein ? ' gut' : '') + '" title="' + esc(o.text) + '">' + esc(o.kurz === '!' ? '⚠' : o.kurz) + ' · ' + esc(o.text.split(/: | – |,/)[0].slice(0, 28)) + ' <b>×' + zaehl[o.id] + '</b></span>').join('') + '</div></div>';
    }).join('') + '</div><p class="hint">Grün = Ihre Antwort.</p></div>';
    h += '<div class="section-title">Räder aller Abgaben</div><div class="wheels">' + rows.map(({ x, res }) => '<div class="card" style="padding:8px;text-align:center' + (x.ich ? ';border-color:var(--brand)' : '') + '">' + A.wheelSvg(x.probe, res) + '<div class="small" style="font-weight:600">' + esc(x.name) + '</div></div>').join('') + '</div>';
    const sichtbar = (x) => (x.probe.fotos || []).filter((f) => f.art !== 'labor' || f.ger || x.ich || leitung);
    const mitFotos = rows.filter(({ x }) => !x.referenz && sichtbar(x).length);
    if (mitFotos.length) {
      h += '<div class="section-title">Fotos aus den Beurteilungen</div><div class="card"><div class="stack">' + mitFotos.map(({ x }) => '<div><div class="small" style="font-weight:700;margin-bottom:4px">' + esc(x.name) + (x.ich ? ' (ich)' : '') + '</div><div class="fotos">' +
        sichtbar(x).map((f) => '<button type="button" class="foto-thumb" data-act="kurs-foto" data-id="' + a.id + '" data-kp="' + esc(p.kursProbeId) + '" data-foto="' + esc(f.id) + '"><img alt="" data-kfoto="' + esc(f.id) + '" data-kprobe="' + esc(p.kursProbeId) + '" data-kanlass="' + a.id + '"><span class="foto-art">' + (f.art === 'labor' ? 'Labor' : 'Futter') + '</span></button>').join('') + '</div></div>').join('') + '</div></div>';
    }
    return h;
  }

  // ---------- Teilnehmende ----------
  function teilnehmendeDialog(a) {
    const A = app(); const st = cache.get(a.id) || { teilnehmende: [] };
    const leitung = a.kurs.rolle === 'leitung';
    const ich = st.teilnehmende.find((t) => t.id === a.kurs.ichId);
    A.sheet('<h2>Teilnehmende (' + st.teilnehmende.length + ')</h2><ul class="list">' + st.teilnehmende.map((t) =>
      '<li class="item" style="cursor:default"><span class="avatar">' + A.esc(t.name.slice(0, 2).toUpperCase()) + '</span><span style="min-width:0;flex:1"><span class="t">' + A.esc(t.name) + (t.id === a.kurs.ichId ? ' (ich)' : '') + '</span><span class="s">' +
      A.esc(t.email || 'ohne E-Mail') + (t.rolle === 'leitung' ? ' · Kursleitung' : '') + '</span></span>' +
      (leitung && t.rolle !== 'leitung' ? '<button class="btn sm danger" data-act="kurs-entfernen" data-id="' + a.id + '" data-tid="' + A.esc(t.id) + '">Entfernen</button>' : '') + '</li>').join('') + '</ul>' +
      '<div class="stack" style="margin-top:12px"><button class="btn block" data-act="kurs-name" data-id="' + a.id + '">Meinen Anzeigenamen ändern</button>' +
      (ich && !ich.mitEmail ? '<button class="btn block" data-act="kurs-email" data-id="' + a.id + '">E-Mail bestätigen (Proben später wiederfinden)</button>' : '') +
      (leitung ? '<button class="btn danger block" data-act="kurs-loeschen" data-id="' + a.id + '">Kurs für alle löschen</button>' : '<button class="btn danger block" data-act="kurs-austreten" data-id="' + a.id + '">Kurs verlassen & meine Daten löschen</button>') +
      '<button class="btn ghost block" data-close>Schliessen</button></div>');
  }

  // ---------- Probenpool (für Kursleitende) ----------
  const PH = (a) => ({ 'X-Kurs-Id': a.kurs.id, 'X-Kurs-Session': a.kurs.session || '' });
  const poolApi = (path, a, o) => global.FutterIO.api('pool' + path, Object.assign({}, o || {}, { headers: Object.assign({}, (o || {}).headers || {}, PH(a)) }));
  let poolCache = null;

  async function inPoolDialog(a, kp) {
    const A = app(); const esc = A.esc;
    let abgaben = [];
    try { abgaben = (await api(a.kurs.id + '/proben/' + kp.id + '/beurteilungen', { headers: H(a) })).beurteilungen; } catch (e) { abgaben = []; }
    const st = cache.get(a.id) || { teilnehmende: [] };
    const k = await kk(a.kurs.secret);
    const zeilen = [];
    for (const b of abgaben) {
      let privat = {};
      try { privat = b.privat ? await C.decryptJSON(k.key, b.privat, C.kursAad(a.kurs.id, 'beurteilung|' + kp.id + '|' + b.analyse.id)) : {}; } catch (e) { privat = {}; }
      const probe = global.Model.cleanProbe(global.Model.merge(b.analyse, privat)); if (!probe) continue;
      const t = st.teilnehmende.find((x) => x.id === b.teilnehmerId);
      zeilen.push({ probe, name: t ? t.name : '?', res: A.auswertung(probe), analyse: b.analyse });
    }
    const fotos = (kp.fotos || []).filter((f) => f.art !== 'labor' || f.ger); // ungeschwärzte Laborberichte nie in den Pool
    A.sheet('<h2>In den Probenpool stellen</h2><p class="small" style="margin-top:0">Andere freigeschaltete Kursleitende können diese Probe in eigene Kurse übernehmen. <b>Ohne Personennamen</b>: Beurteilungen werden als «Referenz» gespeichert. Pool-Einträge sind für alle Kursleitenden lesbar (nicht Ende-zu-Ende verschlüsselt).</p>' +
      '<form id="poolForm" class="stack"><label class="field"><span>Titel *</span><input class="input" name="titel" required maxlength="120" value="' + esc(kp.bez || ('Probe Nr. ' + kp.nr)) + '"></label>' +
      '<label class="field"><span>Beschreibung (ohne Betriebs- oder Personennamen)</span><textarea class="input" name="beschreibung" maxlength="1000">' + esc(kp.notiz || '') + '</textarea></label>' +
      (kp.standort && (kp.standort.plz || kp.standort.ort || kp.standort.hoehe) ? '<label class="toggle"><input type="checkbox" name="region" checked> Region übernehmen: ' + esc([[kp.standort.plz, kp.standort.ort].filter(Boolean).join(' '), kp.standort.hoehe ? kp.standort.hoehe + ' m ü. M.' : ''].filter(Boolean).join(', ')) + ' <span class="small muted">(ohne genaue Position)</span></label>' : '') +
      (kp.schnitt ? '<label class="toggle"><input type="checkbox" name="schnitt" checked> Schnittdatum (' + A.dateCH(kp.schnitt) + ')</label>' : '') +
      (kp.labor && Object.keys(kp.labor).length ? '<label class="toggle"><input type="checkbox" name="labor" checked> Laborwerte</label>' : '') +
      (fotos.length ? '<div><b class="small">Fotos</b><div class="stack" style="margin-top:6px">' + fotos.map((f, i) => '<label class="toggle"><input type="checkbox" name="foto' + i + '" checked> ' + (f.art === 'labor' ? 'Laborbericht (geschwärzt)' : 'Futterfoto') + ' ' + (i + 1) + '</label>').join('') + '</div></div>' : '') +
      '<div><b class="small">Beurteilungen als Referenz (anonym)</b>' + (zeilen.length ? '<div class="stack" style="margin-top:6px">' + zeilen.map((z, i) => '<label class="toggle"><input type="checkbox" name="ref' + i + '"> <span style="flex:1">' + esc(z.name) + ' – ' + esc(z.res.klasse ? z.res.klasse.label : '') + ', NEL ' + A.fmt(z.res.werte && z.res.werte.nel, 2) + '</span><input class="input" name="label' + i + '" maxlength="40" placeholder="Referenz ' + (i + 1) + '" style="max-width:140px;min-height:36px"></label>').join('') + '</div><p class="hint">Bezeichnung frei wählbar, z. B. «Lehrperson» oder «Konsens» – nicht den Namen eintragen.</p>' : '<p class="small muted">Noch keine Abgaben.</p>') + '</div>' +
      '<label class="toggle"><input type="checkbox" name="ok" required> <span>Die Angaben enthalten keine Personen- oder Betriebsnamen; ich darf sie weitergeben.</span></label>' +
      '<p class="hint" id="poolMsg"></p><div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">In Pool stellen</button></div></form>', (el) => {
      el.querySelector('#poolForm').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target); const btn = e.target.querySelector('.primary'); btn.disabled = true; const msg = el.querySelector('#poolMsg');
        try {
          const poolId = A.uid();
          // Fotos mit neuem Schlüssel je Foto neu verschlüsseln (Kurs- und Pool-Kopie unabhängig)
          const neueFotos = [];
          for (let i = 0; i < fotos.length; i++) {
            if (fd.get('foto' + i) !== 'on') continue;
            msg.textContent = 'Bereite Foto ' + (i + 1) + ' vor …';
            await kursFotoUrl(a.id, kp.id, fotos[i].id, true);
            const b = await F().blob(fotos[i].id); if (!b) continue;
            const meta = { id: F().neueId(), art: fotos[i].art, key: F().neuerSchluessel(), mime: b.type || fotos[i].mime, w: fotos[i].w, h: fotos[i].h };
            neueFotos.push({ meta, blob: b });
          }
          const refs = zeilen.map((z, i) => fd.get('ref' + i) === 'on' ? { label: String(fd.get('label' + i) || '').trim() || 'Referenz ' + (i + 1), analyse: Object.assign({}, z.analyse, { id: A.uid() }) } : null).filter(Boolean);
          const daten = { typ: kp.typ, titel: String(fd.get('titel')).trim(), beschreibung: String(fd.get('beschreibung') || '').trim(), quelle: a.titel,
            schnitt: fd.get('schnitt') === 'on' ? kp.schnitt : undefined,
            region: fd.get('region') === 'on' ? { plz: /^[1-9]\d{3}$/.test(String(kp.standort.plz || '').trim()) ? String(kp.standort.plz).trim() : undefined, ort: kp.standort.ort || undefined, hoehe: kp.standort.hoehe || undefined } : undefined,
            labor: fd.get('labor') === 'on' ? kp.labor : undefined,
            fotos: neueFotos.map((x) => x.meta), referenzen: refs };
          await poolApi('/' + poolId, a, { method: 'PUT', body: { daten } });
          for (const x of neueFotos) {
            msg.textContent = 'Lade Foto hoch …';
            const r = await fetch('api/pool/' + poolId + '/fotos/' + x.meta.id, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, PH(a)), body: await F().verschluesseln(x.meta, x.blob), credentials: 'omit' });
            if (!r.ok) throw new Error('Foto-Upload ' + r.status);
          }
          poolCache = null; A.closeSheet(); A.toast('Im Probenpool – für andere Kursleitende verfügbar.');
        } catch (er) { btn.disabled = false; msg.textContent = fehlerText(er); }
      });
    });
  }

  async function poolLaden(a) { poolCache = (await poolApi('', a)).eintraege; return poolCache; }
  async function poolFotoUrl(a, poolId, f) {
    let url = await F().thumbUrl(f.id);
    if (!url) {
      const r = await fetch('api/pool/' + poolId + '/fotos/' + f.id, { headers: PH(a), cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return null;
      await F().ablegen(f.id, poolId, await F().entschluesseln(f, await r.arrayBuffer()));
      url = await F().thumbUrl(f.id);
    }
    return url;
  }
  async function poolDialog(a) {
    const A = app(); const esc = A.esc;
    let liste;
    try { liste = await poolLaden(a); } catch (e) { A.toast(fehlerText(e)); return; }
    const el = A.sheet('<h2>Probenpool</h2><p class="small" style="margin-top:0">Von Kursleitenden freigegebene Proben – zum Übernehmen in diesen Kurs. Referenz-Beurteilungen erscheinen im Vergleich nach der eigenen Abgabe.</p>' +
      (liste.length ? '<ul class="list">' + liste.map((e) => {
        const d = e.daten;
        return '<li class="item" style="cursor:default;align-items:flex-start"><span class="foto-thumb" style="width:64px;height:64px;flex:none">' + (d.fotos && d.fotos[0] ? '<img alt="" data-poolfoto="' + esc(e.id) + '|' + esc(d.fotos.find((f) => f.art === 'futter') ? d.fotos.find((f) => f.art === 'futter').id : d.fotos[0].id) + '">' : '') + '</span>' +
          '<span style="flex:1;min-width:0"><span class="t">' + esc(d.titel) + '</span><span class="s">' + esc((global.K3.TYPEN[d.typ] || {}).titel || '') + (d.region && (d.region.plz || d.region.ort) ? ' · ' + [d.region.plz, d.region.ort].filter(Boolean).join(' ') : '') + (d.labor ? ' · Labor' : '') + (d.referenzen.length ? ' · ' + d.referenzen.length + ' Referenz' + (d.referenzen.length === 1 ? '' : 'en') : '') + '</span>' +
          '<span class="s">' + esc((d.quelle ? 'aus «' + d.quelle + '» · ' : '') + A.dateCH(e.createdAt)) + '</span>' +
          '<span class="row" style="margin-top:6px;gap:6px"><button class="btn sm primary" data-act="pool-uebernehmen" data-id="' + a.id + '" data-pool="' + esc(e.id) + '">Übernehmen</button><button class="btn sm" data-act="pool-pdf" data-id="' + a.id + '" data-pool="' + esc(e.id) + '">PDF</button>' +
          (e.eigen ? '<button class="btn sm danger" data-act="pool-loeschen" data-id="' + a.id + '" data-pool="' + esc(e.id) + '">Löschen</button>' : '') + '</span></span></li>';
      }).join('') + '</ul>' : '<p class="empty small">Der Pool ist noch leer. Stellen Sie Proben aus einem Kurs über «In Pool stellen» hinein.</p>') +
      '<button class="btn ghost block" data-close style="margin-top:10px">Schliessen</button>');
    for (const img of el.querySelectorAll('img[data-poolfoto]')) {
      const [pid, fid] = img.dataset.poolfoto.split('|'); const e = liste.find((x) => x.id === pid);
      const f = e && e.daten.fotos.find((x) => x.id === fid);
      if (f) poolFotoUrl(a, pid, f).then((u) => { if (u) img.src = u; }).catch(() => {});
    }
  }

  async function poolUebernehmen(a, poolId) {
    const A = app();
    const e = (poolCache || await poolLaden(a)).find((x) => x.id === poolId); if (!e) return;
    const d = e.daten;
    if (!confirm('«' + d.titel + '» als neue Probe in diesen Kurs übernehmen?')) return;
    try {
      const k = await kk(a.kurs.secret); const pid = A.uid();
      const privat = { bez: d.titel, notiz: d.beschreibung || undefined, schnitt: d.schnitt, standort: d.region ? { plz: d.region.plz, ort: d.region.ort, hoehe: d.region.hoehe } : {}, fotos: d.fotos, poolTitel: d.titel };
      await api(a.kurs.id + '/proben/' + pid, { method: 'PUT', headers: H(a), body: { analyse: { typ: d.typ }, poolId,
        privat: await C.encryptJSON(k.key, privat, C.kursAad(a.kurs.id, 'probe|' + pid)),
        labor: d.labor ? await C.encryptJSON(k.key, d.labor, C.kursAad(a.kurs.id, 'labor|' + pid)) : null } });
      await laden(a); A.closeSheet(); A.toast('Übernommen. Für ein Etikett: «QR-Etiketten» › «Bereits erfasste Proben».');
    } catch (er) { A.toast(fehlerText(er)); }
  }

  async function poolPdf(a, poolId) {
    const A = app(); const IO = global.FutterIO;
    const e = (poolCache || await poolLaden(a)).find((x) => x.id === poolId); if (!e) return;
    const d = e.daten;
    A.toast('PDF wird erstellt …');
    try {
      // Referenzen als Proben darstellen, Fotos mitgeben
      for (const f of d.fotos) await poolFotoUrl(a, poolId, f);
      const proben = d.referenzen.map((r, i) => global.Model.cleanProbe(Object.assign({}, r.analyse, { id: 'pref' + i + poolId.slice(0, 8), kopf: { bez: d.titel + ' – ' + r.label } }))).filter(Boolean);
      const anlass = { id: 'pool' + poolId.slice(0, 8), titel: 'Probenpool: ' + d.titel, notiz: [d.beschreibung, d.region && d.region.ort, d.labor ? 'Labor: ' + Object.entries(d.labor).map(([k, v]) => k.toUpperCase() + ' ' + v).join(', ') : ''].filter(Boolean).join(' · ') };
      if (!proben.length) { A.toast('Für ein PDF braucht der Eintrag mindestens eine Referenz-Beurteilung.'); return; }
      const fotosFn = async (p) => { if (p !== proben[0]) return []; const out = []; for (const f of d.fotos) { const x = await F().jpegDataUrl(f.id, 1400).catch(() => null); if (x) out.push(Object.assign(x, { art: f.art })); } return out; };
      const blob = await IO.makePdf({ anlass, proben, auswertung: A.auswertung, wheelSvg: A.wheelSvg, label: A.label, fotos: fotosFn, titel: anlass.titel });
      const url = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = url; l.download = 'Probenpool_' + d.titel.replace(/[^\w-]+/g, '_').slice(0, 40) + '.pdf'; document.body.appendChild(l); l.click(); l.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (er) { A.toast('PDF fehlgeschlagen: ' + er.message); }
  }

  // ---------- Aktionen ----------
  async function handle(act, t) {
    const A = app(); const a = t.dataset.id ? A.anlassById(t.dataset.id) : null;
    switch (act) {
      case 'kurs-anlegen': A.closeSheet(); anlegen(); return true;
      case 'kurs-probe': if (a) { A.closeSheet(); probeOeffnen(a, t.dataset.kp); } return true;
      case 'kurs-erfassen': {
        A.closeSheet();
        const kp = t.dataset.kp ? (cache.get(a.id) || { proben: [] }).proben.find((x) => x.id === t.dataset.kp) : null;
        erfassen(a, kp ? kp.id : A.uid(), kp, kp ? kp.nr : null); return true;
      }
      case 'kurs-foto': {
        const url = await kursFotoUrl(a.id, t.dataset.kp, t.dataset.foto, true).catch(() => null);
        A.sheet('<h2>Foto zur Probe</h2>' + (url ? '<img class="foto-gross" alt="" src="' + url + '">' : '<p class="muted">Foto nicht verfügbar.</p>') + '<button class="btn ghost block" data-close style="margin-top:10px">Schliessen</button>');
        return true;
      }
      case 'kurs-etiketten': A.closeSheet(); await laden(a).catch(() => {}); etikettenDialog(a); return true;
      case 'kurs-hinweise': A.closeSheet(); hinweiseDialog(a); return true;
      case 'kurs-pool': A.closeSheet(); await poolDialog(a); return true;
      case 'kurs-in-pool': { A.closeSheet(); const kp = (cache.get(a.id) || { proben: [] }).proben.find((x) => x.id === t.dataset.kp); if (kp) await inPoolDialog(a, kp); return true; }
      case 'pool-uebernehmen': await poolUebernehmen(a, t.dataset.pool); return true;
      case 'pool-pdf': await poolPdf(a, t.dataset.pool); return true;
      case 'pool-loeschen': if (confirm('Diesen Eintrag aus dem Pool löschen? Kurse, die ihn übernommen haben, verlieren die Fotos und Referenzen.')) { try { await poolApi('/' + t.dataset.pool, a, { method: 'DELETE' }); poolCache = null; A.closeSheet(); await poolDialog(a); } catch (er) { A.toast(fehlerText(er)); } } return true;
      case 'kurs-email': A.closeSheet(); emailVerknuepfen(a); return true;
      case 'kurs-code': A.closeSheet(); codeEingeben(a); return true;
      case 'kurs-mail-neu': try { await mailSenden(a, a.kurs.emailPending); } catch (er) { A.toast(fehlerText(er)); } return true;
      case 'kurs-qr': {
        A.closeSheet();
        const link = global.FutterIO.appUrl() + '#k=' + a.kurs.id + '.' + a.kurs.secret;
        const el = A.sheet('<h2>Kurs-Link zum Beitreten</h2><p class="small" style="margin-top:0">Für den Beitritt ohne Etikett (z. B. am Beamer). Wer den Code hat, kann mitmachen.</p><div class="qr-box" id="kursQr"></div>' +
          '<div class="copy-field" style="margin-top:12px"><input class="input" readonly id="kursLink" value="' + A.esc(link) + '"><button class="btn" data-act="copy" data-target="#kursLink">Kopieren</button></div>' +
          '<div class="row" style="margin-top:10px"><button class="btn grow" data-act="kurs-qr-gross" data-id="' + a.id + '">Vollbild für Beamer</button><button class="btn ghost grow" data-close>Schliessen</button></div>');
        const svg = await global.FutterIO.qrSvg(link); if (svg) el.querySelector('#kursQr').innerHTML = svg;
        return true;
      }
      case 'kurs-qr-gross': {
        const link = global.FutterIO.appUrl() + '#k=' + a.kurs.id + '.' + a.kurs.secret;
        const el = A.sheet('<div style="text-align:center"><h2 style="font-size:2rem">' + A.esc(a.titel) + '</h2><p>QR-Code scannen, um dem Kurs beizutreten</p><div class="qr-box" id="qrGross" style="max-width:min(80vh,90vw);margin:0 auto"></div><button class="btn ghost block" data-close style="margin-top:12px">Schliessen</button></div>');
        el.style.maxWidth = '900px';
        const svg = await global.FutterIO.qrSvg(link); if (svg) { el.querySelector('#qrGross').innerHTML = svg; const s = el.querySelector('#qrGross svg'); s.style.width = '100%'; s.style.height = 'auto'; }
        return true;
      }
      case 'kurs-teilnehmende': await laden(a).catch(() => {}); teilnehmendeDialog(a); return true;
      case 'kurs-name': {
        const st = cache.get(a.id); const ich = st && st.teilnehmende.find((x) => x.id === a.kurs.ichId);
        nameSchritt(a, ich ? ich.name : '', () => teilnehmendeDialog(a)); return true;
      }
      case 'kurs-login': beitreten(a.kurs.id + '.' + a.kurs.secret); return true;
      case 'kurs-abgeben': await abgeben(A.probeById(t.dataset.id)); return true;
      case 'kurs-menu': {
        const leitung = a.kurs.rolle === 'leitung';
        A.sheet('<h2>' + A.esc(a.titel) + '</h2><div class="stack">' +
          (leitung ? '<button class="btn block" data-act="kurs-etiketten" data-id="' + a.id + '">QR-Etiketten drucken</button><button class="btn block" data-act="kurs-hinweise" data-id="' + a.id + '">Hilfestellungen festlegen</button><button class="btn block" data-act="kurs-pool" data-id="' + a.id + '">Probenpool (übernehmen)</button>' +
            '<button class="btn block" data-act="kurs-qr" data-id="' + a.id + '">QR / Link zum Beitreten</button><button class="btn block" data-act="kurs-titel" data-id="' + a.id + '">Kurstitel bearbeiten</button>' : '') +
          '<button class="btn block" data-act="kurs-teilnehmende" data-id="' + a.id + '">Teilnehmende</button>' +
          '<button class="btn block" data-act="kurs-sync" data-id="' + a.id + '">Aktualisieren</button>' +
          '<button class="btn block" data-act="pdf-anlass" data-id="' + a.id + '">' + A.I.pdf + ' PDF meiner Beurteilungen</button>' +
          '<button class="btn block" data-act="kurs-abmelden" data-id="' + a.id + '">Auf diesem Gerät abmelden</button>' +
          '<button class="btn ghost block" data-close>Schliessen</button></div>');
        return true;
      }
      case 'kurs-titel': A.closeSheet(); A.sheetAnlass(a, async () => { try { await metaSpeichern(a, null); await laden(a); A.refreshChrome(); } catch (er) { A.toast(fehlerText(er)); } }); return true;
      case 'kurs-sync': A.closeSheet(); await aktualisieren(a); vergleichCache.clear(); A.render(); return true;
      case 'kurs-abmelden': {
        const st = cache.get(a.id); const ich = st && st.teilnehmende.find((x) => x.id === a.kurs.ichId);
        if (!confirm('Auf diesem Gerät abmelden?' + (ich && !ich.mitEmail && a.kurs.rolle !== 'leitung' ? '\n\nAchtung: Sie haben keine E-Mail bestätigt – danach kommen Sie nicht mehr an Ihre Teilnahme heran.' : '\n\nSie können sich mit Ihrer E-Mail-Adresse wieder anmelden.'))) return true;
        await api(a.kurs.id + '/logout', { method: 'POST', headers: H(a) }).catch(() => {});
        delete a.kurs.session; A.save(); A.closeSheet(); A.render(); return true;
      }
      case 'kurs-entfernen': {
        if (!confirm('Diese Person aus dem Kurs entfernen? Ihre Abgaben und Fotos werden gelöscht.')) return true;
        try { await api(a.kurs.id + '/teilnehmende/' + t.dataset.tid, { method: 'DELETE', headers: H(a) }); await laden(a); teilnehmendeDialog(a); vergleichCache.clear(); } catch (er) { A.toast(fehlerText(er)); }
        return true;
      }
      case 'kurs-austreten': case 'kurs-loeschen': {
        const loeschen = act === 'kurs-loeschen';
        if (!confirm(loeschen ? 'Den ganzen Kurs mit allen Proben, Fotos und Abgaben für ALLE endgültig löschen?' : 'Kurs verlassen? Ihre Abgaben, Fotos und Ihr Name werden auf dem Server gelöscht. Ihre lokalen Beurteilungen bleiben auf diesem Gerät.')) return true;
        try {
          await api(loeschen ? a.kurs.id : a.kurs.id + '/teilnehmende/' + a.kurs.ichId, { method: 'DELETE', headers: H(a) });
          A.db.proben.filter((p) => p.anlassId === a.id).forEach((p) => { delete p.kursProbeId; delete p.abgegebenAt; });
          delete a.kurs; cache.delete(a.id); A.save(); A.closeSheet(); A.render();
          A.toast(loeschen ? 'Kurs gelöscht.' : 'Sie haben den Kurs verlassen; Ihre Daten auf dem Server sind gelöscht.');
        } catch (er) { A.toast(fehlerText(er)); }
        return true;
      }
      default: return false;
    }
  }

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

  // ---------- Sammelerfassung (Ernterapport) → Kursproben ----------
  async function sammelAnlegen(a, zeilen) {
    const A = app(); const k = await kk(a.kurs.secret); const ids = [];
    try {
      for (const r of zeilen) {
        const pid = A.uid();
        const privat = { bez: r.bez, schnitt: r.schnitt, notiz: [r.herkunft ? 'Betrieb: ' + r.herkunft : '', r.info, r.notiz].filter(Boolean).join(' · ') || undefined,
          standort: { plz: r.plz, hoehe: r.hoehe != null ? String(r.hoehe) : undefined }, fotos: [] };
        await api(a.kurs.id + '/proben/' + pid, { method: 'PUT', headers: H(a), body: { analyse: { typ: r.typ }, privat: await C.encryptJSON(k.key, privat, C.kursAad(a.kurs.id, 'probe|' + pid)), labor: null } });
        ids.push(pid);
      }
    } catch (er) { A.toast((ids.length ? ids.length + ' Proben angelegt, dann Fehler: ' : 'Fehler: ') + fehlerText(er)); }
    await laden(a).catch(() => {});
    const st = cache.get(a.id) || { proben: [] };
    const nrs = st.proben.filter((p) => ids.includes(p.id)).map((p) => p.nr).sort((x, y) => x - y);
    if (ids.length) A.toast(ids.length + ' Kursproben angelegt (Nr. ' + nrs[0] + '–' + nrs[nrs.length - 1] + ').');
    return nrs;
  }
  /** Nach der Sammelerfassung gleich die Etiketten für die neuen Nummern anbieten. */
  function etikettenNachSammel(a, nrs) {
    setTimeout(() => {
      etikettenDialog(a);
      const el = document.querySelector('#etForm'); if (!el) return;
      const w = el.querySelector('[name=welche]'); w.value = 'nr';
      el.querySelector('[name=von]').value = nrs[0]; el.querySelector('[name=bis]').value = nrs[nrs.length - 1];
      w.dispatchEvent(new Event('change', { bubbles: true }));
    }, 120);
  }

  global.Kurs = { sammelAnlegen, etikettenNachSammel, mailLink, renderList, renderUebersicht, ergebnisExtra, hinweisKarte, nachRender, handle, beitreten, anlegen, istAbgegeben: (p) => !!(p && p.abgegebenAt), nameAusEmail, FORMATE };
})(window);
