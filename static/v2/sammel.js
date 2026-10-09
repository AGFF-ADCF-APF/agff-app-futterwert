/* Futter v2 – Sammelerfassung nach Vorlage «Ernterapport» (AGRIDEA/AGFF): mehrere Proben in einer Tabelle.
 *
 * Spalten wie auf dem Formular: Parzelle, Schnittdatum, Nutzungs-Nr., Pflanzenbestand, Entwicklungsstadium
 * (Zahl 1–7 oder Alter in Wochen «6w»), Konservierungsart, Lager, Korrekturen (Regentage, Anwelkgrad % TS,
 * Bemerkungen zu Gärung/Nacherwärmung). Daraus werden vorausgefüllte Proben – im Kurs Kursproben mit Etiketten.
 * Personenangaben des Formulars (Name, Adresse, Telefon) werden bewusst nicht abgefragt; nur Betrieb (optional), PLZ, Höhe.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const K3 = () => global.K3;

  const KONS = [
    { id: 'DB', t: 'DB belüftet', typ: 'heu', text: 'Belüftungsheu' },
    { id: 'BH', t: 'BH Bodenheu', typ: 'heu', text: 'Bodenheu' },
    { id: 'S', t: 'S Silage', typ: 'gras', text: 'Grassilage' },
    { id: 'M', t: 'Mais', typ: 'mais', text: 'Maissilage' },
  ];
  const ZEILEN_START = 6;
  const entwurf = {}; // je Anlass: { kopf, zeilen } – nur im Speicher, bis gespeichert

  // ---------- Auswerten einer Zeile ----------
  function datum(text, jahr) {
    const s = String(text || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return s;
    m = /^(\d{1,2})[./-](\d{1,2})[./-]?(\d{2,4})?\.?$/.exec(s);
    if (!m) return s ? null : undefined;
    const t = Number(m[1]), mo = Number(m[2]); let j = m[3] ? Number(m[3]) : Number(jahr);
    if (j < 100) j += 2000;
    if (!(t >= 1 && t <= 31 && mo >= 1 && mo <= 12 && j >= 2000 && j <= 2100)) return null;
    return j + '-' + String(mo).padStart(2, '0') + '-' + String(t).padStart(2, '0');
  }
  function tsId(typ, ts) {
    if (ts == null) return undefined;
    if (typ === 'gras') {
      const opts = K3().K3B_TS; let best = null;
      opts.forEach((o) => { if (!best || Math.abs(o.tsWert - ts) < Math.abs(best.tsWert - ts)) best = o; });
      return best && best.id;
    }
    if (typ === 'mais') return ts < 30 ? 'lt30' : ts < 32 ? '30' : ts <= 36 ? '32' : ts <= 38 ? '36' : 'gt38';
    return undefined;
  }

  /** Zeile → { probe-Felder } oder { fehler } oder null (leer). */
  function auswerten(z, kopf) {
    const leer = !Object.values(z).some((v) => String(v || '').trim());
    if (leer) return null;
    const fehler = [];
    const bez = String(z.parzelle || '').trim();
    if (!bez) fehler.push('Parzelle fehlt');
    const kons = KONS.find((k) => k.id === z.kons);
    if (!kons) fehler.push('Konservierung wählen');
    const typ = kons && kons.typ;
    const schnitt = datum(z.schnitt, kopf.jahr);
    if (schnitt === null) fehler.push('Datum als TT.MM');
    const hoehe = Number(z.hoehe || kopf.hoehe) || undefined;
    const monat = schnitt ? Number(schnitt.slice(5, 7)) : null;
    const antworten = {}; const rad = {}; const notiz = [];
    const st = String(z.stadium || '').trim();
    if (typ && typ !== 'mais') {
      if (z.bestand) antworten.bestand = z.bestand; // fehlt er, fragt die Beurteilung danach
      const nutzung = Number(z.nutzung) || null;
      const wochen = /(\d{1,2})\s*w/i.exec(st);
      if (wochen) {
        antworten.aufwuchs = nutzung === 1 ? '1' : 'f';
        antworten.wochen = Number(wochen[1]);
        if (antworten.aufwuchs === 'f') {
          antworten.ueber600 = !!(hoehe && hoehe > 600); antworten.herbst = !!(monat && monat >= 9);
          const s = K3().stadiumFolge(antworten.wochen, antworten.ueber600, antworten.herbst);
          if (s) antworten.stadium = String(s);
        } else fehler.push('1. Aufwuchs: Stadium als Zahl 1–7');
      } else if (st) {
        const n = /[1-7]/.exec(st.replace(/\([^)]*\)/g, '')) || /[1-7]/.exec(st); // «3(4)» → 3, «(3)-4» → 4
        if (n) { antworten.aufwuchs = nutzung && nutzung > 1 ? 'f' : '1'; antworten.stadium = n[0]; } else fehler.push('Stadium 1–7 oder z. B. 6w');
      } else if (nutzung) antworten.aufwuchs = nutzung > 1 ? 'f' : '1';
      // Stadium muss es für Bestand/Aufwuchs in der Tabelle geben
      const tab = app().basisTabelle && app().basisTabelle();
      if (tab && antworten.stadium && antworten.bestand) {
        const ok = K3().verfuegbareStadien(tab, typ, antworten.aufwuchs, antworten.bestand);
        if (ok.length && !ok.includes(Number(antworten.stadium))) fehler.push('Stadium ' + antworten.stadium + ' gibt es für diesen Bestand nicht (' + ok.join(', ') + ')');
      }
      if (st && st !== antworten.stadium) notiz.push('Stadium laut Ernterapport: ' + st);
    }
    if (typ === 'heu' && String(z.regen || '').trim() !== '') {
      const r = Number(z.regen); if (!(r >= 0)) fehler.push('Regentage als Zahl');
      else rad.regen = r === 0 ? 'nein' : r === 1 ? 'tag1' : 'tag2';
    }
    if ((typ === 'gras' || typ === 'mais') && String(z.ts || '').trim() !== '') {
      const t = Number(String(z.ts).replace(',', '.')); if (!(t > 5 && t < 100)) fehler.push('Anwelkgrad in % TS');
      else antworten.ts = tsId(typ, t);
    }
    if (z.nutzung) notiz.push('Nutzung ' + z.nutzung);
    if (kons) notiz.push('Konservierung: ' + kons.text);
    if (String(z.lager || '').trim()) notiz.push('Lager: ' + String(z.lager).trim());
    if (String(z.bem || '').trim()) notiz.push(String(z.bem).trim());
    notiz.push('Aus Sammelerfassung (Ernterapport)');
    if (fehler.length) return { fehler };
    const a = antworten;
    const info = [a.bestand ? 'Bestand ' + a.bestand : '', a.aufwuchs ? (a.aufwuchs === '1' ? '1. Aufwuchs' : 'Folgeaufwuchs') : '', a.stadium ? 'Stadium ' + a.stadium : '', a.wochen ? a.wochen + ' Wochen' : '',
      rad.regen ? { nein: 'kein Regen', tag1: '1 Regentag', tag2: '2+ Regentage' }[rad.regen] : '', z.ts ? 'Anwelkgrad ' + z.ts + ' % TS' : ''].filter(Boolean).join(', ');
    const plz = /^\d{4}$/.test(String(kopf.plz || '')) ? String(kopf.plz) : undefined;
    return { typ, bez, schnitt: schnitt || undefined, antworten, rad, info, notiz: notiz.join(' · '), plz, hoehe, herkunft: String(kopf.betrieb || '').trim() || undefined };
  }

  function kurzInfo(r) {
    if (!r) return '';
    if (r.fehler) return '<span class="chip kritisch">' + app().esc(r.fehler.join(' · ')) + '</span>';
    const a = r.antworten; const T = K3().TYPEN[r.typ];
    return '<span class="small">' + app().typBadge(r.typ) + ' ' + app().esc([a.bestand, a.aufwuchs ? (a.aufwuchs === '1' ? '1. Aufw.' : 'Folgeaufw.') : '', a.stadium ? 'St. ' + a.stadium : '', a.wochen ? a.wochen + ' Wo.' : ''].filter(Boolean).join(' · ') || T.titel) + '</span>';
  }

  // ---------- Darstellung ----------
  function zeileHtml(z, i, kopf) {
    const A = app(); const esc = A.esc; const K = K3();
    const sel = (name, opts, wert) => '<select class="input sm" name="' + name + '">' + opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (String(wert || '') === v ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
    const inp = (name, wert, extra) => '<input class="input sm" name="' + name + '" value="' + esc(wert || '') + '"' + (extra || '') + '>';
    return '<tr data-i="' + i + '"><td class="nr">' + (i + 1) + '</td>' +
      '<td>' + inp('parzelle', z.parzelle, ' maxlength="120" placeholder="z. B. Silage 1"') + '</td>' +
      '<td>' + inp('schnitt', z.schnitt, ' maxlength="10" inputmode="decimal" placeholder="TT.MM" style="width:6.5em"') + '</td>' +
      '<td>' + sel('nutzung', [['', '–']].concat([1, 2, 3, 4, 5, 6].map((n) => [String(n), String(n)])), z.nutzung) + '</td>' +
      '<td>' + sel('bestand', [['', '–']].concat(K.BESTAENDE.map((b) => [b.id, b.kurz + ' ' + b.titel])), z.bestand) + '</td>' +
      '<td>' + inp('stadium', z.stadium, ' maxlength="8" placeholder="3 / 6w" style="width:5.5em"') + '</td>' +
      '<td>' + sel('kons', [['', '–']].concat(KONS.map((k) => [k.id, k.t])), z.kons) + '</td>' +
      '<td>' + inp('lager', z.lager, ' maxlength="60" placeholder="Stock, Silo, Ballen"') + '</td>' +
      '<td>' + inp('regen', z.regen, ' inputmode="numeric" maxlength="2" style="width:4em"') + '</td>' +
      '<td>' + inp('ts', z.ts, ' inputmode="decimal" maxlength="4" style="width:4.5em"') + '</td>' +
      '<td>' + inp('bem', z.bem, ' maxlength="200" placeholder="Gärung, Nacherwärmung …"') + '</td>' +
      '<td>' + inp('hoehe', z.hoehe, ' inputmode="numeric" maxlength="4" placeholder="' + esc(kopf.hoehe || '') + '" style="width:5em"') + '</td>' +
      '<td class="info">' + kurzInfo(auswerten(z, kopf)) + '</td></tr>';
  }

  function render(aid) {
    const A = app(); const esc = A.esc; const a = A.anlassById(aid);
    if (!a) return '<div class="pad">Anlass nicht gefunden.</div>';
    const kurs = !!a.kurs;
    const e = entwurf[aid] = entwurf[aid] || { kopf: { jahr: String(new Date().getFullYear()) }, zeilen: Array.from({ length: ZEILEN_START }, () => ({})) };
    const k = e.kopf;
    return '<div class="bar"><a class="icon-btn" href="#/a/' + a.id + '" aria-label="Zurück">' + A.I.back + '</a><h2>Sammelerfassung<span class="sub">' + esc(a.titel || 'Anlass') + ' · wie Ernterapport</span></h2></div>' +
      '<div class="wizard sammel" data-sammel="' + a.id + '">' +
      '<p class="small muted" style="margin-top:0">Mehrere Proben auf einmal anlegen – Spalten wie auf dem Formular «Ernterapport». ' + (kurs ? 'Im Kurs entstehen daraus Kursproben (Bezeichnung, Schnittdatum, Futterart, Standort, Notiz); Bestand und Stadium beurteilen die Teilnehmenden selbst und stehen nur in der Notiz.' : 'Bestand, Stadium, Regentage und Anwelkgrad werden direkt übernommen; Geruch, Farbe usw. beurteilen Sie danach je Probe.') + '</p>' +
      '<div class="card"><div class="grid4">' +
      '<label class="field"><span>Betrieb <span class="muted">(optional)</span></span><input class="input" data-kopf="betrieb" maxlength="200" value="' + esc(k.betrieb || '') + '"></label>' +
      '<label class="field"><span>PLZ</span><input class="input" data-kopf="plz" inputmode="numeric" maxlength="4" value="' + esc(k.plz || '') + '"></label>' +
      '<label class="field"><span>Höhe ü. M. (Standard)</span><input class="input" data-kopf="hoehe" inputmode="numeric" maxlength="4" value="' + esc(k.hoehe || '') + '"></label>' +
      '<label class="field"><span>Jahr</span><input class="input" data-kopf="jahr" inputmode="numeric" maxlength="4" value="' + esc(k.jahr || '') + '"></label>' +
      '</div><p class="hint" style="margin-bottom:0">Name, Adresse und Telefon aus dem Formular werden hier bewusst nicht erfasst.</p></div>' +
      '<div class="tbl-wrap" style="margin-top:14px"><table class="tbl sammel-tbl"><thead><tr><th>#</th><th>Parzelle *</th><th>Schnitt</th><th>Nutzung</th><th>Bestand</th><th>Stadium</th><th>Konservierung *</th><th>Lager</th><th title="Dürrfutter">Regentage</th><th title="Silage">Anwelkgrad % TS</th><th>Gärung, Bemerkung</th><th>Höhe</th><th>Übernahme</th></tr></thead><tbody>' +
      e.zeilen.map((z, i) => zeileHtml(z, i, k)).join('') + '</tbody></table></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn" data-sammel-act="zeile">+ Zeile</button><button class="btn" data-sammel-act="fuenf">+ 5 Zeilen</button><span class="grow"></span><span class="small muted" id="sammelZahl"></span></div>' +
      '<p class="hint">Stadium: Zahl 1–7 im 1. Aufwuchs (z. B. «3» oder «3(4)»), bei Folgeaufwüchsen das Alter in Wochen (z. B. «6w») – daraus wird das Stadium bestimmt (über 600 m ü. M. und ab September langsamer). Regentage nur bei Dürrfutter, Anwelkgrad nur bei Silage.</p>' +
      '<div class="actionbar"><a class="btn" href="#/a/' + a.id + '">Abbrechen</a><button class="btn primary" data-sammel-act="speichern">Proben anlegen</button></div></div>';
  }

  function zaehlen(el, e) {
    const r = e.zeilen.map((z) => auswerten(z, e.kopf));
    const ok = r.filter((x) => x && !x.fehler).length; const f = r.filter((x) => x && x.fehler).length;
    const n = el.querySelector('#sammelZahl'); if (n) n.textContent = ok + ' bereit' + (f ? ', ' + f + ' mit Fehlern' : '');
  }

  /** Nach dem Rendern: Eingaben verdrahten (ohne Neu-Rendern, damit der Fokus bleibt). */
  function verdrahten() {
    const el = document.querySelector('[data-sammel]'); if (!el || el._ok) return; el._ok = true;
    const aid = el.dataset.sammel; const e = entwurf[aid];
    const zeileAktualisieren = (tr) => { const i = Number(tr.dataset.i); tr.querySelector('.info').innerHTML = kurzInfo(auswerten(e.zeilen[i], e.kopf)); };
    el.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.dataset.kopf) { e.kopf[t.dataset.kopf] = t.value; el.querySelectorAll('tbody tr').forEach(zeileAktualisieren); zaehlen(el, e); return; }
      const tr = t.closest('tr[data-i]'); if (!tr || !t.name) return;
      e.zeilen[Number(tr.dataset.i)][t.name] = t.value; zeileAktualisieren(tr); zaehlen(el, e);
    });
    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-sammel-act]'); if (!b) return;
      const act = b.dataset.sammelAct;
      if (act === 'zeile' || act === 'fuenf') {
        const tb = el.querySelector('tbody');
        for (let n = 0; n < (act === 'fuenf' ? 5 : 1); n++) { e.zeilen.push({}); tb.insertAdjacentHTML('beforeend', zeileHtml({}, e.zeilen.length - 1, e.kopf)); }
        return;
      }
      if (act === 'speichern') { b.disabled = true; try { await speichern(aid); } finally { b.disabled = false; } }
    });
    zaehlen(el, e);
  }

  async function speichern(aid) {
    const A = app(); const a = A.anlassById(aid); const e = entwurf[aid];
    const res = e.zeilen.map((z) => auswerten(z, e.kopf));
    const fehler = res.filter((r) => r && r.fehler).length;
    const ok = res.filter((r) => r && !r.fehler);
    if (!ok.length) { A.toast(fehler ? 'Bitte die rot markierten Zeilen korrigieren.' : 'Noch keine Zeile ausgefüllt.'); return; }
    if (fehler && !confirm(fehler + ' Zeile(n) haben Fehler und werden übersprungen. Trotzdem ' + ok.length + ' Proben anlegen?')) return;
    if (a.kurs) {
      if (a.kurs.rolle !== 'leitung') { A.toast('Nur die Kursleitung kann Kursproben anlegen.'); return; }
      const nrs = await global.Kurs.sammelAnlegen(a, ok);
      delete entwurf[aid];
      A.go('#/a/' + a.id);
      if (nrs && nrs.length) global.Kurs.etikettenNachSammel(a, nrs);
      return;
    }
    ok.forEach((r) => {
      const p = { id: A.uid(), typ: r.typ, anlassId: a.id, createdAt: A.now(), updatedAt: A.now(),
        kopf: { bez: r.bez, schnitt: r.schnitt, herkunft: r.herkunft, plz: r.plz, hoehe: r.hoehe, notiz: r.notiz, beurteiler: A.db.prefs.beurteiler || undefined },
        antworten: r.antworten, rad: r.rad };
      const c = global.Model.cleanProbe(p); if (c) { A.db.proben.push(c); A.touchProbe(c); }
    });
    A.save(); delete entwurf[aid];
    A.toast(ok.length + ' Proben angelegt – jetzt einzeln beurteilen (Geruch, Farbe …).');
    A.go('#/a/' + a.id);
  }

  global.Sammel = { render, verdrahten, auswerten, datum, KONS };
})(window);
