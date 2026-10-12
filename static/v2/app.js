/* Futter v2 – App: Zustand, Navigation, Erfassung, Ergebnis, Übersicht, Sync. Keine Abhängigkeiten. */
(function () {
  'use strict';
  const CFG = window.AGFF_V2 || {};
  const { K3, Rad, FutterIO: IO, Model } = window;
  const STORE_KEY = 'agffV2';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = IO.fmt;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const now = () => new Date().toISOString();
  const dateCH = (d) => (d ? new Date(d).toLocaleDateString('de-CH') : '');

  // ---------- Icons (inline, keine externen Ressourcen) ----------
  const I = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 18v-6M9 15l3 3 3-3"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H8a5 5 0 1 1 1.2-9.86A6 6 0 0 1 20.5 12a3.5 3.5 0 0 1-3 7z"/></svg>',
    cloudOk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H8a5 5 0 1 1 1.2-9.86A6 6 0 0 1 20.5 12a3.5 3.5 0 0 1-3 7z"/><path d="M9.5 14l2 2 4-4"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    wheel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg>',
  };

  // ---------- Zustand ----------
  const emptyDb = () => ({ v: 1, anlaesse: [], proben: [], prefs: { beurteiler: '', kuhGewicht: 630, mastGewicht: 400 }, tombstones: [] });
  let db = emptyDb();
  let basis = null;
  let storageOk = true;
  const ui = { route: { name: 'home' }, sort: { k: 'nel', dir: -1 }, fokus: {}, listTab: 'proben', online: navigator.onLine };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) db = Model.cleanDb(JSON.parse(raw));
    } catch (e) { storageOk = false; }
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { storageOk = false; toast('Speichern im Browser nicht möglich – bitte PDF/JSON sichern.'); }
    }, 150);
    if (!db._persistAsked && navigator.storage && navigator.storage.persist) { db._persistAsked = true; navigator.storage.persist().catch(() => {}); }
  }
  function flush() { clearTimeout(saveTimer); try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }
  window.addEventListener('pagehide', flush);

  const anlassById = (id) => db.anlaesse.find((a) => a.id === id);
  const probeById = (id) => db.proben.find((p) => p.id === id);
  const probenOf = (aid) => db.proben.filter((p) => (aid ? p.anlassId === aid : !p.anlassId)).sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));

  /** Proben aus einem über Nur-Ansehen-Link geöffneten Anlass sind schreibgeschützt. */
  const readOnly = (p) => { if (p && p.abgegebenAt) return true; const a = p && p.anlassId && anlassById(p.anlassId); return !!(a && a.space && a.space.mode === 'r'); };
  const anlassReadOnly = (aid) => { const a = aid && anlassById(aid); return !!(a && a.space && a.space.mode === 'r'); };
  function guardRO(p) { if (readOnly(p)) { toast(p.abgegebenAt ? 'Abgegeben – die Beurteilung ist gesperrt.' : 'Nur-Ansehen-Link: Änderungen sind nicht möglich.'); return true; } return false; }

  function neueProbe(typ, aid, antworten) {
    const n = probenOf(aid).length + 1;
    const pr = { id: uid(), typ, anlassId: aid, createdAt: now(), updatedAt: now(), kopf: { bez: 'Probe ' + n, beurteiler: db.prefs.beurteiler || '' }, antworten: antworten || {}, rad: {} };
    db.proben.push(pr); touchProbe(pr);
    return pr;
  }
  function touchProbe(p) {
    p.updatedAt = now();
    if (window.Statistik) window.Statistik.planen(p);
    const a = p.anlassId && anlassById(p.anlassId);
    if (a) { a.updatedAt = p.updatedAt; if (a.space) { p.dirty = true; scheduleSync(a); } }
    save();
  }

  // ---------- Auswertung / Darstellung ----------
  const auswertungCache = new Map();
  function auswertung(p) {
    const key = p.id + '|' + p.updatedAt + '|' + (basis ? 1 : 0);
    if (auswertungCache.has(key)) return auswertungCache.get(key);
    const res = K3.auswerten(p, basis && basis.tabelle);
    auswertungCache.set(key, res);
    return res;
  }
  function tonOf(res) { return res.sperre.length ? 'kritisch' : (res.klasse && res.vollstaendig ? res.klasse.ton : (res.klasse ? res.klasse.ton : 'offen')); }
  function zentrum(p, res) {
    if (p.typ === 'gruen') return { wert: res.werte ? fmt(res.werte.nel, 1) : '–', label: res.werte ? 'MJ NEL' : 'offen', ton: res.werte ? tonOf(res) : 'offen' };
    if (p.typ === 'heu') {
      const anyset = Object.values(res.auswahl).some(Boolean);
      return { wert: anyset ? (res.korr.nel > 0 ? '+' : '') + fmt(res.korr.nel, 0) + '%' : '–', label: anyset ? 'NEL-Korrektur' : 'offen', ton: anyset ? tonOf(res) : 'offen' };
    }
    const anyset = Object.values(res.auswahl).some(Boolean);
    return { wert: anyset ? res.punkte : '–', label: anyset ? (res.mitPh ? 'Punkte inkl. pH' : 'Punkte') : 'offen', ton: anyset ? tonOf(res) : 'offen' };
  }
  function wheelSvg(p, res, opts) {
    return Rad.render(K3.TYPEN[p.typ].rad, res.auswahl, Object.assign({ zentrum: zentrum(p, res), titel: 'Beurteilungsrad ' + K3.TYPEN[p.typ].merkblatt }, opts || {}));
  }
  const bestandName = (id) => { const b = K3.BESTAENDE.find((x) => x.id === id); return b ? b.titel : ''; };
  function bestandStadium(p) {
    const a = p.antworten || {};
    if (p.typ === 'mais') { const k = { gt55: 'Kolben > 55 %', 45: 'Kolben 45–55 %', lt45: 'Kolben < 45 %' }[a.kolben]; return k || ''; }
    if (p.typ === 'gps') { const ku = K3.GPS_KULTUREN.find((x) => x.id === a.kultur); const st = K3.GPS_STADIEN.find((x) => x.id === a.gpsStadium); return [ku && ku.titel, st && st.titel].filter(Boolean).join(' · '); }
    const parts = [];
    if (a.bestand) parts.push(K3.BESTAND_PLAIN[a.bestand]);
    if (a.aufwuchs) parts.push(a.aufwuchs === '1' ? '1. Aufw.' : 'Folgeaufw.');
    if (a.stadium) parts.push('St. ' + a.stadium);
    return parts.join(' · ');
  }
  const titelOf = (p) => (p.kopf && p.kopf.bez) || 'Probe ohne Namen';
  function mppOf(p, res) {
    if (!res.werte) return null;
    return K3.milchPotenzial(res.werte, { kuhGewicht: db.prefs.kuhGewicht, tsv: p.tsv && p.tsv.kuh, tsvBasis: res.basis && res.basis.tsv, typ: p.typ === 'heu' || p.typ === 'gruen' ? p.typ : 'silage', aufwuchs: p.antworten.aufwuchs });
  }

  const mastGewicht = () => Number(db.prefs.mastGewicht) || 400;
  function mastOf(p, res) { return res.werte ? K3.mastPotenzial(res.werte, { lebendgewicht: mastGewicht(), tsv: p.tsv && p.tsv.mast }) : null; }
  /** Deutlicher Tier-Knopf in den Kästen Tierleistung: antippen → Gewicht und Verzehr anpassen. */
  const tierKnopf = (p, art, gewicht) => '<button type="button" class="btn sm tier-btn" data-act="tier" data-tier="' + art + '" data-id="' + p.id + '">' + (art === 'kuh' ? 'Milchkuh' : 'Mastmuni') + ' ' + gewicht + ' kg · Gewicht und Verzehr anpassen</button>';
  /** Umschalter Milch / Mast: prominente Knöpfe mit Ergebnis; der Kasten erscheint erst auf Wunsch (Auswahl wird gemerkt). */
  function tierUmschalter(p, res) {
    const m = p.typ === 'mais' ? null : mppOf(p, res); const ms = mastOf(p, res);
    if (!m && !ms) return '';
    const sel = db.prefs.tierAnsicht === 'kuh' && m ? 'kuh' : db.prefs.tierAnsicht === 'mast' && ms ? 'mast' : '';
    const knopf = (art, ico, titel, wert, da) => '<button type="button" class="tier-schalter" data-act="tier-ansicht" data-val="' + art + '" aria-pressed="' + (sel === art) + '"' + (da ? '' : ' disabled') + '>' +
      '<span class="tier-ico" aria-hidden="true">' + ico + '</span><span class="tier-txt"><b>' + titel + '</b><small>' + wert + '</small></span></button>';
    return '<div class="tier-umschalter" role="group" aria-label="Tierleistung">' +
      knopf('kuh', '🐄', 'Milch', m ? fmt(m.mpp, 1) + ' kg/Tag' : 'nicht für Mais', !!m) +
      knopf('mast', '🐂', 'Mast', ms ? (ms.tzw == null ? 'unter Erhaltung' : fmt(Math.round(ms.tzw / 10) * 10, 0) + ' g/Tag') : '–', !!ms) + '</div>' +
      (sel === 'kuh' ? mppCard(p, res) : sel === 'mast' ? mastCard(p, res) : '');
  }
  const verzehrText = (m, quelle) => 'Verzehr ' + fmt(m.tsv, 1) + ' kg TS ' + (m.tsvEigen ? '<b>(eigener Wert)</b>' : '(' + quelle + ')');
  function sheetTier(p, art) {
    if (!p) return;
    const res = auswertung(p); const kuh = art === 'kuh';
    const ohne = Object.assign({}, p, { tsv: undefined });
    const schaetz = kuh ? mppOf(ohne, res) : mastOf(ohne, res);
    const eigen = p.tsv && (kuh ? p.tsv.kuh : p.tsv.mast);
    sheet('<h2><span style="font-size:1.6rem;vertical-align:-3px">' + (kuh ? '🐄' : '🐂') + '</span> ' + (kuh ? 'Milchkuh' : 'Mastmuni') + '</h2>' +
      '<form id="tierForm" class="stack"><label class="field"><span>Lebendgewicht (kg)' + (kuh ? '' : ', ' + K3.MAST.LG_MIN + '–' + K3.MAST.LG_MAX) + ' <span class="muted">– gilt für alle Proben</span></span><input class="input" name="gewicht" inputmode="numeric" value="' + esc(kuh ? db.prefs.kuhGewicht : mastGewicht()) + '"></label>' +
      '<fieldset class="stack" style="border:0;padding:0;margin:0"><legend class="small" style="font-weight:650;margin-bottom:6px">Verzehr dieses Futters <span class="muted">(nur diese Probe)</span></legend>' +
      '<label class="toggle"><input type="radio" name="modus" value="auto"' + (eigen ? '' : ' checked') + '> <span>Schätzen' + (schaetz ? ': ' + fmt(schaetz.tsv, 1) + ' kg TS' : '') + ' <span class="muted small">' + (kuh ? '(aus dem NEL-Gehalt, AGFF-Merkblatt 3)' : '(Grünes Buch Kap. 10, aus Gewicht und Zuwachs)') + '</span></span></label>' +
      '<label class="toggle"><input type="radio" name="modus" value="eigen"' + (eigen ? ' checked' : '') + '> <span>Eigener Wert</span></label>' +
      '<label class="field"><span>kg TS pro Tag</span><input class="input" name="tsv" inputmode="decimal" value="' + esc(eigen ? String(eigen).replace('.', ',') : '') + '" placeholder="' + (schaetz ? fmt(schaetz.tsv, 1) : '') + '"></label></fieldset>' +
      '<p class="hint">Der eigene Verzehr eignet sich z. B., wenn er auf dem Betrieb gemessen wurde oder das Futter besonders gern bzw. schlecht gefressen wird.</p>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Übernehmen</button></div></form>', (el) => {
      const inp = el.querySelector('[name=tsv]');
      inp.addEventListener('input', () => { el.querySelector('[name=modus][value=eigen]').checked = true; });
      el.querySelector('#tierForm').addEventListener('submit', (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        const g = Number(String(fd.get('gewicht')).replace(',', '.'));
        if (kuh) db.prefs.kuhGewicht = g >= 300 && g <= 1000 ? Math.round(g) : db.prefs.kuhGewicht;
        else db.prefs.mastGewicht = Math.max(K3.MAST.LG_MIN, Math.min(K3.MAST.LG_MAX, Math.round(g) || mastGewicht()));
        if (readOnly(p)) { save(); closeSheet(); rerenderDetail(true); return; }  // gesperrte Probe: nur Gewicht (gilt allgemein)
        const v = Number(String(fd.get('tsv') || '').replace(',', '.'));
        const t = Object.assign({}, p.tsv || {});
        if (fd.get('modus') === 'eigen' && v > 0) { if (kuh && (v < 3 || v > 40)) { toast('Verzehr Milchkuh: 3–40 kg TS'); return; } if (!kuh && (v < 1 || v > 25)) { toast('Verzehr Mastmuni: 1–25 kg TS'); return; } t[art] = Math.round(v * 10) / 10; } else delete t[art];
        if (Object.keys(t).length) p.tsv = t; else delete p.tsv;
        touchProbe(p); closeSheet(); rerenderDetail(true);
      });
    });
  }
  const fmtTzw = (t) => (t == null ? 'unter Erhaltung' : fmt(Math.round(t / 10) * 10, 0) + ' g');
  function mastText(m) {
    if (!m) return null;
    return 'Mastpotenzial Muni ' + m.lebendgewicht + ' kg aus diesem Futter allein: ' + (m.tzw == null ? 'deckt den Erhaltungsbedarf nicht (begrenzt durch ' + m.limit + ')' : 'ca. ' + fmtTzw(m.tzw) + ' Tageszuwachs (begrenzt durch ' + m.limit + ')') +
      '; Verzehr ' + fmt(m.tsv, 1) + ' kg TS. Agroscope, Grünes Buch Kap. 10 – Energiebedarf gilt als ca. 20 % überschätzt, reale Zunahmen eher höher.';
  }

  /** Aufbereitete Texte für PDF + Ergebnisansicht */
  function label(p, res) {
    const a = p.antworten || {}; const k = p.kopf || {};
    const typ = K3.TYPEN[p.typ];
    const an = p.anlassId && anlassById(p.anlassId);
    const meta = [['Anlass', an && an.titel], ['Herkunft', k.herkunft], ['Beurteilt von', k.beurteiler], ['Schnitt', dateCH(k.schnitt)], ['Erfasst', dateCH(p.createdAt)]];
    if (p.typ === 'gps') {
      const ku = K3.GPS_KULTUREN.find((x) => x.id === a.kultur); const st = K3.GPS_STADIEN.find((x) => x.id === a.gpsStadium); const lg = K3.GPS_LEGUM.find((x) => x.id === (a.leguminosen || 'none'));
      meta.splice(3, 0, ['Kultur', ku ? ku.titel : ''], ['Stadium', st ? st.titel + ' (' + st.text + ')' : ''], ['Leguminosen', lg ? lg.titel : '']);
    }
    if (p.typ !== 'mais' && p.typ !== 'gps') meta.splice(3, 0, ['Bestand', a.bestand ? K3.BESTAND_PLAIN[a.bestand] + ' – ' + bestandName(a.bestand) : ''], ['Aufwuchs/Stadium', a.aufwuchs ? (a.aufwuchs === '1' ? '1. Aufwuchs' : 'Folgeaufwuchs') + (a.stadium ? ', Stadium ' + a.stadium : '') : '']);
    const rows = [];
    const w = res.werte || {}; const b = res.basis || {};
    if (p.typ === 'gps') {
      const e = res.erwartet || {};
      ['nel', 'nev', 'apde', 'apdn', 'rp', 'rf', 'adf', 'ndf', 'ra', 'staerke', 'zucker'].filter((m) => e[m] != null || w[m] != null).forEach((m) => {
        const d = w[m] != null && e[m] != null ? w[m] - e[m] : null; const dg = m === 'nel' || m === 'nev' ? 2 : 0;
        rows.push({ key: ['nel', 'apde'].includes(m), label: K3.METRIK_LABEL[m][0], unit: K3.METRIK_LABEL[m][1], basis: fmt(e[m], dg), korr: d && Math.abs(d) > 0.004 ? (d > 0 ? '+' : '') + fmt(d, dg) : '–', wert: fmt(w[m], dg) });
      });
    } else if (p.typ === 'mais') {
      K3.K3C_METRIKEN.forEach((m) => {
        const d = w[m] != null && b[m] != null ? w[m] - b[m] : null;
        rows.push({ key: ['nel', 'apde'].includes(m), label: K3.METRIK_LABEL[m][0], unit: K3.METRIK_LABEL[m][1], basis: fmt(b[m], m === 'nel' || m === 'nev' ? 2 : 0),
          korr: d ? (d > 0 ? '+' : '') + fmt(d, m === 'nel' || m === 'nev' ? 2 : 0) : '–', wert: fmt(w[m], m === 'nel' || m === 'nev' ? 2 : 0) });
      });
    } else {
      ['nel', 'nev', 'apde', 'apdn', 'rp', 'rf', 'ndf', 'adf', 'zucker', 'ra', 'ca', 'p', 'mg', 'k'].forEach((m) => {
        const kk = res.korr && res.korr[m] != null ? res.korr[m] : null;
        const d = ['nel', 'nev'].includes(m) ? 2 : (['ca', 'p', 'mg'].includes(m) ? 1 : 0);
        rows.push({ key: ['nel', 'apde', 'apdn'].includes(m), label: K3.METRIK_LABEL[m][0], unit: K3.METRIK_LABEL[m][1], basis: fmt(b[m], d),
          korr: kk ? (kk > 0 ? '+' : '') + fmt(kk, 0) + ' %' : '–', wert: fmt(w[m], d) });
      });
    }
    const befunde = [];
    if (p.typ === 'gruen') {
      const sb = K3.K3B_SAUBERKEIT.find((x) => x.id === a.sauberkeit);
      befunde.push({ k: 'Sauberkeit', v: sb && sb.text, v2: sb ? (sb.k.nel ? fmt(sb.k.nel, 0) + ' %' : '0 %') : '', ton: sb && sb.k.nel ? 'kritisch' : 'gut' });
    }
    if (p.typ === 'gps') {
      const ku = K3.GPS_KULTUREN.find((x) => x.id === a.kultur); const st = K3.GPS_STADIEN.find((x) => x.id === a.gpsStadium); const lg = K3.GPS_LEGUM.find((x) => x.id === (a.leguminosen || 'none'));
      befunde.push({ k: 'Kultur / Stadium', v: [ku && ku.titel, st && st.titel + ' – ' + st.text].filter(Boolean).join(', '), v2: lg && lg.id !== 'none' && !(ku && ku.gemenge) ? 'Leguminosen ' + lg.titel : '' });
      if (ku) befunde.push({ k: 'Grundlage', v: ku.quelle === 'agff' ? 'AGFF-Infoblatt K1, Agroscope-Analysen 2012–2013' + (res.spanne ? ' – Streuung im Datensatz: NEL ' + fmt(res.spanne.nel[0], 1) + '–' + fmt(res.spanne.nel[1], 1) + ' MJ, RP ' + res.spanne.rp[0] + '–' + res.spanne.rp[1] + ' g' : '') : 'Richtwert aus v1 (keine AGFF-Werte für diese Kultur)', ton: ku.quelle === 'agff' ? 'gut' : 'mittel' });
      if (w.rp && w.nel) { const v = w.rp / w.nel; befunde.push({ k: 'RP/NEL', v: fmt(v, 0) + ' (Zielwert Milchkühe > 20)', v2: v < 20 ? 'Proteindefizit – ergänzen' : '', ton: v < 20 ? 'mittel' : 'gut' }); }
      befunde.push({ k: 'Konservierung (aus dem Rad)', v: { sehr_gut: 'Sehr gut', normal: 'Normal', kritisch: 'Kritisch', schlecht: 'Schlecht' }[res.gpsKons] || '–', ton: res.gpsKons === 'schlecht' ? 'kritisch' : res.gpsKons === 'kritisch' ? 'mittel' : 'gut' });
    }
    if (p.typ === 'gras' || p.typ === 'gps') {
      const sb = K3.K3B_SAUBERKEIT.find((x) => x.id === a.sauberkeit); const ts = K3.K3B_TS.find((x) => x.id === a.ts);
      befunde.push({ k: 'Sauberkeit', v: sb && sb.text, v2: sb ? (sb.k.nel ? fmt(sb.k.nel, 0) + ' %' : '0 %') : '', ton: sb && sb.k.nel ? 'kritisch' : 'gut' });
      befunde.push({ k: 'TS-Gehalt (Auswringprobe)', v: ts && (ts.ts + ' – ' + ts.text), v2: ts && p.typ === 'gras' ? (ts.k.nel ? 'NEL ' + fmt(ts.k.nel, 0) + ' / APDE ' + (ts.k.apde > 0 ? '+' : '') + fmt(ts.k.apde, 0) + ' %' : '0 %') : '' });
      if (a.phWert) befunde.push({ k: 'pH-Wert', v: fmt(a.phWert, 1).replace('.', ',') + (res.auswahl.ph ? ' → ' + res.auswahl.ph.slice(1) + ' Punkte' : '') });
    }
    if (p.typ === 'mais') {
      (res.schritte || []).forEach((s) => befunde.push({ k: s.titel, v: s.text, v2: s.rating || '', ton: s.rating && /ungenügend/.test(s.rating) ? 'kritisch' : (s.rating && /akzeptabel/.test(s.rating) ? 'mittel' : 'gut') }));
      if (a.phWert) befunde.push({ k: 'pH-Wert', v: fmt(a.phWert, 1) });
      if (res.korrIds && res.korrIds.length) befunde.push({ k: 'Korrekturen (Parzelleninfo/TS)', v: res.korrIds.map((id) => K3.K3C_KORR[id].label).join(', ') });
    }
    typ.rad.forEach((f) => {
      const o = res.auswahl[f.id] && f.optionen.find((x) => x.id === res.auswahl[f.id]);
      if (!o) return;
      let v2 = '';
      if (p.typ === 'heu') { const kk = o.k; v2 = o.block ? 'nicht verfüttern' : (kk.nel || kk.apde || kk.apdn ? ['NEL ' + kk.nel, 'APDE ' + kk.apde, 'APDN ' + kk.apdn].filter((s) => !/ 0$/.test(s)).join(' / ') + ' %' : 'keine Korrektur'); }
      else v2 = o.p == null ? '' : o.p + ' Pkt.';
      befunde.push({ k: f.gruppe.replace(/-/g, '') + (f.optionen[0].mitte && p.typ === 'heu' && f.gruppe !== 'Geruch' && f.gruppe !== 'Farbe' ? ' – ' + f.optionen[0].mitte : ''), v: o.text, v2, ton: o.block || (o.p && o.p >= 4) ? 'kritisch' : (o.p || (o.k && o.k.nel < 0) ? 'mittel' : 'gut') });
    });
    if (p.labor && Object.keys(p.labor).length) {
      const lb = p.labor; const tx = [['nel', 'NEL', 2, ' MJ'], ['apde', 'APDE', 0, ' g'], ['rp', 'RP', 0, ' g'], ['ts', 'TS', 1, ' %']].filter(([k]) => lb[k] != null).map(([k, l, d, u]) => l + ' ' + fmt(lb[k], d) + u + (w[k] != null && k !== 'ts' ? ' (Schätzung ' + fmt(w[k], d) + ')' : '')).join(' · ');
      if (tx) befunde.push({ k: 'Laborbericht', v: tx });
    }
    let klasseSub = '';
    if (p.typ === 'gruen' && res.korr) klasseSub = res.korr.nel ? 'Abzug Verschmutzung ' + fmt(res.korr.nel, 0) + ' %' : 'Tabellenwert Agroscope';
    if (p.typ === 'heu' && res.korr) klasseSub = 'Korrektur NEL ' + fmt(res.korr.nel, 0) + ' % · APDE ' + fmt(res.korr.apde, 0) + ' % · APDN ' + fmt(res.korr.apdn, 0) + ' %';
    if (p.typ !== 'heu' && res.punkte != null) klasseSub = res.punkte + ' Punkte ' + (res.mitPh ? '(inkl. pH)' : '(ohne pH)');
    const mp = p.typ === 'mais' ? null : mppOf(p, res);
    const ms = mastOf(p, res);
    return {
      titel: titelOf(p), meta, tabelle: rows, befunde, klasseSub, bestandStadium: bestandStadium(p),
      basisLabel: p.typ === 'mais' ? 'Ausgang' : p.typ === 'gps' ? 'Richtwert' : 'Tabelle',
      mpp: mp ? 'Milchbildungspotenzial aus diesem Futter allein: ' + fmt(mp.mpp, 1) + ' kg Milch/Tag (begrenzt durch ' + mp.limit + '; Verzehr ' + fmt(mp.tsv, 1) + ' kg TS, Kuh ' + mp.kuhGewicht + ' kg).' : null,
      mppKurz: mp ? fmt(mp.mpp, 1) : null,
      mast: mastText(ms),
      mastKurz: ms ? (ms.tzw == null ? '< Erh.' : fmt(Math.round(ms.tzw / 10) * 10, 0)) : null,
    };
  }

  // ---------- Routing ----------
  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    if (h.startsWith('import=')) return { name: 'import', payload: h.slice(7) };
    if (h.startsWith('s=')) return { name: 'join', token: h.slice(2) };
    if (h.startsWith('k=')) return { name: 'kurs', token: h.slice(2) };
    if (h.startsWith('km=')) return { name: 'kursmail', token: h.slice(3) };
    if (h.startsWith('space=')) return { name: 'join', token: '' }; // Format aus Beta-Test, nicht mehr gültig
    const seg = h.replace(/^\//, '').split('/').filter(Boolean);
    if (seg[0] === 'a' && seg[1]) return { name: 'anlass', id: seg[1], ov: seg[2] === 'uebersicht', sammel: seg[2] === 'sammel' };
    if (seg[0] === 'e') return { name: 'anlass', id: null, ov: seg[1] === 'uebersicht' };
    if (seg[0] === 'p' && seg[1]) return { name: 'probe', id: seg[1], step: seg[2] || null };
    if (seg[0] === 'daten') return { name: 'daten' };
    if (seg[0] === 'schweiz') return { name: 'schweiz' };
    if (seg[0] === 'bilanz') return { name: 'bilanz' };
    if (seg[0] === 'wiese') return { name: 'wiese' };
    if (seg[0] === 'fotopunkte') return { name: 'fotopunkte', id: seg[1] || null };
    if (seg[0] === 'pflanzen') return { name: 'pflanzen' };
    if (seg[0] === 'hilfe') return { name: 'hilfe' };
    if (seg[0] === 'pool') return { name: 'pool', id: seg[1] || null };
    return { name: 'home' };
  }
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  function route() {
    closeSheet();
    const r = parseHash();
    if (r.name === 'import') { history.replaceState(null, '', location.pathname + '#/'); handleImportPayload(r.payload); ui.route = { name: 'home' }; }
    else if (r.name === 'join') { history.replaceState(null, '', location.pathname + '#/'); joinSpace(r.token); ui.route = { name: 'home' }; }
    else if (r.name === 'kursmail') { history.replaceState(null, '', location.pathname + '#/'); ui.route = { name: 'home' }; render(); window.Kurs.mailLink(r.token); return; }
    else if (r.name === 'kurs') { history.replaceState(null, '', location.pathname + '#/'); ui.route = { name: 'home' }; render(); window.Kurs.beitreten(r.token); return; }
    else ui.route = r;
    render();
  }
  window.addEventListener('hashchange', route);

  // ---------- Rendering ----------
  function render() {
    const r = ui.route;
    const app = $('#app');
    let depth = 0;
    let anlassId = null;
    if (r.name === 'anlass') { depth = r.ov || r.sammel ? 2 : 1; anlassId = r.id; }
    if (r.name === 'probe') {
      const p = probeById(r.id);
      if (!p) { ui.route = { name: 'home' }; return render(); }
      depth = 2; anlassId = p.anlassId || null;
    }
    const SEITEN = ['home', 'daten', 'schweiz', 'bilanz', 'wiese', 'fotopunkte', 'pflanzen', 'hilfe', 'pool'];
    if (SEITEN.includes(r.name) && r.name !== 'home') depth = r.name === 'wiese' ? 0 : 2;
    const appName = appVon(r); if (!NEUTRAL_ROUTEN.includes(r.name)) { appStand.aktiv = appName; appStand[appName] = location.hash || '#/'; appStandMerken(); }
    document.documentElement.dataset.app = appName;
    ui.ctxAnlass = SEITEN.includes(r.name) ? (ui.ctxAnlass !== undefined ? ui.ctxAnlass : undefined) : anlassId;
    app.dataset.depth = depth;
    $('#r-nav').innerHTML = renderNav(r);
    $('#r-list').innerHTML = appVon(r) === 'wiese' ? window.Wiese.renderListe(r) : renderList(SEITEN.includes(r.name) ? ui.ctxAnlass : anlassId, r);
    $('#main').innerHTML = r.name === 'probe' ? renderProbe(probeById(r.id), r.step)
      : r.name === 'anlass' ? (r.sammel ? window.Sammel.render(anlassId) : renderUebersicht(anlassId))
      : r.name === 'daten' ? renderDaten() : r.name === 'schweiz' ? window.Schweiz.render() : r.name === 'bilanz' ? window.Bilanz.render()
      : r.name === 'wiese' ? window.Wiese.render() : r.name === 'fotopunkte' ? window.Wiese.renderFotopunkte(r.id) : r.name === 'pflanzen' ? window.Pflanzen.render() : r.name === 'hilfe' ? renderHilfe() : r.name === 'pool' ? window.PoolOeffentlich.render(r.id) : renderWelcome();
    afterRender();
  }
  let lastHash = null;

  function syncState(a) {
    if (!a.space) return { ico: '', t: 'Nur auf diesem Gerät' };
    if (a.space.mode === 'r' && !a.space.error && ui.online) return { ico: I.lock, t: 'Nur ansehen · auf dem Server geteilt' };
    if (!ui.online) return { ico: I.cloud, t: 'Offline – wird später synchronisiert' };
    if (a.space.error) return { ico: I.cloud, t: 'Synchronisation fehlgeschlagen' };
    const dirty = probenOf(a.id).some((p) => p.dirty);
    return dirty ? { ico: I.cloud, t: 'Änderungen werden übertragen …' } : { ico: I.cloudOk, t: 'Auf dem Server gespeichert' + (a.space.lastSync ? ' · ' + new Date(a.space.lastSync).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : '') };
  }

  // ---------- Apps: Futterbeurteilung | Wiesenbeurteilung (gleiche Daten, getrennte Navigation) ----------
  const WIESE_ROUTEN = ['wiese', 'fotopunkte', 'pflanzen'];
  const NEUTRAL_ROUTEN = ['hilfe', 'daten'];
  const APP_KEY = 'agffV2Apps';
  const appStand = (() => { try { const z = JSON.parse(localStorage.getItem(APP_KEY) || '{}'); return z && typeof z === 'object' ? z : {}; } catch (e) { return {}; } })();
  const appStandMerken = () => { try { localStorage.setItem(APP_KEY, JSON.stringify(appStand)); } catch (e) { /* privat */ } };
  function appVon(r) { return WIESE_ROUTEN.includes(r.name) ? 'wiese' : NEUTRAL_ROUTEN.includes(r.name) ? (appStand.aktiv || 'futter') : 'futter'; }
  const APP_ICON = {
    futter: '<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="9" width="24" height="16" rx="3"/><path d="M4 14h24M4 20h24" stroke-width="1.4" opacity=".7"/><path d="M11 9v16M21 9v16" stroke-width="2.4"/><path d="M7 9l2-3M14 9l1-3M24 9l2-3" stroke-width="1.4"/></svg>',
    wiese: '<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 27h26"/><path d="M7 27c0-6-2-10-4-12M11 27c0-7 1-12 3-15M16 27c0-6 3-9 6-10M21 27c0-4-1-8-4-10M26 27c0-5 1-8 3-9"/><circle cx="24" cy="8" r="2.4" fill="currentColor"/><path d="M24 10.4V17"/></svg>',
  };
  function appUmschalter(aktiv) {
    const k = (id, titel) => '<button type="button" class="app-knopf" data-act="app" data-val="' + id + '" aria-pressed="' + (aktiv === id) + '">' + APP_ICON[id] + '<span>' + titel + '</span></button>';
    return '<div class="app-umschalter" role="group" aria-label="App wählen">' + k('futter', 'Futter') + k('wiese', 'Wiese') + '</div>';
  }
  /** Am Computer: mittlere Spalte (Liste) ein-/ausklappen – Knopf in der Kopfzeile des Arbeitsbereichs. */
  const LISTE_KEY = 'agffV2Liste';
  try { if (localStorage.getItem(LISTE_KEY) === 'zu') document.documentElement.dataset.liste = 'zu'; } catch (e) { /* privat */ }
  function listeGriff() {
    document.querySelectorAll('.liste-griff').forEach((x) => x.remove());
    const bar = document.querySelector('#main .bar'); if (!bar) return;
    const zu = document.documentElement.dataset.liste === 'zu';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'liste-griff'; b.dataset.act = 'liste-umschalten';
    b.title = zu ? 'Liste einblenden' : 'Liste ausblenden (mehr Platz für die Beurteilung)'; b.setAttribute('aria-label', b.title);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>' + (zu ? '<path d="M13 10l2 2-2 2"/>' : '<path d="M16 10l-2 2 2 2"/>') + '</svg>';
    bar.insertBefore(b, bar.firstChild);
  }
  /** Wenn das Menü nicht sichtbar ist (Handy, Tablet): kleiner Umschalter in der Kopfzeile der Ansicht. */
  function appMini() {
    document.querySelectorAll('.app-mini').forEach((x) => x.remove());
    const nav = document.querySelector('.region-nav');
    if (nav && getComputedStyle(nav).display !== 'none') return;
    const reg = ['.region-list', '.region-detail'].map((q) => document.querySelector(q)).find((x) => x && getComputedStyle(x).display !== 'none');
    const bar = reg && reg.querySelector('.bar'); if (!bar) return;
    const aktiv = appVon(ui.route);
    const k = (id, titel) => '<button type="button" class="app-mini-k" data-act="app" data-val="' + id + '" aria-pressed="' + (aktiv === id) + '" aria-label="App ' + titel + '" title="' + titel + '">' + APP_ICON[id].replace('width="26" height="26"', 'width="20" height="20"') + '</button>';
    const el = document.createElement('span'); el.className = 'app-mini'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'App wählen');
    el.innerHTML = k('futter', 'Futter') + k('wiese', 'Wiese');
    bar.appendChild(el);
  }
  window.addEventListener('resize', () => { clearTimeout(appMini.t); appMini.t = setTimeout(appMini, 150); });
  function appWechseln(ziel) {
    const r = ui.route; const jetzt = appVon(r);
    if (!NEUTRAL_ROUTEN.includes(r.name)) appStand[jetzt] = location.hash || '#/';
    appStand.aktiv = ziel; appStandMerken();
    go(appStand[ziel] && appStand[ziel] !== location.hash ? appStand[ziel] : (ziel === 'wiese' ? '#/wiese' : '#/'));
  }

  function renderNav(r) {
    if (appVon(r) === 'wiese') return window.Wiese.renderNav(r, appUmschalter('wiese'));
    const cur = r.name === 'anlass' ? r.id : (r.name === 'probe' ? (probeById(r.id) || {}).anlassId : undefined);
    const anl = db.anlaesse.slice().sort((x, y) => ((y.datum || y.createdAt) > (x.datum || x.createdAt) ? 1 : -1));
    const einzel = probenOf(null).length;
    return '<div class="bar"><div class="brand"><img src="assets/icon.svg" alt=""><div><b>Futterbeurteilung</b><span class="sub">AGFF K3a · K3b · K3c <span class="badge-beta">v2 Beta 1</span></span></div></div>' +
      '<button class="icon-btn" data-act="outdoor" title="Modus «Draussen»: hoher Kontrast" aria-label="Modus Draussen umschalten">' + I.sun + '</button></div>' +
      appUmschalter('futter') +
      '<div class="pad stack">' +
      '<button class="btn primary block" data-act="new-probe" style="min-height:56px">' + I.plus + ' Neue Probe beurteilen</button>' +
      '<div class="row"><button class="btn sm grow" data-act="new-anlass">' + I.plus + ' Neuer Anlass</button><button class="btn sm grow" data-act="import">' + I.upload + ' Importieren</button></div>' +
      '</div>' +
      '<div class="section-title" style="margin-top:4px;padding:0 12px;display:flex;justify-content:space-between;align-items:center">Anlässe<button class="btn sm ghost" data-act="meine-kurse" style="min-height:30px;font-size:.78rem">Kurse per E-Mail wiederfinden</button></div><ul class="list" style="padding:0 8px">' +
      (anl.length ? anl.map((a) => {
        const n = a.kurs ? '' : probenOf(a.id).length; const s = syncState(a);
        return '<li><a class="item" href="#/a/' + a.id + '" aria-current="' + (cur === a.id) + '"><span class="avatar">' + esc((a.titel || '?').slice(0, 2).toUpperCase()) + '</span><span style="min-width:0"><span class="t">' + esc(a.titel || 'Ohne Titel') + '</span><span class="s">' +
          esc((a.kurs ? 'Kurs · ' + (a.kurs.rolle === 'leitung' ? 'Leitung' : 'Teilnahme') + ' · ' : '') + ([dateCH(a.datum), a.ort].filter(Boolean).join(' · ') || (a.kurs ? '' : 'Anlass'))) + '</span></span><span class="meta"><span class="num">' + n + '</span><br>' + (s.ico ? '<span title="' + esc(s.t) + '" class="muted">' + s.ico.replace('<svg', '<svg class="sync-ico"') + '</span>' : '') + '</span></a></li>';
      }).join('') : '<li class="muted small" style="padding:6px 12px 10px">Noch keine Anlässe. Ein Anlass bündelt Proben z. B. eines Kurses, Betriebsbesuchs oder einer Silage-Schau.</li>') +
      '<li><a class="item" href="#/e" aria-current="' + (cur === null) + '"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">' + I.wheel.replace('<svg', '<svg width="22" height="22"') + '</span><span><span class="t">Einzelproben</span><span class="s">ohne Anlass</span></span><span class="meta num">' + einzel + '</span></a></li>' +
      '</ul>' +
      '<div class="section-title" style="padding:0 12px">Daten & Datenschutz</div><ul class="list" style="padding:0 8px 24px">' +
      '<li><a class="item" href="#/daten" aria-current="' + (r.name === 'daten') + '"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">' + I.lock.replace('<svg', '<svg width="22" height="22"') + '</span><span><span class="t">Speicherort, Sicherung, v1-Daten</span><span class="s">' + (storageOk ? 'Daten liegen nur in diesem Browser' : 'Browserspeicher nicht verfügbar!') + '</span></span></a></li>' +
      '<li><a class="item" href="#/bilanz" aria-current="' + (r.name === 'bilanz') + '"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">' + I.table.replace('<svg', '<svg width="22" height="22"') + '</span><span><span class="t">Rationscheck</span><span class="s">Energie & Protein der Ration</span></span></a></li>' +
      '<li><a class="item" href="#/schweiz" aria-current="' + (r.name === 'schweiz') + '"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">CH</span><span><span class="t">Auswertung Schweiz</span><span class="s">Karte nach PLZ und Höhenzone</span></span></a></li>' +
      '<li><a class="item" href="#/pool" aria-current="' + (r.name === 'pool') + '"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">' + I.table.replace('<svg', '<svg width="22" height="22"') + '</span><span><span class="t">Musterproben</span><span class="s">Öffentlicher Probenpool mit Laborwerten</span></span></a></li>' +
      '<li><a class="item" href="#/hilfe" aria-current="' + (r.name === 'hilfe') + '"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">?</span><span><span class="t">Hilfe & Merkblätter</span><span class="s">Unterlagen, Pflanzentabelle, Quellen</span></span></a></li>' +
      '<li><a class="item" href="../"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">v1</span><span><span class="t">Zur bisherigen Version</span><span class="s">Futterwert-Rechner v1</span></span></a></li>' +
      '</ul>';
  }

  /** Farbiges Merkblatt-Kürzel (K3a/K3b/K3c) zur schnellen Unterscheidung der Futterart. */
  const typBadge = (typ) => '<span class="typ-badge typ-' + typ + '">' + K3.TYPEN[typ].merkblatt + '</span>';

  function probeItem(p, active) {
    const res = auswertung(p);
    const w = res.werte;
    const ton = tonOf(res);
    return '<li><a class="item typ-' + p.typ + '" href="#/p/' + p.id + '" aria-current="' + active + '">' + wheelSvg(p, res, { mini: true }).replace('class="rad rad-mini"', 'class="rad rad-mini mini"') +
      '<span style="min-width:0"><span class="t">' + (p.muster ? '<span class="chip muster">Muster</span> ' : '') + esc(titelOf(p)) + '</span><span class="s">' + typBadge(p.typ) + ' ' + esc(K3.TYPEN[p.typ].kurz + (bestandStadium(p) ? ' · ' + bestandStadium(p) : '')) + '</span></span>' +
      '<span class="meta"><span class="num">' + (w && w.nel ? fmt(w.nel, 2) : '–') + '</span><br><span class="chip ' + ton + '" style="padding:0 7px;font-size:.7rem">' + esc(res.sperre.length ? 'Sperre' : res.vollstaendig ? res.klasse.label.replace(' Silage', '') : 'offen') + '</span></span></a></li>';
  }

  function renderList(aid, r) {
    if (aid === undefined) {
      // Kein Kontext: zuletzt bearbeitete Proben
      const recent = db.proben.slice().sort((x, y) => (y.updatedAt > x.updatedAt ? 1 : -1)).slice(0, 12);
      return '<div class="bar"><h2>Zuletzt bearbeitet</h2></div><ul class="list" style="padding:8px">' +
        (recent.length ? recent.map((p) => probeItem(p, false)).join('') : '<li class="empty small">Noch keine Proben erfasst.</li>') + '</ul>';
    }
    const a = aid ? anlassById(aid) : null;
    if (aid && !a) return '<div class="pad">Anlass nicht gefunden.</div>';
    if (a && a.kurs) return window.Kurs.renderList(a, r);
    const list = probenOf(aid);
    const activeId = r.name === 'probe' ? r.id : null;
    const s = a ? syncState(a) : null;
    return '<div class="bar"><a class="icon-btn back-btn hide-wide" href="#/" aria-label="Zurück">' + I.back + '</a><h2>' + esc(a ? a.titel : 'Einzelproben') +
      '<span class="sub">' + esc(a ? [dateCH(a.datum), a.ort, list.length + ' Proben'].filter(Boolean).join(' · ') : list.length + ' Proben ohne Anlass') + '</span></h2>' +
      (a ? '<button class="icon-btn" data-act="anlass-menu" data-id="' + a.id + '" aria-label="Anlass-Aktionen">' + I.more + '</button>' : '') + '</div>' +
      window.Statistik.speicherHinweis(a, list.length) +
      (a ? '<div class="pad" style="padding-bottom:0"><button class="btn sm block ' + (a.space ? 'ghost' : '') + '" data-act="' + (a.space ? 'share-space' : 'consent') + '" data-id="' + a.id + '">' + (a.space ? s.ico + ' ' + esc(s.t) : I.phone + ' Nur auf diesem Gerät · Teilen …') + '</button></div>' : '') +
      '<div class="pad" style="padding-bottom:0"><div class="seg" role="tablist"><button aria-pressed="true">Proben</button><a class="btn ghost sm" style="flex:1;min-height:42px" href="#/' + (a ? 'a/' + a.id : 'e') + '/uebersicht">' + I.table + ' Übersicht</a></div></div>' +
      '<ul class="list" style="padding:8px">' + (list.length ? list.map((p) => probeItem(p, p.id === activeId)).join('') : '<li class="empty small">Noch keine Proben. Tippen Sie auf «Probe hinzufügen».</li>') + '</ul>' +
      '<div class="fab-wrap"><button class="btn primary fab" data-act="new-probe" data-anlass="' + (aid || '') + '">' + I.plus + ' Probe hinzufügen</button></div>';
  }

  // ---------- Hilfe: Merkblätter und Quellen ----------
  const DOKS = [
    ['Beurteilung von Raufutter', [
      ['AGFF_K3a_Duerrfutter-Qualitaet_2022.pdf', 'K3a Schlüssel zur Beurteilung der Dürrfutter-Qualität', 'AGFF 2022'],
      ['AGFF_K3b_Grassilage-Qualitaet_2023.pdf', 'K3b Schlüssel zur Beurteilung der Grassilage-Qualität', 'AGFF 2023'],
      ['AGFF_K3c_Maissilage-Qualitaet_2021.pdf', 'K3c Schlüssel zur Beurteilung der Maissilage-Qualität', 'AGFF 2021'],
      ['AGFF_MB03_Bewertung_Wiesenfutter_2021.pdf', 'Merkblatt 3: Bewertung von Wiesenfutter (Bestand, Stadium, Zeitperiode, Konservierung)', 'AGFF 2021'],
      ['AGFF_Infoblatt_K1_Ganzpflanzensilage.pdf', 'Infoblatt K1: Ganzpflanzensilage', 'AGFF'],
      ['Agrarforschung_Schweiz_2015_Ganzpflanzensilage.pdf', 'Fachartikel Ganzpflanzensilage (Grundlage der GPS-Werte aus v1)', 'Agrarforschung Schweiz 6 (4), 2015'],
    ]],
    ['Entwicklungsstadien und TS-Bestimmung', [
      ['AGFF_Entwicklungsstadien_Graeser_Beschreibung.pdf', 'Beschreibung der Entwicklungsstadien der Gräser', 'AGFF'],
      ['LMZ_Entwicklungsstadien_Graeser_Zeichnung.pdf', 'Entwicklungsstadien der Gräser (Zeichnung)', 'edition lmz'],
      ['LMZ_Futter_einfuehren_Trockenheit.pdf', 'Futter einführen: nötige Trockenheit, Wringprobe', 'edition lmz'],
    ]],
    ['Pflanzen bestimmen', [
      ['AGFF_Schluessel_Graeser_vegetativ.pdf', 'Schlüssel Wiesengräser im vegetativen Zustand', 'AGFF / edition lmz 2016'],
      ['AGFF_Schluessel_Graeser_ab_Rispenschieben.pdf', 'Schlüssel Wiesengräser ab Beginn Rispenschieben', 'AGFF / edition lmz 2016'],
      ['AGFF_Schluessel_Leguminosen_vegetativ.pdf', 'Schlüssel Leguminosen im vegetativen Zustand', 'AGFF / edition lmz 2016'],
      ['AGFF_Schluessel_Kraeuter_vegetativ.pdf', 'Schlüssel Kräuter im vegetativen Zustand', 'AGFF / edition lmz 2016'],
    ]],
  ];
  function renderHilfe() {
    const ext = (u, t, s) => '<li><a href="' + u + '" target="_blank" rel="noopener noreferrer"><b>' + t + '</b> ↗</a><div class="small muted">' + s + '</div></li>';
    return '<div class="bar"><h2>Hilfe & Merkblätter<span class="sub">Unterlagen, auf denen die App beruht</span></h2></div><div class="pad hilfe">' +
      DOKS.map(([g, l]) => q(g, '', '<ul class="doks">' + l.map(([f, t, h]) => '<li><a href="assets/docs/' + f + '" download><span class="doc-ico">PDF</span><span><b>' + esc(t) + '</b><span class="small muted">' + esc(h) + '</span></span></a></li>').join('') + '</ul>')).join('') +
      q('Pflanzen: wichtigste Eigenschaften', 'Alle Arten der vier AGFF-Bestimmungsschlüssel mit Weg im Schlüssel, Merkmalen, Giftigkeit, Raster-Klasse und futterbaulichem Wert (eAGFF).',
        '<div class="row"><button class="btn" data-pf="export" data-v="csv">Tabelle für Excel (CSV)</button><button class="btn" data-pf="export" data-v="pdf">Tabelle als PDF</button><a class="btn ghost" href="#/pflanzen">Pflanzen bestimmen</a></div>') +
      q('Weitere Quellen', '', '<ul class="ext">' +
        ext('https://www.eagff.ch', 'eAGFF – Wissensplattform Futterbau', 'Pflanzenporträts, Fotos, Bestimmungsschlüssel (AGFF)') +
        ext('https://www.agroscope.admin.ch/de/fuetterungsempfehlungen-fuer-wiederkaeuer', 'Fütterungsempfehlungen für Wiederkäuer («Grünes Buch»)', 'Agroscope – Nährwertberechnung, Verzehr, Bedarf') +
        ext('https://www.agroscope.admin.ch/de/futtermitteldatenbank', 'Schweizerische Futtermitteldatenbank', 'Agroscope – Referenzwerte Einzelfutter') +
        ext('https://www.agff.ch', 'AGFF – Arbeitsgemeinschaft zur Förderung des Futterbaus', 'Merkblätter bestellen, Kurse') + '</ul>') +
      '<p class="hint">Die Merkblätter werden mit Zustimmung der Herausgeber zum Download angeboten. Zeichnungen der Bestimmungsschlüssel © edition lmz; Fotos aus eAGFF © AGFF, Agroscope bzw. e-pics ETH-Bibliothek (Nachweis beim Bild).</p></div>';
  }

  function renderWelcome() {
    const f = (ico, t, d) => '<div class="feature"><span class="fi">' + ico + '</span><div><b>' + t + '</b><div class="muted small">' + d + '</div></div></div>';
    return '<div class="bar"><h2>Willkommen</h2><a class="btn sm ghost" href="../">v1</a></div><div class="welcome">' +
      '<h2>Futter beurteilen – im Feld, am Silo, im Büro.</h2><p class="muted">Die digitale Fassung der AGFF-Schlüssel K3a (Dürrfutter), K3b (Grassilage) und K3c (Maissilage) – mit den farbigen Beurteilungsrädern, sofortiger Nährwertschätzung und Vergleich ganzer Anlässe.</p>' +
      f(I.wheel, 'Beurteilungsrad zum Antippen', 'Geruch, Farbe, Gärung: Ausprägung im Rad oder in grossen Schaltflächen wählen – Punkte und Korrekturen rechnen live mit.') +
      f(I.lock, 'Daten bleiben bei Ihnen', 'Alles wird nur in diesem Browser gespeichert und funktioniert auch offline. Auf den Server kommt nur, was Sie ausdrücklich freigeben.') +
      f(I.pdf, 'PDF mit eingebauten Daten', 'Der Bericht enthält einen QR-Code und die Eingaben selbst – PDF hochladen oder Code scannen, und die Beurteilung ist wieder da.') +
      f(I.table, 'Übersicht im Büro', 'Proben eines Anlasses nebeneinander: Tabelle, Energie-Vergleich und alle Räder auf einen Blick.') +
      '<div class="row" style="margin-top:22px"><button class="btn primary" data-act="new-probe">' + I.plus + ' Neue Probe</button><button class="btn" data-act="new-anlass">Anlass anlegen</button><button class="btn ghost" data-act="import">' + I.upload + ' PDF/JSON importieren</button></div>' +
      '<p class="small muted" style="margin-top:28px">Beta: Bitte Ergebnisse mit den gedruckten Merkblättern plausibilisieren. Die bisherige Version bleibt unverändert verfügbar.</p></div>';
  }

  // ---------- Probe: Wizard ----------
  function stepsFor(p) {
    const s = [{ id: 'probe', t: 'Probe' }];
    if (p.typ === 'heu') s.push({ id: 'bestand', t: 'Bestand' }, { id: 'stadium', t: 'Stadium' }, { id: 'rad', t: 'Sensorik-Rad' });
    if (p.typ === 'gras') s.push({ id: 'bestand', t: 'Bestand' }, { id: 'stadium', t: 'Stadium' }, { id: 'ts', t: 'Sauberkeit & TS' }, { id: 'rad', t: 'Gärqualität-Rad' });
    if (p.typ === 'mais') s.push({ id: 'haecksel', t: 'Häcksel & Körner' }, { id: 'ts', t: 'TS & Parzelle' }, { id: 'rad', t: 'Gärqualität-Rad' });
    if (p.typ === 'gruen') s.push({ id: 'bestand', t: 'Bestand' }, { id: 'stadium', t: 'Stadium' }, { id: 'sauber', t: 'Sauberkeit' });
    if (p.typ === 'gps') s.push({ id: 'kultur', t: 'Kultur & Stadium' }, { id: 'ts', t: 'Sauberkeit & TS' }, { id: 'rad', t: 'Gärqualität-Rad' });
    s.push({ id: 'ergebnis', t: 'Ergebnis' });
    return s;
  }
  function stepDone(p, id) {
    const a = p.antworten || {};
    if (id === 'probe') return !!(p.kopf && p.kopf.bez);
    if (id === 'bestand') return !!a.bestand;
    if (id === 'stadium') return !!(a.aufwuchs && a.stadium);
    if (id === 'ts') return p.typ === 'gras' || p.typ === 'gps' ? !!(a.sauberkeit && a.ts) : !!(a.ts && a.kolben);
    if (id === 'sauber') return !!a.sauberkeit;
    if (id === 'kultur') return !!(a.kultur && a.gpsStadium);
    if (id === 'haecksel') return !!(a.laenge && a.schnitt && a.koerner);
    if (id === 'rad') { const sel = K3.radAuswahl(p); return K3.TYPEN[p.typ].rad.every((f) => f.ph || sel[f.id]); }
    if (id === 'ergebnis') return auswertung(p).vollstaendig;
    return false;
  }

  function renderProbe(p, stepId) {
    const steps = stepsFor(p);
    const step = steps.find((s) => s.id === stepId) || steps[0];
    const idx = steps.indexOf(step);
    const typ = K3.TYPEN[p.typ];
    const back = p.anlassId ? '#/a/' + p.anlassId : '#/e';
    let body = '';
    if (step.id === 'probe') body = stepProbe(p);
    if (step.id === 'bestand') body = stepBestand(p);
    if (step.id === 'stadium') body = stepStadium(p);
    if (step.id === 'ts') body = p.typ === 'gras' || p.typ === 'gps' ? stepTsGras(p) : stepTsMais(p);
    if (step.id === 'sauber') body = stepSauber(p);
    if (step.id === 'kultur') body = stepKultur(p);
    if (step.id === 'haecksel') body = stepHaecksel(p);
    if (step.id === 'rad') body = stepRad(p);
    if (step.id === 'ergebnis') body = stepErgebnis(p);
    const next = steps[idx + 1]; const prev = steps[idx - 1];
    return '<div class="bar"><a class="icon-btn" href="' + back + '" aria-label="Zurück zur Liste">' + I.back + '</a><h2>' + (p.muster ? '<span class="chip muster">Muster</span> ' : '') + esc(titelOf(p)) + '<span class="sub">' + esc(typ.titel + ' · ' + (typ.quelle || 'AGFF ' + typ.merkblatt)) + '</span></h2>' +
      '<button class="icon-btn" data-act="probe-menu" data-id="' + p.id + '" aria-label="Probe-Aktionen">' + I.more + '</button></div>' +
      '<nav class="steps" aria-label="Schritte">' + steps.map((s, i) => '<button class="step-chip' + (stepDone(p, s.id) ? ' done' : '') + '" data-go="#/p/' + p.id + '/' + s.id + '"' + (s === step ? ' aria-current="step"' : '') + '><span class="n">' + (stepDone(p, s.id) ? '✓' : i + 1) + '</span>' + s.t + '</button>').join('') + '</nav>' +
      '<div class="wizard" data-probe="' + p.id + '">' + window.Kurs.hinweisKarte(p) + (readOnly(p) ? '<div class="alert info" style="margin-bottom:14px">' + I.lock + '<div>' + (p.abgegebenAt ? 'Im Kurs <b>abgegeben</b> am ' + dateCH(p.abgegebenAt) + ' – gesperrt. Den Vergleich finden Sie unter «Ergebnis».' : 'Geteilt über einen <b>Nur-Ansehen-Link</b> – Sie können alles einsehen, aber nichts ändern.') + '</div></div>' : '') + body + '</div>' +
      (step.id === 'rad' && next && !readOnly(p) ? radActionbar(p, prev, next)
        : '<div class="actionbar">' + (prev ? '<button class="btn" data-go="#/p/' + p.id + '/' + prev.id + '">' + I.back + ' ' + prev.t + '</button>' : '<a class="btn" href="' + back + '">Liste</a>') +
      (next ? '<button class="btn primary" data-go="#/p/' + p.id + '/' + next.id + '">' + next.t + ' →</button>' : '<button class="btn primary" data-act="pdf-probe" data-id="' + p.id + '">' + I.pdf + ' PDF</button>') + '</div>');
  }

  /** Rad: geteilter Weiter-Knopf – Hauptknopf dreht zum nächsten offenen Faktor, daneben direkt zum Ergebnis. */
  function radActionbar(p, prev, next) {
    const typ = K3.TYPEN[p.typ]; const sel = K3.radAuswahl(p);
    const offen = (f) => !f.ph && !sel[f.id];
    const i = Math.max(0, typ.rad.findIndex((f) => f.id === ui.fokus[p.id]));
    const reihe = typ.rad.slice(i + 1).concat(typ.rad.slice(0, i + 1));
    const naechster = reihe.find(offen);
    const name = (x) => (x.gruppe === 'Feldbedingungen' || x.gruppe === 'Sauberkeit' ? x.optionen[0].mitte : x.gruppe).replace(/-/g, '');
    const zurueck = '<button class="btn rad-zurueck" data-go="#/p/' + p.id + '/' + prev.id + '" aria-label="Zurück: ' + esc(prev.t) + '">' + I.back + '</button>';
    if (!naechster) return '<div class="actionbar">' + zurueck + '<button class="btn primary" data-go="#/p/' + p.id + '/' + next.id + '">' + next.t + ' →</button></div>';
    const rest = typ.rad.filter(offen).length;
    return '<div class="actionbar">' + zurueck +
      '<div class="split-btn"><button class="btn primary" data-fokus="' + naechster.id + '"><span class="split-haupt">Weiter: ' + esc(name(naechster)) + '</span><small>noch ' + rest + ' offen</small></button>' +
      '<button class="btn split-neben" data-go="#/p/' + p.id + '/' + next.id + '" title="Offene Faktoren überspringen">' + next.t + ' ⏭</button></div></div>';
  }

  const opt = (o) => '<button type="button" class="opt' + (o.cls ? ' ' + o.cls : '') + '" aria-pressed="' + !!o.on + '" data-set="' + esc(o.set) + '" data-val="' + esc(o.val) + '">' +
    (o.lead != null ? '<span class="lead">' + o.lead + '</span>' : '') + '<span class="body"><b>' + o.t + '</b>' + (o.s ? '<small>' + o.s + '</small>' : '') + '</span>' + (o.tag ? '<span class="tag">' + o.tag + '</span>' : '') + '</button>';
  const q = (title, hint, inner) => '<section class="q"><h3>' + title + '</h3>' + (hint ? '<p class="qhint">' + hint + '</p>' : '') + inner + '</section>';

  // ---------- Fotos ----------
  const F = window.Fotos;
  const fotoUrls = new Map();
  /** Laborfotos bleiben verborgen, bis die eigene Beurteilung vollständig ist (keine Beeinflussung). */
  const laborGesperrt = (p) => !auswertung(p).vollstaendig;

  function fotosHtml(p) {
    const list = p.fotos || [];
    const ro = readOnly(p);
    const kachel = (f) => {
      const zu = f.art === 'labor' && laborGesperrt(p);
      return '<button type="button" class="foto-thumb' + (zu ? ' gesperrt' : '') + '" data-act="foto-zeigen" data-id="' + p.id + '" data-foto="' + f.id + '" aria-label="' + (f.art === 'labor' ? 'Laborbericht' : 'Futterfoto') + '">' +
        '<img alt="" data-foto-img="' + f.id + '" data-probe="' + p.id + '">' + (zu ? '<span class="lock">' + I.lock + '</span>' : '') +
        '<span class="foto-art">' + (f.art === 'labor' ? 'Labor' : 'Futter') + (f.up === false && (anlassById(p.anlassId) || {}).space ? ' · ⟳' : '') + '</span></button>';
    };
    return '<div class="fotos">' + list.map(kachel).join('') +
      (ro ? '' : '<button type="button" class="foto-add" data-act="foto-neu" data-id="' + p.id + '" data-art="futter">' + I.plus + '<span>Futter</span></button>' +
        '<button type="button" class="foto-add" data-act="foto-neu" data-id="' + p.id + '" data-art="labor">' + I.plus + '<span>Laborbericht</span></button>') + '</div>' +
      (list.some((f) => f.art === 'labor') && laborGesperrt(p) ? '<p class="hint">' + I.lock.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"') + ' Laborberichte bleiben verborgen, bis Ihre eigene Beurteilung vollständig ist.</p>' : '');
  }

  /** Lädt fehlende Fotos aus einer Server-Freigabe. */
  async function fotoVomServer(p, meta) {
    const a = p.anlassId && anlassById(p.anlassId);
    if (!a || !a.space || meta.up === false) return false;
    const k = await keysFor(a);
    const r = await fetch('api/spaces/' + a.space.id + '/fotos/' + meta.id, { headers: readH(k), cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return false;
    await F.ablegen(meta.id, p.id, await F.vomServer(meta, await r.arrayBuffer()));
    return true;
  }
  async function fotosEinsetzen() {
    for (const img of document.querySelectorAll('img[data-foto-img]')) {
      const id = img.dataset.fotoImg;
      let url = fotoUrls.get(id);
      if (!url) {
        try {
          url = await F.thumbUrl(id);
          if (!url) {
            const p = probeById(img.dataset.probe); const meta = p && (p.fotos || []).find((f) => f.id === id);
            if (meta && await fotoVomServer(p, meta)) url = await F.thumbUrl(id);
          }
        } catch (e) { url = null; }
        if (url) fotoUrls.set(id, url);
      }
      if (url) img.src = url; else img.closest('.foto-thumb').classList.add('fehlt');
    }
    if (window.Kurs) window.Kurs.nachRender();
  }

  function fotoNeu(p, art) {
    if (guardRO(p)) return;
    if ((p.fotos || []).length >= 12) { toast('Maximal 12 Fotos pro Probe.'); return; }
    sheet('<h2>' + (art === 'labor' ? 'Laborbericht' : 'Futter') + ' fotografieren</h2>' +
      (art === 'labor' ? '<div class="alert info" style="margin-bottom:12px">' + I.warn + '<div><b>Datenschutz:</b> Decken Sie Adresse und Namen <b>vor dem Fotografieren</b> ab. Im nächsten Schritt können Sie Bereiche zusätzlich schwärzen – gespeichert wird nur die geschwärzte Fassung.</div></div>'
        : '<p class="small muted" style="margin-top:0">Standortdaten (GPS) und Kamera-Informationen werden automatisch entfernt. Das Foto bleibt auf diesem Gerät.</p>') +
      '<input type="file" accept="image/*" id="fotoInput" hidden><div class="stack"><button class="btn primary block" id="fKam">Kamera</button><button class="btn block" id="fGal">Aus Galerie / Datei</button><button class="btn ghost block" data-close>Abbrechen</button></div>', (el) => {
      const inp = el.querySelector('#fotoInput');
      el.querySelector('#fKam').onclick = () => { inp.setAttribute('capture', 'environment'); inp.click(); };
      el.querySelector('#fGal').onclick = () => { inp.removeAttribute('capture'); inp.click(); };
      inp.onchange = async () => {
        const file = inp.files[0]; if (!file) return;
        closeSheet(); toast('Foto wird verarbeitet …');
        try {
          let c = await F.vorbereiten(file, art);
          let ger;
          if (art === 'futter' && window.Wiese.farbabgleich(c)) toast('Farben mit der Messkarte abgeglichen.');
          if (art === 'labor') { const r = await F.laborSchwaerzen(c, toast); if (!r) { toast('Abgebrochen – kein Foto gespeichert.'); return; } c = r.canvas; ger = r.ger; }
          const meta = await F.speichern(c, art, p.id);
          meta.up = false; if (ger) meta.ger = ger;
          p.fotos = (p.fotos || []).concat(meta);
          touchProbe(p); rerenderDetail(true);
          toast('Foto gespeichert (' + Math.round(meta.bytes / 1024) + ' kB' + (meta.mime === 'image/webp' ? ', WebP' : ', JPEG') + ').');
        } catch (e) { toast(e.message); }
      };
    });
  }

  async function fotoZeigen(p, fid) {
    const meta = (p.fotos || []).find((f) => f.id === fid); if (!meta) return;
    const ro = readOnly(p);
    const zu = meta.art === 'labor' && laborGesperrt(p);
    let url = null;
    if (!zu) { url = await F.bildUrl(fid); if (!url && await fotoVomServer(p, meta).catch(() => false)) url = await F.bildUrl(fid); }
    const el = sheet('<h2>' + (meta.art === 'labor' ? 'Laborbericht' : 'Futterfoto') + '</h2>' +
      (zu ? '<div class="alert info">' + I.lock + '<div>Verborgen, bis Ihre eigene Beurteilung vollständig ist – damit der Laborbericht Ihre Einschätzung nicht beeinflusst.</div></div>'
        : url ? '<img class="foto-gross" alt="" src="' + url + '">' : '<p class="muted">Foto ist auf diesem Gerät nicht vorhanden.</p>') +
      '<p class="small muted">' + meta.w + ' × ' + meta.h + ' px · ' + Math.round((meta.bytes || 0) / 1024) + ' kB · ' + (meta.mime === 'image/webp' ? 'WebP' : 'JPEG') + ' · ohne Standortdaten</p>' +
      '<div class="row">' + (!ro && !zu && url ? '<button class="btn grow" data-act="foto-schwaerzen" data-id="' + p.id + '" data-foto="' + fid + '">Bereiche schwärzen</button>' : '') +
      (ro ? '' : '<button class="btn danger grow" data-act="foto-loeschen" data-id="' + p.id + '" data-foto="' + fid + '">Löschen</button>') + '<button class="btn ghost grow" data-close>Schliessen</button></div>');
    void el;
  }

  async function fotoLoeschen(p, fid) {
    if (guardRO(p) || !confirm('Foto löschen?')) return;
    const meta = (p.fotos || []).find((f) => f.id === fid);
    p.fotos = (p.fotos || []).filter((f) => f.id !== fid);
    if (!p.fotos.length) delete p.fotos;
    await F.del(fid).catch(() => {});
    const a = p.anlassId && anlassById(p.anlassId);
    if (a && a.space && meta && meta.up !== false) db.fotoTombstones = (db.fotoTombstones || []).concat({ sid: a.space.id, id: fid });
    fotoUrls.delete(fid);
    touchProbe(p); closeSheet(); rerenderDetail(true);
  }

  async function fotosHochladen(a, k) {
    const sid = a.space.id;
    for (const t of (db.fotoTombstones || []).filter((x) => x.sid === sid)) {
      await fetch('api/spaces/' + sid + '/fotos/' + t.id, { method: 'DELETE', headers: writeH(k), credentials: 'omit' }).catch(() => {});
    }
    db.fotoTombstones = (db.fotoTombstones || []).filter((x) => x.sid !== sid);
    for (const p of probenOf(a.id)) {
      for (const f of (p.fotos || []).filter((x) => x.up === false)) {
        const b = await F.blob(f.id); if (!b) continue;
        const r = await fetch('api/spaces/' + sid + '/fotos/' + f.id, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, writeH(k)), body: await F.fuerServer(f, b), credentials: 'omit' });
        if (!r.ok) { const e = new Error(r.status === 409 ? 'Speicherplatz der Freigabe für Fotos ist voll' : 'Foto-Upload fehlgeschlagen (' + r.status + ')'); e.status = r.status; throw e; }
        f.up = true; p.dirty = true;
      }
    }
  }

  function stepProbe(p) {
    const k = p.kopf || {};
    const an = db.anlaesse;
    return q('Angaben zur Probe', 'Nur die Bezeichnung ist nötig. Alles bleibt auf diesem Gerät, solange Sie nichts freigeben.',
      '<div class="stack">' +
      '<label class="field"><span>Bezeichnung *</span><input class="input" data-k="kopf.bez" value="' + esc(k.bez) + '" placeholder="z. B. Probe 3, Silo Nord, Rundballen 12" autocomplete="off"></label>' +
      '<div class="grid2"><label class="field"><span>Herkunft / Betrieb</span><input class="input" data-k="kopf.herkunft" value="' + esc(k.herkunft) + '" placeholder="optional"></label>' +
      '<label class="field"><span>Beurteilt von</span><input class="input" data-k="kopf.beurteiler" value="' + esc(k.beurteiler) + '" placeholder="Name" autocomplete="name"></label></div>' +
      '<div class="grid2"><label class="field"><span>Schnittdatum</span><input class="input" type="date" data-k="kopf.schnitt" value="' + esc(k.schnitt) + '"></label>' +
      '<label class="field"><span>Anlass</span><select class="input" data-k="anlassId"><option value="">– ohne Anlass –</option>' + an.filter((a) => !(a.space && a.space.mode === 'r') || a.id === p.anlassId).map((a) => '<option value="' + a.id + '"' + (a.id === p.anlassId ? ' selected' : '') + '>' + esc(a.titel) + '</option>').join('') + '</select></label></div>' +
      '<div class="grid2"><label class="field"><span>PLZ (für den Vergleich mit der Region)</span><input class="input" data-k="kopf.plz" inputmode="numeric" maxlength="4" value="' + esc(k.plz) + '" placeholder="z. B. 3052"></label>' +
      '<label class="field"><span>Höhe (m ü. M.)</span><input class="input" data-k="kopf.hoehe" inputmode="numeric" maxlength="4" value="' + esc(k.hoehe) + '"></label></div>' +
      (db.prefs.beitragConsent && !p.kursProbeId ? '<label class="toggle"><input type="checkbox" data-k="teilen"' + ((p.teilen != null ? p.teilen : db.prefs.beitragen) ? ' checked' : '') + '> <span>Diese Probe anonym für Auswertungen beitragen <span class="small muted">(ohne Namen, Betrieb, Parzelle, Notizen, Fotos)</span></span></label>' : '') +
      '<label class="field"><span>Notiz</span><textarea class="input" data-k="kopf.notiz" placeholder="Beobachtungen, Lagerung, Fütterung …">' + esc(k.notiz) + '</textarea></label>' +
      '<p class="hint">Personenbezogene Angaben (Betrieb, Name) nur erfassen, wenn die betroffene Person einverstanden ist.</p></div>') +
      q('Fotos', 'Futter und Laborbericht – bleiben auf diesem Gerät, ohne Standortdaten.', fotosHtml(p)) +
      q('Futterart', '', '<div class="opts cols3">' + Object.values(K3.TYPEN).map((t) => opt({ set: 'typ', val: t.id, on: p.typ === t.id, t: t.titel, s: t.quelle || 'AGFF ' + t.merkblatt })).join('') + '</div>');
  }

  function stepBestand(p) {
    const a = p.antworten;
    const groups = [['> 70 % Gräser', ['G', 'GR']], ['50–70 % Gräser', ['A', 'AR']], ['> 50 % Klee oder Kräuter', ['L', 'KF', 'KG']], ['Reinbestände', ['ITRG', 'LUZ']]];
    return q('Botanische Zusammensetzung', 'Bestimmen Sie den Anteil Gräser, Klee und Kräuter sowie den Raigras-Anteil und wählen Sie den passenden Wiesentyp.',
      (readOnly(p) ? '' : window.Wiese.bestandKnopf(p)) + groups.map(([g, ids]) => '<div class="section-title" style="margin-left:0">' + g + '</div><div class="opts cols-wide">' +
        ids.map((id) => { const b = K3.BESTAENDE.find((x) => x.id === id); const nl = window.LaborOCR.nelMitLabor(p, { bestand: id }); return opt({ set: 'bestand', val: id, on: a.bestand === id, lead: b.kurz, t: b.titel, s: b.text + (nl ? ' · ' + nl : '') }); }).join('') + '</div>').join('') +
      (window.LaborOCR.nelMitLabor(p, {}) ? '<p class="hint">Mit Laborgehalten (Rohprotein, Rohfaser/ADF) zeigt jede Option, welches NEL sich nach Grünem Buch ergäbe – so sehen Sie, wie stark die Deklaration wirkt.</p>' : ''));
  }

  function stepStadium(p) {
    const a = p.antworten;
    const avail = K3.verfuegbareStadien(basis && basis.tabelle, p.typ, a.aufwuchs || '1', a.bestand);
    let inner = '<div class="seg" style="margin-bottom:16px">' + [['1', '1. Aufwuchs'], ['f', 'Folgeaufwuchs']].map(([v, t]) => '<button data-set="aufwuchs" data-val="' + v + '" aria-pressed="' + (a.aufwuchs === v) + '">' + t + '</button>').join('') + '</div>';
    if (!a.aufwuchs) return q('Aufwuchs und Entwicklungsstadium', 'Zuerst den Aufwuchs wählen.', (readOnly(p) ? '' : window.Wiese.stadiumKnopf(p)) + inner);
    if (a.aufwuchs === '1') {
      const lp = Number(a.leitpflanze || 0);
      inner += '<p class="qhint">Stadium anhand der Haupt- bzw. Referenzpflanze bestimmen. Welche Pflanze dominiert?</p><div class="plant-chips">' +
        K3.REFERENZPFLANZEN.map((n, i) => '<button class="btn sm' + (lp === i ? ' primary' : '') + '" data-set="leitpflanze" data-val="' + i + '">' + n + '</button>').join('') + '</div><div class="opts">' +
        K3.STADIEN_ERSTER.map((row, i) => {
          const st = i + 1; const ok = !avail.length || avail.includes(st);
          const nl = window.LaborOCR.nelMitLabor(p, { stadium: String(st) });
          return ok ? opt({ set: 'stadium', val: String(st), on: String(a.stadium) === String(st), lead: st, t: row[lp], s: K3.REFERENZPFLANZEN.map((n, j) => j === lp ? '' : n.split(' /')[0] + ': ' + row[j]).filter(Boolean).join(' · ') + (nl ? ' · ' + nl : '') }) : '';
        }).join('') + '</div>';
    } else {
      const sug = K3.stadiumFolge(a.wochen, a.ueber600, a.herbst);
      const col = a.ueber600 ? ['3–4', '5–7', '8–9', '≥ 10'] : a.herbst ? ['3–4', '5–7', '8–9', '≥ 10'] : ['3', '4', '5–6', '7–8', '9–10'];
      inner += '<p class="qhint">Folgeaufwüchse werden über die Wochen seit dem letzten Schnitt bestimmt.</p>' +
        '<div class="grid2"><label class="field"><span>Wochen seit letztem Schnitt</span><div class="stepper"><button data-step="wochen" data-d="-1" aria-label="weniger">−</button><input inputmode="numeric" data-k="antworten.wochen" value="' + esc(a.wochen || '') + '" aria-label="Wochen"><button data-step="wochen" data-d="1" aria-label="mehr">+</button></div></label>' +
        '<div class="stack" style="margin-top:0"><label class="toggle"><input type="checkbox" data-k="antworten.ueber600"' + (a.ueber600 ? ' checked' : '') + '> über 600 m ü. M.</label>' +
        '<label class="toggle"><input type="checkbox" data-k="antworten.herbst"' + (a.herbst ? ' checked' : '') + '> Aufwuchs ab September</label></div></div><div class="opts" style="margin-top:14px">' +
        col.map((w, i) => {
          const st = i + 1; const ok = !avail.length || avail.includes(st);
          const nl = window.LaborOCR.nelMitLabor(p, { stadium: String(st) });
          return ok ? opt({ set: 'stadium', val: String(st), on: String(a.stadium) === String(st), cls: sug === st ? 'suggest' : '', lead: st, t: w + ' Wochen', s: (K3.STADIEN_FOLGE_HINWEIS[st] || '') + (nl ? ' · ' + nl : '') }) : '';
        }).join('') + '</div>';
    }
    if (!a.bestand) inner += '<p class="hint">Hinweis: Bestand noch nicht gewählt.</p>';
    const pl = window.Wiese.plausi(p); if (pl) inner += pl.html;
    if (!readOnly(p)) inner = window.Wiese.stadiumKnopf(p) + inner;
    return q('Aufwuchs und Entwicklungsstadium', '', inner);
  }

  function stepSauber(p) {
    const a = p.antworten;
    return q('Sauberkeit des Futters', 'Grünfutter auf Erde, Sand und Hofdüngerreste prüfen – Verschmutzung senkt den Nährwert und belastet die Tiere.',
      '<div class="opts">' + K3.K3B_SAUBERKEIT.map((s) => opt({ set: 'sauberkeit', val: s.id, on: a.sauberkeit === s.id, t: s.text, tag: s.k.nel ? s.k.nel + ' %' : '0 %', cls: s.k.nel ? 'warn' : '' })).join('') + '</div>') +
      '<p class="hint">Weitere Werte (Gehalte, Mineralstoffe) stammen aus der Agroscope-Tabelle für Grünfutter. Bei Laborwerten rechnet die App sie zusätzlich nach Grünem Buch nach.</p>';
  }
  function stepKultur(p) {
    const a = p.antworten; const ku = K3.GPS_KULTUREN.find((x) => x.id === a.kultur);
    const quelle = (k) => (k.quelle === 'agff' ? 'AGFF-Infoblatt K1 (Agroscope 2012–13)' : 'Richtwert aus v1 – nicht AGFF');
    return q('Kultur', 'Welche Getreideart bzw. welches Gemenge wurde siliert?', '<div class="opts cols-wide">' + K3.GPS_KULTUREN.map((k) => opt({ set: 'kultur', val: k.id, on: a.kultur === k.id, t: k.titel, s: 'NEL ' + fmt(k.w.nel, 1) + ' MJ · RP ' + k.w.rp + ' g · ' + quelle(k) + (k.text ? ' · ' + k.text : '') })).join('') + '</div>') +
      q('Stadium bei der Ernte', 'Ideal: die meisten Körner teigreif, die letzten milchreif; Stängel grün mit gelblicher Basis – etwa 3–4 Wochen nach der Blüte. Diese Phase dauert nur 3–4 Tage.', '<div class="opts">' + K3.GPS_STADIEN.map((st) => opt({ set: 'gpsStadium', val: st.id, on: a.gpsStadium === st.id, t: st.titel, s: st.text, tag: st.k.nel ? (st.k.nel > 0 ? '+' : '') + fmt(st.k.nel, 1) + ' MJ' : '' })).join('') + '</div>') +
      (ku && ku.gemenge ? '' : q('Leguminosenanteil', 'z. B. Futtererbsen im Getreide. Ein ausgewogenes Gemenge enthält höchstens ein Viertel Leguminosen (AGFF).', '<div class="opts cols-wide">' + K3.GPS_LEGUM.map((l) => opt({ set: 'leguminosen', val: l.id, on: (a.leguminosen || 'none') === l.id, t: l.titel, tag: l.anteil ? Math.round(l.anteil * 100) + ' % Erbsen-Werte' : '' })).join('') + '</div>')) +
      '<p class="hint">Gehalte nach AGFF-Infoblatt K1 (Agroscope-Analysen 2012–2013); NEV und APDN nach Grünem Buch berechnet. Leguminosen werden mit den AGFF-Werten der Futtererbsen eingemischt; die Stadiumskorrektur ist eine Näherung aus v1. Sorte, Jahr und Ernte führen zu deutlichen Schwankungen – Laboranalyse empfohlen.</p>';
  }
  function stepTsGras(p) {
    const a = p.antworten;
    return q('Sauberkeit des Futters', 'Probe auf Erde und Hofdüngerreste prüfen (Korrekturfaktor 1).',
      '<div class="opts">' + K3.K3B_SAUBERKEIT.map((s) => opt({ set: 'sauberkeit', val: s.id, on: a.sauberkeit === s.id, t: s.text, tag: s.k.nel ? s.k.nel + ' %' : '0 %', cls: s.k.nel ? 'warn' : '' })).join('') + '</div>') +
      q('TS-Gehalt – Auswringprobe', 'Probe wie einen Waschlappen auswinden; sehr nasse Silage nur als Kugel in der Hand ausdrücken (Korrekturfaktor 2).',
        '<div class="opts">' + K3.K3B_TS.map((t) => opt({ set: 'ts', val: t.id, on: a.ts === t.id, lead: t.ts.replace(' TS', ''), t: t.text, tag: p.typ === 'gras' && (t.k.nel || t.k.apde) ? 'NEL ' + t.k.nel + ' · APDE ' + (t.k.apde > 0 ? '+' : '') + t.k.apde + ' %' : '' })).join('') + '</div>');
  }

  function stepHaecksel(p) {
    const a = p.antworten;
    return K3.K3C_SCHRITTE.filter((s) => s.id !== 'ts').map((s) => q(s.titel, s.frage,
      '<div class="opts">' + s.optionen.map((o) => {
        const r = s.id === 'koerner' ? K3.k3cKoernerRating(o.id, a.ts) : o.r;
        return opt({ set: s.id, val: o.id, on: a[s.id] === o.id, t: o.text, tag: r || '', cls: r === 'ungenügend' ? 'warn' : '' });
      }).join('') + '</div>' + (s.id === 'koerner' ? '<p class="hint">Je reifer der Mais (über 36 % TS), desto feiner müssen die Körner aufbereitet sein. Auswaschmethode: Probe in Wasser rühren, schwimmende Teile absieben, Bodensatz beurteilen.</p>' : ''))).join('');
  }

  function stepTsMais(p) {
    const a = p.antworten;
    const ts = K3.K3C_SCHRITTE.find((s) => s.id === 'ts');
    return q('Trockensubstanz', ts.frage, '<div class="opts">' + ts.optionen.map((o) => opt({ set: 'ts', val: o.id, on: a.ts === o.id, lead: o.ts.replace(' %', ''), t: o.text, tag: o.r, cls: o.r === 'ungenügend' ? 'warn' : '' })).join('') + '</div>') +
      q('Kolbenanteil (Parzelleninfo)', 'Anteil Kolben an der Ganzpflanze.', '<div class="opts cols3">' + [['gt55', '> 55 %'], ['45', '45–55 %'], ['lt45', '< 45 %']].map(([v, t]) => opt({ set: 'kolben', val: v, on: a.kolben === v, t })).join('') + '</div>') +
      q('Ernte', 'Höhere Schnitthöhe oder «Powermais» erhöhen TS-Gehalt, Kolben- und Stärkeanteil.',
        '<div class="stack"><label class="toggle"><input type="checkbox" data-k="antworten.hoch"' + (a.hoch ? ' checked' : '') + '> Schnitthöhe über 50 cm</label><label class="toggle"><input type="checkbox" data-k="antworten.power"' + (a.power ? ' checked' : '') + '> «Powermais» (nur Kolben + oberer Pflanzenteil)</label></div>');
  }

  function phChart(a) {
    // Beziehung pH / TS (Nussbaum, LAZBW) – optimale Zone 30–40 % TS unter der Grenzlinie
    const W = 300, H = 170, x0 = 34, y0 = 10, w = 250, h = 130;
    const X = (ts) => x0 + ((ts - 20) / 30) * w; const Y = (ph) => y0 + ((5.4 - ph) / 1.8) * h;
    const line = (ts) => (ts >= 46 ? 5.0 : 4.0 + (ts - 20) * (1 / 26));
    const ts = (K3.K3B_TS.find((t) => t.id === a.ts) || {}).tsWert;
    let s = '<svg class="ph-chart" viewBox="0 0 ' + W + ' ' + H + '" font-size="8" font-family="system-ui" role="img" aria-label="Beziehung zwischen pH-Wert und TS-Gehalt">';
    s += '<path d="M' + X(30) + ' ' + Y(line(30)) + ' L' + X(40) + ' ' + Y(line(40)) + ' L' + X(40) + ' ' + Y(3.6) + ' L' + X(30) + ' ' + Y(3.6) + 'Z" fill="#9fd39a" opacity=".7"/>';
    for (let t = 20; t <= 50; t += 5) s += '<line x1="' + X(t) + '" x2="' + X(t) + '" y1="' + y0 + '" y2="' + (y0 + h) + '" stroke="currentColor" opacity=".12"/><text x="' + X(t) + '" y="' + (y0 + h + 11) + '" text-anchor="middle" fill="currentColor" opacity=".7">' + t + '</text>';
    for (let ph = 3.6; ph <= 5.41; ph += 0.4) s += '<line x1="' + x0 + '" x2="' + (x0 + w) + '" y1="' + Y(ph) + '" y2="' + Y(ph) + '" stroke="currentColor" opacity=".12"/><text x="' + (x0 - 4) + '" y="' + (Y(ph) + 3) + '" text-anchor="end" fill="currentColor" opacity=".7">' + ph.toFixed(1).replace('.', ',') + '</text>';
    s += '<polyline points="' + [20, 46, 50].map((t) => X(t) + ',' + Y(line(t))).join(' ') + '" fill="none" stroke="#d6312b" stroke-width="2.5"/>';
    s += '<text x="' + X(35) + '" y="' + Y(3.8) + '" text-anchor="middle" font-weight="700" fill="#24602b">optimal</text>';
    s += '<text x="' + X(23) + '" y="' + Y(5.0) + '" fill="currentColor" opacity=".75">schlechte Gärung</text><text x="' + X(41) + '" y="' + Y(3.9) + '" fill="currentColor" opacity=".75">gut, aber trocken</text>';
    s += '<text x="' + (x0 + w / 2) + '" y="' + (H - 2) + '" text-anchor="middle" fill="currentColor" opacity=".7">TS-Gehalt (%)</text>';
    if (ts && a.phWert) s += '<circle cx="' + X(Math.min(50, ts)) + '" cy="' + Y(Math.max(3.6, Math.min(5.4, a.phWert))) + '" r="6" fill="#0f7f74" stroke="#fff" stroke-width="2"/>';
    return s + '</svg>';
  }

  function stepRad(p) {
    const typ = K3.TYPEN[p.typ];
    const res = auswertung(p);
    const sel = res.auswahl;
    let fokusId = ui.fokus[p.id];
    if (!fokusId || !typ.rad.find((f) => f.id === fokusId)) fokusId = (typ.rad.find((f) => !sel[f.id]) || typ.rad[0]).id;
    ui.fokus[p.id] = fokusId;
    const f = typ.rad.find((x) => x.id === fokusId);
    const z = zentrum(p, res);
    const a = p.antworten;
    let factorCard = '<section class="q card"><div class="row" style="margin-bottom:6px"><span class="dot" style="background:' + f.farbe + ';width:14px;height:14px"></span><span class="small muted" style="font-weight:700">' + esc(f.gruppe.replace(/-/g, '')) + '</span></div>' +
      '<h3>' + esc(f.frage) + '</h3>' + (f.hilfe || f.mitte ? '<p class="qhint">' + esc(f.hilfe || f.mitte) + '</p>' : '');
    if (f.ph) {
      const auto = res.auswahl.ph && a.phWert;
      factorCard += '<label class="field"><span>Gemessener pH-Wert' + (p.typ === 'gras' || p.typ === 'gps' ? ' (Punkte abhängig vom TS-Gehalt)' : '') + '</span><div class="stepper"><button data-step="phWert" data-d="-0.1" aria-label="pH minus 0,1">−</button><input inputmode="decimal" data-k="antworten.phWert" value="' + esc(a.phWert != null ? String(a.phWert).replace('.', ',') : '') + '" placeholder="z. B. 4,3" aria-label="pH-Wert"><button data-step="phWert" data-d="0.1" aria-label="pH plus 0,1">+</button></div></label>' +
        ((p.typ === 'gras' || p.typ === 'gps') && !a.ts ? '<p class="hint">Für die pH-Punkte zuerst den TS-Gehalt bestimmen (Schritt «Sauberkeit & TS»).</p>' : '') +
        (auto ? '<div class="live">→ ' + res.auswahl.ph.slice(1) + ' Punkte für das Rad</div>' : '') +
        (p.typ === 'gras' || p.typ === 'gps' ? '<div style="margin-top:12px">' + phChart(a) + '</div>' : '') +
        '<p class="qhint" style="margin-top:12px">Ohne Messgerät oder Messwert: Stufe direkt wählen.</p>';
    }
    factorCard += '<div class="opts">' + f.optionen.map((o) => opt({ set: 'rad.' + f.id, val: o.id, on: sel[f.id] === o.id, lead: o.kurz === '!' ? '!' : (p.typ === 'heu' ? (o.kurz === '0' ? '0' : o.kurz + '%') : o.kurz), cls: o.block ? 'warn' : '',
      t: esc(p.typ === 'heu' ? o.text.split(/: | – /)[0] : o.text), s: esc(p.typ === 'heu' ? (o.text.split(/: | – /).slice(1).join(' – ') + (o.block ? ' → ' + o.block : (o.k.nel || o.k.apde ? ' → NEL/NEV ' + o.k.nel + ' %, APDE ' + o.k.apde + ' %, APDN ' + o.k.apdn + ' %' : ''))) : '') })).join('') + '</div></section>';
    const nav = '<div class="factor-nav">' + typ.rad.map((x) => {
      const o = sel[x.id] && x.optionen.find((y) => y.id === sel[x.id]);
      return '<button data-fokus="' + x.id + '" aria-current="' + (x.id === fokusId) + '"><span class="sw" style="background:' + x.farbe + '">' + (o ? (o.kurz === '–' ? '–' : '✓') : '') + '</span>' + esc((x.gruppe === 'Feldbedingungen' || x.gruppe === 'Sauberkeit' ? x.optionen[0].mitte : x.gruppe).replace(/-/g, '')) + '</button>';
    }).join('') + '</div>';
    const live = '<div class="live"><span class="dot" style="background:' + (Rad.TON[z.ton] || Rad.TON.offen) + ';width:14px;height:14px"></span><span class="grow">' + esc(res.sperre.length ? 'Nicht verfüttern' : (z.ton === 'offen' ? 'Noch keine Angaben' : res.klasse ? res.klasse.label : '')) + '</span><span class="muted small">' + esc(z.wert + ' ' + (z.label || '')) + '</span></div>';
    return '<div class="rad-layout"><div class="rad-sticky"><div class="rad-box" id="radbox">' + wheelSvg(p, res, { interaktiv: true, fokus: fokusId }) + '</div>' + live +
      '<p class="hint">Tipp: Faktor im Rad antippen – er dreht sich nach oben und wird gross; dann die passende Ausprägung antippen. Oder unten in Ruhe auswählen.</p></div>' +
      '<div>' + nav + factorCard + '</div></div>';
  }

  /** Mastpotenzial Muni: Zuwachs, den Energie bzw. Protein erlauben – das kleinere begrenzt. */
  function mastCard(p, res) {
    const m = mastOf(p, res);
    if (!m) return '';
    const vals = [['NEV', m.tzwE, 'Energie'], ['APD', m.tzwP, 'Protein (' + m.apdQuelle + ')']];
    const max = Math.max(1600, ...vals.map((v) => v[1] || 0));
    return '<div class="card tier-kasten"><div class="row"><b class="grow">Mastpotenzial Muni</b><span class="kpi-inline"><b style="font-size:1.5rem">' +
      (m.tzw == null ? '–' : fmt(Math.round(m.tzw / 10) * 10, 0)) + '</b> g/Tag</span></div>' +
      (m.tzw == null ? '<div class="alert info" style="margin-top:8px">Dieses Futter allein deckt nicht einmal den Erhaltungsbedarf (' + (m.limit === 'APD' ? 'Protein' : 'Energie') + ') – Ergänzung nötig.</div>' : '') +
      '<div class="bars" style="margin-top:10px">' + vals.map(([k, v, t]) => '<div class="b" style="cursor:default" title="' + t + '"><span class="lbl">' + k + (k === m.limit ? ' · begrenzt' : '') + '</span><span class="track"><span class="val" style="width:' + Math.max(0, Math.min(100, ((v || 0) / max) * 100)) + '%;background:' + (k === m.limit ? 'var(--schlecht)' : 'var(--line-strong)') + '"></span></span><span class="n">' + (v == null ? '< Erh.' : fmt(Math.round(v / 10) * 10, 0)) + '</span></div>').join('') + '</div>' +
      '<p class="small muted" style="margin:8px 0 0">Tageszuwachs (g), den ein Muni von ' + m.lebendgewicht + ' kg allein mit diesem Futter erreichen könnte – ' + verzehrText(m, 'Grünes Buch Kap. 10') + ', Bedarf nach Agroscope (Grünes Buch, Kap. 10). ' +
      'Hinweis: Agroscope-Versuche zeigen, dass der Energiebedarf moderner Mastmuni damit um rund 20 % überschätzt wird; reale Zunahmen dürften eher höher liegen.</p>' + tierKnopf(p, 'mast', m.lebendgewicht) + '</div>';
  }

  /** Milchbildungspotenzial: alle drei Grenzen zeigen, die begrenzende hervorheben. */
  function mppCard(p, res) {
    const m = p.typ === 'mais' ? null : mppOf(p, res);
    if (!m) return '';
    const vals = [['NEL', m.nel, 'Energie'], ['APDE', m.apde, 'Protein (Energie im Pansen)'], ['APDN', m.apdn, 'Protein (Stickstoff im Pansen)']];
    const max = Math.max(30, ...vals.map((v) => v[1]));
    return '<div class="card tier-kasten"><div class="row"><b class="grow">Milchbildungspotenzial</b><span class="kpi-inline"><b style="font-size:1.5rem">' + fmt(m.mpp, 1) + '</b> kg/Tag</span></div>' +
      '<div class="bars" style="margin-top:10px">' + vals.map(([k, v, t]) => '<div class="b" style="cursor:default" title="' + t + '"><span class="lbl">' + k + (k === m.limit ? ' · begrenzt' : '') + '</span><span class="track"><span class="val" style="width:' + Math.max(0, Math.min(100, (v / max) * 100)) + '%;background:' + (k === m.limit ? 'var(--schlecht)' : 'var(--line-strong)') + '"></span></span><span class="n">' + fmt(Math.max(0, v), 1) + '</span></div>').join('') + '</div>' +
      '<p class="small muted" style="margin:8px 0 0">Milch (kg/Tag), die eine Kuh von ' + m.kuhGewicht + ' kg allein mit diesem Futter bilden könnte – ' + verzehrText(m, 'geschätzt aus NEL, Merkblatt 3') + ', Bedarf nach Agroscope, wie Futterwert-Rechner v1. Der kleinste der drei Werte begrenzt; ergänzende Futtermittel können ihn ausgleichen.</p>' + tierKnopf(p, 'kuh', m.kuhGewicht) + '</div>';
  }

  function stepErgebnis(p) {
    const res = auswertung(p);
    const L = label(p, res);
    const ton = tonOf(res);
    const w = res.werte; const b = (p.typ === 'gps' ? res.erwartet : res.basis) || {};
    let h = '';
    if (!res.vollstaendig) h += '<div class="alert info" style="margin-bottom:12px">' + I.warn + '<div><b>Noch offen:</b> ' + esc(res.fehlend.join(', ')) + '</div></div>';
    [...new Set(res.sperre)].forEach((s) => { h += '<div class="alert kritisch" style="margin-bottom:12px">' + I.warn + '<div>' + esc(s) + '</div></div>'; });
    h += '<div class="hero ' + ton + '"><span class="k">' + esc(K3.TYPEN[p.typ].titel + ' · ' + (K3.TYPEN[p.typ].quelle || 'AGFF ' + K3.TYPEN[p.typ].merkblatt)) + '</span><span class="v">' + esc(res.sperre.length ? 'Nicht verfüttern' : res.klasse ? res.klasse.label : 'Unvollständig') + '</span><span>' + esc(L.klasseSub) + '</span></div>';
    if (w) {
      const kp = p.typ === 'mais' || p.typ === 'gps' ? ['nel', 'nev', 'apde', 'staerke'] : ['nel', 'apde', 'apdn', 'nev'];
      h += '<div class="kpis" style="margin-top:14px">' + kp.map((m) => {
        const [lab, unit] = K3.METRIK_LABEL[m]; const d = m === 'nel' || m === 'nev' ? 2 : 0;
        const diff = b[m] != null && w[m] != null ? w[m] - b[m] : 0;
        return '<div class="kpi"><div class="l">' + lab + '</div><div class="v">' + fmt(w[m], d) + ' <small>' + unit + '</small></div><div class="d ' + (diff < -0.004 ? 'neg' : diff > 0.004 ? 'pos' : 'muted') + '">' +
          (Math.abs(diff) > 0.004 ? (diff > 0 ? '+' : '') + fmt(diff, d) + ' ggü. ' + (p.typ === 'mais' ? 'Ausgang' : p.typ === 'gps' ? 'Richtwert' : 'Tabelle') : 'keine Korrektur') + '</div></div>';
      }).join('') + '</div>';
      if (w.nel) {
        const pos = (v) => Math.max(0, Math.min(100, ((v - 4) / 3.5) * 100));
        h += '<div class="card" style="margin-top:14px"><div class="row"><b class="grow">Energie (NEL) im Vergleich</b><span class="chip ' + (res.zielErreicht ? 'gut' : 'schlecht') + '">' + (res.zielErreicht ? 'Ziel erreicht' : 'unter Ziel') + '</span></div>' +
          '<div class="gauge">' + (b.nel ? '<span class="mk ghost" style="left:' + pos(b.nel) + '%" title="Tabellenwert"></span>' : '') + '<span class="mk" style="left:' + pos(w.nel) + '%"></span>' +
          (res.ziel && res.ziel.nel ? '<span class="tg" style="left:' + pos(res.ziel.nel) + '%">Ziel ' + fmt(res.ziel.nel, 1) + '</span>' : '') + '<span class="tg" style="left:0;transform:none">4,0</span><span class="tg" style="left:100%;transform:translateX(-100%)">7,5 MJ</span></div>' +
          '<p class="small muted" style="margin:6px 0 0">' + esc(K3.TYPEN[p.typ].ziel) + '</p></div>' + tierUmschalter(p, res);
      }
    }
    h += '<div class="rad-layout" style="margin-top:14px"><div><div class="rad-box"><a href="#/p/' + p.id + '/rad" aria-label="Rad bearbeiten">' + wheelSvg(p, res) + '</a></div></div><div class="card"><h3>Befunde</h3>' +
      L.befunde.map((f) => '<div class="rating"><div><div class="small muted" style="font-weight:700">' + esc(f.k) + '</div><div>' + esc(f.v || '–') + '</div></div>' + (f.v2 ? '<span class="chip ' + (f.ton || '') + '" style="align-self:center">' + esc(f.v2) + '</span>' : '') + '</div>').join('') + '</div></div>';
    if (w) {
      h += '<div class="section-title">Nährwerte pro kg TS</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Einheit</th><th>' + L.basisLabel + '</th><th>Korr.</th><th>Schätzung</th></tr></thead><tbody>' +
        L.tabelle.map((r) => '<tr><td>' + (r.key ? '<strong>' + esc(r.label) + '</strong>' : esc(r.label)) + '</td><td class="muted">' + esc(r.unit) + '</td><td class="muted">' + r.basis + '</td><td class="' + (String(r.korr).startsWith('-') || String(r.korr).startsWith('−') ? 'd neg' : r.korr !== '–' ? 'd pos' : 'muted') + '">' + r.korr + '</td><td><strong>' + r.wert + '</strong></td></tr>').join('') + '</tbody></table></div>' +
        '<p class="hint">Nährwerte: Agroscope; ' + (K3.TYPEN[p.typ].quelle || 'Schlüssel AGFF ' + K3.TYPEN[p.typ].merkblatt) + '. Sensorische Schätzung – ersetzt keine Laboranalyse.</p>';
    }
    if ((p.fotos || []).length || !readOnly(p)) h += '<div class="section-title">Fotos</div>' + fotosHtml(p);
    // Laborbericht: Import erst nach vollständiger eigener Beurteilung (keine Beeinflussung)
    h += '<div class="section-title">Laborbericht</div>';
    if (p.labor && Object.keys(p.labor).length && (res.vollstaendig || readOnly(p))) h += window.LaborOCR.vergleichHtml(p, res);
    else if (!res.vollstaendig) h += '<div class="alert info">' + I.lock + '<div>Laborwerte können Sie importieren, sobald Ihre eigene Beurteilung vollständig ist – so vergleichen Sie unbeeinflusst.</div></div>';
    else if (!readOnly(p)) h += '<div class="card"><div class="row"><span class="grow small">Haben Sie einen Laborbericht? Lesen Sie ihn ein (PDF oder Foto) und vergleichen Sie Ihre Schätzung.</span><button class="btn primary" data-act="labor-import" data-id="' + p.id + '">Laborwerte importieren</button></div></div>';
    h += window.Statistik.vergleichHtml(p);
    h += window.Kurs.ergebnisExtra(p);
    h += '<div class="row" style="margin-top:18px"><button class="btn primary" data-act="pdf-probe" data-id="' + p.id + '">' + I.pdf + ' PDF mit QR-Code</button><button class="btn" data-act="qr-probe" data-id="' + p.id + '">' + I.share + ' QR / Link</button><button class="btn ghost" data-act="dup-probe" data-id="' + p.id + '">Kopie als neue Probe</button></div>';
    return h;
  }

  // ---------- Übersicht Anlass ----------
  function renderUebersicht(aid) {
    const a = aid ? anlassById(aid) : null;
    if (a && a.kurs) return window.Kurs.renderUebersicht(a);
    const list = probenOf(aid);
    const items = list.map((p) => ({ p, res: auswertung(p) }));
    const back = '<a class="icon-btn back-btn hide-tablet" href="#/' + (a ? 'a/' + a.id : 'e') + '" aria-label="Zurück">' + I.back + '</a>';
    let h = '<div class="bar">' + back + '<h2>Übersicht' + '<span class="sub">' + esc(a ? a.titel : 'Einzelproben') + '</span></h2>' +
      '<button class="btn sm" data-act="pdf-anlass" data-id="' + (aid || '') + '"' + (list.length ? '' : ' disabled') + '>' + I.pdf + ' PDF</button></div><div class="pad">';
    if (!list.length) return h + '<div class="empty">Noch keine Proben in diesem ' + (a ? 'Anlass' : 'Bereich') + '.<br><br><button class="btn primary" data-act="new-probe" data-anlass="' + (aid || '') + '">' + I.plus + ' Probe hinzufügen</button></div></div>';
    const withW = items.filter((x) => x.res.werte && x.res.werte.nel);
    const avg = (m) => (withW.length ? withW.reduce((s, x) => s + (x.res.werte[m] || 0), 0) / withW.length : null);
    const ziel = withW.filter((x) => x.res.zielErreicht).length;
    const sperren = items.filter((x) => x.res.sperre.length).length;
    h += '<div class="kpis"><div class="kpi"><div class="l">Proben</div><div class="v">' + list.length + '</div><div class="d muted">' + items.filter((x) => x.res.vollstaendig).length + ' vollständig</div></div>' +
      '<div class="kpi"><div class="l">Ø NEL</div><div class="v">' + fmt(avg('nel'), 2) + ' <small>MJ</small></div><div class="d muted">Ø APDE ' + fmt(avg('apde'), 0) + ' g</div></div>' +
      '<div class="kpi"><div class="l">Ziel erreicht</div><div class="v">' + ziel + '<small> / ' + withW.length + '</small></div><div class="d muted">NEL-Zielwert je Futterart</div></div>' +
      '<div class="kpi"><div class="l">Nicht verfüttern</div><div class="v" style="color:' + (sperren ? 'var(--kritisch)' : 'inherit') + '">' + sperren + '</div><div class="d muted">Proben mit Sperrvermerk</div></div></div>';
    // Balken
    const pos = (v) => Math.max(0, Math.min(100, ((v - 4) / 3.5) * 100));
    h += '<div class="ov-grid" style="margin-top:16px"><div class="card"><div class="row" style="margin-bottom:10px"><b class="grow">Energie NEL je Probe</b><span class="legend"><span><i class="dot" style="background:var(--line-strong)"></i>Tabellenwert</span><span><i class="dot" style="background:var(--gut)"></i>Schätzung</span><span>│ Ziel</span></span></div><div class="bars">' +
      items.map(({ p, res }) => {
        const w = res.werte; const b = res.basis;
        return '<div class="b" data-go="#/p/' + p.id + '/ergebnis" title="' + esc(titelOf(p)) + '"><span class="lbl">' + esc(titelOf(p)) + '</span><span class="track">' +
          (b && b.nel ? '<span class="base" style="width:' + pos(b.nel) + '%"></span>' : '') + (w && w.nel ? '<span class="val" style="width:' + pos(w.nel) + '%;background:' + Rad.TON[tonOf(res)] + '"></span>' : '') +
          (res.ziel && res.ziel.nel ? '<span class="target" style="left:' + pos(res.ziel.nel) + '%"></span>' : '') + '</span><span class="n">' + (w && w.nel ? fmt(w.nel, 2) : '–') + '</span></div>';
      }).join('') + '</div><div class="row small muted" style="justify-content:space-between;margin:4px 0 0 calc(min(140px, 30%) + 10px);padding-right:62px"><span>4,0</span><span>5,0</span><span>6,0</span><span>7,0</span></div></div>' +
      '<div class="card"><b>Beurteilungsräder</b><div class="wheels" style="margin-top:10px">' + items.map(({ p, res }) => '<a href="#/p/' + p.id + '/ergebnis">' + wheelSvg(p, res) + '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(titelOf(p)) + '</div></a>').join('') + '</div></div></div>';
    // Tabelle
    const cols = [['titel', 'Probe'], ['typ', 'Futter'], ['bs', 'Bestand/Stadium'], ['klasse', 'Beurteilung'], ['pkt', 'Pkt./Korr.'], ['nel', 'NEL'], ['apde', 'APDE'], ['apdn', 'APDN'], ['rp', 'RP'], ['mpp', 'Milch*'], ['mast', 'Mast**']];
    const rows = items.map(({ p, res }) => {
      const w = res.werte || {}; const mp = p.typ === 'mais' ? null : mppOf(p, res); const ms = mastOf(p, res);
      return { p, res, titel: titelOf(p), typ: K3.TYPEN[p.typ].kurz, bs: bestandStadium(p), klasse: res.sperre.length ? 'Nicht verfüttern' : (res.klasse ? res.klasse.label : ''),
        pkt: p.typ === 'heu' ? (res.korr ? res.korr.nel : null) : res.punkte, nel: w.nel, apde: w.apde, apdn: w.apdn, rp: w.rp, mpp: mp ? mp.mpp : null, mast: ms ? (ms.tzw == null ? -1 : ms.tzw) : null };
    });
    const { k, dir } = ui.sort;
    rows.sort((x, y) => { const A = x[k], B = y[k]; if (A == null) return 1; if (B == null) return -1; return (A > B ? 1 : A < B ? -1 : 0) * dir; });
    h += '<div class="section-title">Alle Werte</div><div class="tbl-wrap"><table class="tbl"><thead><tr>' + cols.map(([c, t]) => '<th><button data-sort="' + c + '">' + t + (k === c ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr class="click typ-' + r.p.typ + '" data-go="#/p/' + r.p.id + '/ergebnis"><td><strong>' + esc(r.titel) + '</strong></td><td>' + typBadge(r.p.typ) + ' ' + esc(r.typ) + '</td><td>' + esc(r.bs) + '</td><td><span class="chip ' + tonOf(r.res) + '">' + esc(r.klasse || 'offen') + '</span></td><td>' +
        (r.pkt == null ? '–' : r.p.typ === 'heu' ? fmt(r.pkt, 0) + ' %' : r.pkt) + '</td><td><strong>' + fmt(r.nel, 2) + '</strong></td><td>' + fmt(r.apde, 0) + '</td><td>' + fmt(r.apdn, 0) + '</td><td>' + fmt(r.rp, 0) + '</td><td>' + fmt(r.mpp, 1) + '</td><td>' + (r.mast == null ? '–' : r.mast < 0 ? '< Erh.' : fmt(Math.round(r.mast / 10) * 10, 0)) + '</td></tr>').join('') +
      '</tbody></table></div><p class="hint">* Milchbildungspotenzial aus dem Grundfutter allein (kg/Tag, Kuh ' + db.prefs.kuhGewicht + ' kg) – wie im Futterwert-Rechner v1. ** Tageszuwachs Muni ' + mastGewicht() + ' kg in g (Agroscope, Grünes Buch Kap. 10). Grau schraffiert = Tabellenwert vor Abzügen.</p></div>';
    return h;
  }

  // ---------- Daten & Datenschutz ----------
  function renderDaten() {
    const bytes = new Blob([localStorage.getItem(STORE_KEY) || '']).size;
    const v1local = (() => { try { return JSON.parse(localStorage.getItem('agffLocalSavedProbes') || '[]').length; } catch (e) { return 0; } })();
    const spaces = db.anlaesse.filter((a) => a.space);
    return '<div class="bar"><a class="icon-btn back-btn hide-wide" href="#/" aria-label="Zurück">' + I.back + '</a><h2>Daten & Datenschutz</h2></div><div class="wizard">' +
      q('Wo liegen meine Daten?', '', '<div class="card stack"><p style="margin:0">Alle Anlässe und Proben werden <b>nur in diesem Browser</b> auf diesem Gerät gespeichert (' + fmt(bytes / 1024, 1) + ' kB). Es gibt kein Konto und kein Tracking.</p>' +
        '<p class="small muted" style="margin:0">Achtung: Wenn Sie die Browserdaten löschen oder ein anderes Gerät verwenden, sind die Daten dort nicht vorhanden. Sichern Sie wichtige Beurteilungen als PDF – die PDF enthält alle Eingaben und kann wieder importiert werden.</p>' +
        (spaces.length ? '<p class="small" style="margin:0"><b>' + spaces.length + ' Anlass/Anlässe</b> haben Sie mit Ihrer Zustimmung zusätzlich auf dem Server gespeichert: ' + spaces.map((a) => esc(a.titel)).join(', ') + '. Löschen über das Menü des Anlasses.</p>' : '') +
        '<a href="' + esc(CFG.privacyUrl) + '" target="_blank" rel="noopener">Datenschutzerklärung</a></div>') +
      q('Sicherung', 'Komplette Sicherung aller Daten als Datei – z. B. für den Gerätewechsel.', '<div class="row"><button class="btn" data-act="backup">Sicherung herunterladen (JSON)</button><button class="btn" data-act="import">' + I.upload + ' PDF/JSON importieren</button></div>') +
      q('Anonym beitragen und vergleichen', 'Proben mit PLZ anonym für Auswertungen und Publikationen beitragen – und im Gegenzug sehen, wie Ihre Proben im Vergleich zur Region abschneiden. Ohne Namen, Betrieb, Parzelle, Notizen und Fotos; jederzeit widerrufbar.',
        db.prefs.beitragen && db.prefs.beitragConsent ? '<div class="row"><span class="chip gut">eingeschaltet</span><span class="small muted grow">' + db.proben.filter((x) => x.beitrag).length + ' Proben beigetragen</span><button class="btn danger sm" data-act="beitrag-aus">Ausschalten und alle zurückziehen</button></div>'
          : '<button class="btn" data-act="beitrag-ein">Anonym beitragen einschalten …</button>') + '<p style="margin:10px 0 0"><a href="#/schweiz">Auswertung Schweiz ansehen (Karte, Höhenzonen) →</a></p>' +
      q('Daten aus der bisherigen Version (v1)', 'Wiesenfutter (Grünfutter, Grassilage, Dürrfutter), Silomais und Ganzpflanzensilage werden übernommen; die Sensorik von v1 hatte teilweise andere Skalen und wird als «bitte prüfen» markiert. Die v1-Daten selbst bleiben unverändert.',
        '<div class="row"><button class="btn" data-act="v1-local"' + (v1local ? '' : ' disabled') + '>' + v1local + ' lokal gespeicherte v1-Proben übernehmen</button><button class="btn" data-act="v1-server">Meine Proben vom v1-Server laden …</button></div>') +
      q('Einstellungen', '', '<div class="grid2"><label class="field"><span>Mein Name (Vorschlag für «Beurteilt von»)</span><input class="input" data-pref="beurteiler" value="' + esc(db.prefs.beurteiler) + '"></label>' +
        '<label class="field"><span>Gewicht Referenzkuh (kg)</span><input class="input" inputmode="numeric" data-pref="kuhGewicht" value="' + esc(db.prefs.kuhGewicht) + '"></label>' +
        '<label class="field"><span>Gewicht Mastmuni (kg, ' + K3.MAST.LG_MIN + '–' + K3.MAST.LG_MAX + ')</span><input class="input" inputmode="numeric" data-pref="mastGewicht" value="' + esc(mastGewicht()) + '"></label></div>' +
        (window.Assistent ? '<div class="row" style="margin-top:12px;align-items:center"><span class="grow"><b>Traktor-Assistent</b><br><span class="small muted">Hilft bei Stadium, TS und jedem Faktor im Rad</span></span>' +
          '<div class="seg">' + [['an', 'Aktiv'], ['ruhe', 'Schläft']].map(([v, t]) => '<button data-act="assist-ruhe" data-val="' + v + '" aria-pressed="' + ((window.Assistent.ruhe ? 'ruhe' : 'an') === v) + '">' + t + '</button>').join('') + '</div>' +
          '<div class="seg">' + [['einfach', 'Einfach'], ['fachlich', 'Fachlich']].map(([v, t]) => '<button data-act="assist-stufe" data-val="' + v + '" aria-pressed="' + (window.Assistent.stufe === v) + '">' + t + '</button>').join('') + '</div>' +
          '<button class="btn sm ghost" data-act="assist-reset">Alle Hilfen nochmals zeigen</button></div>' : '') +
        '<div class="seg" style="margin-top:12px">' + [['', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, t]) => '<button data-act="theme" data-val="' + v + '" aria-pressed="' + ((document.documentElement.dataset.theme || '') === v) + '">' + t + '</button>').join('') + '</div>') +
      q('Alles löschen', 'Entfernt alle v2-Daten aus diesem Browser. Auf dem Server gespeicherte Anlässe bleiben bestehen, bis Sie sie dort löschen.', '<button class="btn danger" data-act="wipe">Alle lokalen Daten löschen</button>') +
      '<p class="small muted">Version ' + esc(CFG.version) + ' · Grundlage: AGFF-Merkblätter K3a (2022), K3b (2023), K3c (2021); Nährwerte Agroscope.</p></div>';
  }

  // ---------- Nach dem Rendern ----------
  function afterRender() {
    // Neuer Schritt / neue Seite: oben beginnen
    if (location.hash !== lastHash) { lastHash = location.hash; window.scrollTo(0, 0); $('#main').scrollTop = 0; }
    fotosEinsetzen();
    if (['wiese', 'fotopunkte', 'pflanzen', 'hilfe', 'daten'].includes(ui.route.name)) window.Wiese.nachRender();
    appMini(); listeGriff();
    if (window.Assistent) window.Assistent.update();
    if (ui.route.sammel && window.Sammel) window.Sammel.verdrahten();
    Rad.animieren($('#radbox'));
    naechstesMarkieren();
  }

  // ---------- Sheets / Toast ----------
  function toast(msg) {
    const t = $('#toast'); t.innerHTML = '<div class="t">' + esc(msg) + '</div>';
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.innerHTML = ''; }, 2600);
  }
  function sheet(html, onMount) {
    const root = $('#sheet-root');
    root.innerHTML = '<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true">' + html + '</div></div>';
    const el = root.querySelector('.sheet');
    const first = el.querySelector('input, button, select, textarea'); if (first) setTimeout(() => first.focus(), 30);
    if (onMount) onMount(el);
    return el;
  }
  const closeSheet = () => { $('#sheet-root').innerHTML = ''; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  function sheetNewProbe(anlassId) {
    const colors = Object.fromEntries(Object.values(K3.TYPEN).map((t) => [t.id, t.farbe]));
    sheet('<h2>Was beurteilen Sie?</h2><p class="muted small" style="margin-top:0">Gewählter Anlass: <b>' + esc(anlassId ? anlassById(anlassId).titel : 'ohne Anlass') + '</b></p><div class="typ-cards">' +
      Object.values(K3.TYPEN).map((t) => '<button class="typ-card" data-act="create-probe" data-typ="' + t.id + '" data-anlass="' + (anlassId || '') + '"><span class="ico" style="background:' + colors[t.id] + ';color:#1d2925">' + t.merkblatt + '</span><span><b>' + t.titel + '</b><span class="small muted">' + esc(t.ziel) + '</span></span></button>').join('') +
      '</div><button class="btn ghost block" data-close style="margin-top:10px">Abbrechen</button>');
  }

  function sheetAnlass(a, nachSpeichern) {
    const isNew = !a;
    a = a || { titel: '', datum: new Date().toISOString().slice(0, 10), ort: '', notiz: '' };
    sheet('<h2>' + (isNew ? 'Neuer Anlass' : 'Anlass bearbeiten') + '</h2><form id="anlassForm" class="stack">' +
      '<label class="field"><span>Titel *</span><input class="input" name="titel" required value="' + esc(a.titel) + '" placeholder="z. B. Silage-Kurs Rütti, Betriebsbesuch Muster"></label>' +
      '<div class="grid2"><label class="field"><span>Datum</span><input class="input" type="date" name="datum" value="' + esc(a.datum) + '"></label><label class="field"><span>Ort</span><input class="input" name="ort" value="' + esc(a.ort) + '"></label></div>' +
      '<label class="field"><span>Notiz</span><textarea class="input" name="notiz">' + esc(a.notiz) + '</textarea></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">' + (isNew ? 'Anlegen' : 'Speichern') + '</button></div></form>', (el) => {
      el.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const target = isNew ? { id: uid(), createdAt: now() } : a;
        Object.assign(target, { titel: String(fd.get('titel')).trim(), datum: fd.get('datum'), ort: String(fd.get('ort')).trim(), notiz: String(fd.get('notiz')).trim(), updatedAt: now() });
        if (isNew) db.anlaesse.push(target); else if (target.space) { target.space.metaDirty = true; scheduleSync(target); }
        save(); closeSheet(); go('#/a/' + target.id);
        if (nachSpeichern) nachSpeichern();
      });
    });
  }

  function sheetAnlassMenu(a) {
    const ro = a.space && a.space.mode === 'r';
    sheet('<h2>' + esc(a.titel) + '</h2><div class="stack">' +
      (ro ? '<div class="alert info">' + I.lock + '<div>Geöffnet über einen <b>Nur-Ansehen-Link</b>. Ändern ist nicht möglich.</div></div>' : '<button class="btn block" data-act="edit-anlass" data-id="' + a.id + '">Bearbeiten</button>') +
      (ro ? '' : '<button class="btn block" data-go="#/a/' + a.id + '/sammel">' + I.table + ' Sammelerfassung (wie Ernterapport)</button>') +
      '<button class="btn block" data-act="bilanz-anlass" data-id="' + a.id + '">Rationscheck mit diesen Proben</button>' +
      '<button class="btn block" data-act="pdf-anlass" data-id="' + a.id + '">' + I.pdf + ' PDF aller Proben (mit QR-Codes)</button>' +
      '<button class="btn block" data-act="export-anlass" data-id="' + a.id + '">Als JSON-Datei exportieren</button>' +
      (a.space ? '<button class="btn block" data-act="share-space" data-id="' + a.id + '">' + I.share + ' Freigabe-Links fürs Büro / Team</button><button class="btn block" data-act="sync-now" data-id="' + a.id + '">Jetzt synchronisieren</button>' +
        (ro ? '' : '<button class="btn block" data-act="space-rotate" data-id="' + a.id + '">' + I.lock + ' Links erneuern (alte Links sperren)</button><button class="btn danger block" data-act="space-delete" data-id="' + a.id + '">Vom Server löschen (lokal behalten)</button>')
        : '<button class="btn block" data-act="consent" data-id="' + a.id + '">' + I.cloud + ' Auf Server speichern & teilen …</button>') +
      '<button class="btn danger block" data-act="delete-anlass" data-id="' + a.id + '">' + (a.space ? 'Von diesem Gerät entfernen' : 'Anlass löschen') + '</button>' +
      '<button class="btn ghost block" data-close>Schliessen</button></div>');
  }

  function sheetProbeMenu(p) {
    const ro = readOnly(p);
    sheet('<h2>' + esc(titelOf(p)) + '</h2><div class="stack">' + window.Auswahl.knopf({ art: 'probe', id: p.id, titel: titelOf(p) }, true) +
      '<button class="btn block" data-act="pdf-probe" data-id="' + p.id + '">' + I.pdf + ' PDF mit QR-Code</button>' +
      '<button class="btn block" data-act="qr-probe" data-id="' + p.id + '">' + I.share + ' QR-Code / Link zum Weitergeben</button>' +
      '<button class="btn block" data-act="dup-probe" data-id="' + p.id + '">Kopie als neue Probe' + (ro ? ' (ohne Anlass)' : '') + '</button>' +
      (ro ? '' : '<button class="btn danger block" data-act="delete-probe" data-id="' + p.id + '">Probe löschen</button>') +
      '<button class="btn ghost block" data-close>Schliessen</button></div>');
  }

  // ---------- Zustimmung / Server (Zugriff per Link) ----------
  const C = window.FutterCrypto;
  const spaceKeys = new Map(); // anlassId → abgeleitete Schlüssel (nur im Speicher)
  async function keysFor(a) {
    const cached = spaceKeys.get(a.id);
    if (cached && cached.secret === a.space.secret) return cached.k;
    const k = await C.keys(a.space.mode, a.space.secret);
    spaceKeys.set(a.id, { secret: a.space.secret, k });
    return k;
  }
  const readH = (k) => ({ 'X-Read-Token': k.readToken });
  const writeH = (k) => ({ 'X-Write-Token': k.writeToken });

  /** Verpackt eine Probe bzw. die Anlass-Angaben: «analyse» (anonym auswertbar) und «privat» (Personenbezogenes). */
  async function sealProbe(k, sid, p) {
    const { analyse, privat } = Model.split(p, 'probe');
    delete analyse.anlassId;
    if (privat.fotos) privat.fotos = privat.fotos.map((f) => { const c = Object.assign({}, f); delete c.up; return c; });
    void k; void sid;
    return { analyse, privat: Object.keys(privat).length ? privat : null };
  }
  async function sealMeta(k, sid, a) {
    const { analyse, privat } = Model.split({ id: 'anlassmeta', titel: a.titel, datum: a.datum, ort: a.ort, notiz: a.notiz }, 'anlass');
    void k; void sid;
    return { analyse, privat };
  }
  async function openRecord(k, sid, r) {
    const privat = await C.lesbar(k.key, r.data && r.data.privat, C.aadFor(sid, r.id));
    return Model.merge((r.data && r.data.analyse) || {}, privat);
  }

  function sheetConsent(a) {
    const months = Math.round((CFG.retentionDays || 730) / 30.4);
    sheet('<h2>' + I.cloud.replace('<svg', '<svg width="24" height="24" style="vertical-align:-5px"') + ' Auf dem Server speichern?</h2><div class="consent">' +
      '<p style="margin-top:0">Damit können Sie <b>«' + esc(a.titel) + '»</b> auf weiteren Geräten öffnen und im Team gemeinsam erfassen. Was dabei passiert:</p><ul>' +
      '<li><b>Alles wird auf dem Server gespeichert:</b> Titel, Ort, Probenbezeichnungen, Herkunft/Betrieb, Namen, Notizen, Fotos und die Beurteilungen. Übertragung verschlüsselt (HTTPS); auf dem Server haben nur Personen mit Link und der Betreiber (für Betrieb und Support) Zugriff.</li>' +
      '<li>Die Beurteilungsdaten ohne Bezug zu Personen (Futterart, Bestand, Stadium, Rad-Antworten, Messwerte) können für anonyme, zusammenfassende Auswertungen genutzt werden.</li>' +
      '<li><b>Wer einen Link hat, sieht alles.</b> Den Bearbeiten-Link nur an Vertrauenspersonen geben, sonst den Nur-Ansehen-Link. Links lassen sich jederzeit erneuern – die alten werden dann ungültig.</li>' +
      '<li>Automatische Löschung <b>' + months + ' Monate nach der letzten Änderung</b>; Sie können jederzeit selbst löschen. Ohne Zustimmung bleibt alles nur in diesem Browser.</li></ul>' +
      '<p class="small"><a href="' + esc(CFG.privacyUrl) + '" target="_blank" rel="noopener">Datenschutzerklärung lesen</a></p>' +
      '<label class="toggle" style="margin:12px 0"><input type="checkbox" id="consentCheck"> <span>Ich habe die Hinweise gelesen und bin einverstanden. Personenangaben Dritter erfasse ich nur mit deren Einverständnis.</span></label>' +
      '<div class="row"><button class="btn ghost grow" data-close>Nein, nur lokal</button><button class="btn primary grow" id="consentOk" disabled data-act="consent-ok" data-id="' + a.id + '">Zustimmen & speichern</button></div></div>', (el) => {
      el.querySelector('#consentCheck').addEventListener('change', (e) => { el.querySelector('#consentOk').disabled = !e.target.checked; });
    });
  }

  async function createSpace(a, email, code) {
    if (!navigator.onLine) { toast('Keine Verbindung – bitte später erneut versuchen.'); return; }
    try {
      const secret = C.newSecret();
      const k = await C.keys('w', secret);
      const r = await IO.api('spaces', { method: 'POST', body: Object.assign({ consent: { accepted: true, version: CFG.consentVersion }, email, code }, await C.hashes(k)) });
      a.space = { id: r.id, mode: 'w', secret, consentAt: r.consentAt, consentVersion: CFG.consentVersion, metaDirty: true };
      probenOf(a.id).forEach((p) => { p.dirty = true; });
      save(); closeSheet();
      await syncAnlass(a);
      render(); sheetShare(a);
    } catch (e) {
      if (e.message === 'CODE_INVALID') throw e;
      toast(e.message === 'CONSENT_OUTDATED' ? 'Die Hinweise wurden aktualisiert – bitte Seite neu laden.' : e.message === 'RATE_LIMITED' ? 'Zu viele Anfragen – bitte später erneut versuchen.' : 'Speichern fehlgeschlagen: ' + e.message);
    }
  }
  /** Vor dem ersten Speichern: E-Mail bestätigen (Schutz vor Missbrauch des Speicherplatzes). */
  function spaceEmail(a) {
    sheet('<h2>E-Mail bestätigen</h2><p class="small" style="margin-top:0">Zum Schutz vor Missbrauch braucht das Speichern auf dem Server eine bestätigte E-Mail-Adresse. Sie wird verschlüsselt gespeichert und nicht weitergegeben.</p>' +
      '<form id="spMail" class="stack"><label class="field"><span>E-Mail-Adresse</span><input class="input" type="email" name="email" required autocomplete="email" value="' + esc(db.prefs.email || '') + '"></label>' +
      '<div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Code anfordern</button></div></form>', (el) => {
      el.querySelector('#spMail').addEventListener('submit', async (e) => {
        e.preventDefault(); const email = String(new FormData(e.target).get('email')).trim().toLowerCase();
        const anfordern = () => IO.api('spaces/code', { method: 'POST', body: { email } });
        try { await anfordern(); } catch (er) { toast(er.message === 'RATE_LIMITED' ? 'Zu viele Anfragen – bitte später erneut versuchen.' : 'Fehler: ' + er.message); return; }
        sheet('<h2>Code eingeben</h2><p class="small" style="margin-top:0">Code an <b>' + esc(email) + '</b> gesendet (15 Minuten gültig).</p><form id="spCode" class="stack"><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required style="font-size:1.6rem;letter-spacing:.3em;text-align:center"><p class="hint" id="spMsg"></p>' +
          '<div class="row"><button type="button" class="btn ghost grow" id="spNeu">Neuer Code</button><button class="btn primary grow">Bestätigen & speichern</button></div></form>', (el2) => {
          el2.querySelector('#spNeu').onclick = () => anfordern().then(() => { el2.querySelector('#spMsg').textContent = 'Neuer Code gesendet.'; }).catch(() => {});
          el2.querySelector('#spCode').addEventListener('submit', async (ev) => {
            ev.preventDefault(); const b = ev.target.querySelector('.primary'); b.disabled = true;
            try { db.prefs.email = email; await createSpace(a, email, String(new FormData(ev.target).get('code')).trim()); } catch (er) { el2.querySelector('#spMsg').textContent = 'Code falsch oder abgelaufen.'; b.disabled = false; }
          });
        });
      });
    });
  }

  const syncTimers = {};
  function scheduleSync(a) { clearTimeout(syncTimers[a.id]); syncTimers[a.id] = setTimeout(() => syncAnlass(a).then(() => refreshChrome()), 1500); }
  let syncing = {};
  async function syncAnlass(a) {
    if (!a.space || syncing[a.id] || !navigator.onLine) return;
    syncing[a.id] = true;
    const sid = a.space.id; const ro = a.space.mode === 'r';
    try {
      const k = await keysFor(a);
      const remote = await IO.api('spaces/' + sid, { headers: readH(k) });
      const remoteIds = new Set();
      for (const r of remote.records) {
        let d;
        try { d = await openRecord(k, sid, r); } catch (e) { throw new Error('Schlüssel passt nicht – Link wurde evtl. erneuert'); }
        if (r.id === 'anlassmeta') {
          const m = Model.cleanAnlass(Object.assign(d, { id: a.id }));
          if (!a.space.metaDirty && m && r.clientUpdatedAt > (a.updatedAt || '')) Object.assign(a, { titel: m.titel, datum: m.datum, ort: m.ort, notiz: m.notiz, updatedAt: r.clientUpdatedAt });
          continue;
        }
        remoteIds.add(r.id);
        const local = probeById(r.id);
        d = Model.cleanProbe(Object.assign(d, { id: r.id }));
        if (!d) continue;
        if (!local) {
          if ((db.tombstones || []).includes(r.id)) continue;
          db.proben.push(Object.assign(d, { anlassId: a.id, syncedAt: r.clientUpdatedAt, dirty: false }));
        } else if (ro || (!local.dirty && r.clientUpdatedAt > (local.updatedAt || ''))) {
          Object.assign(local, d, { anlassId: a.id, syncedAt: r.clientUpdatedAt, dirty: false });
        }
      }
      // Auf dem Server gelöscht → lokal entfernen (bei Nur-Ansehen immer exakt spiegeln)
      db.proben = db.proben.filter((p) => !(p.anlassId === a.id && !remoteIds.has(p.id) && (ro || (p.syncedAt && !p.dirty))));
      if (!ro) {
        for (const id of (db.tombstones || []).slice()) {
          if (remoteIds.has(id)) await IO.api('spaces/' + sid + '/records/' + id, { method: 'DELETE', headers: writeH(k) }).catch(() => {});
        }
        db.tombstones = [];
        await fotosHochladen(a, k);
        for (const p of probenOf(a.id).filter((x) => x.dirty || !remoteIds.has(x.id))) {
          try {
            await IO.api('spaces/' + sid + '/records/' + p.id, { method: 'PUT', headers: writeH(k), body: { data: await sealProbe(k, sid, p), updatedAt: p.updatedAt } });
            p.dirty = false; p.syncedAt = p.updatedAt;
          } catch (e) { if (e.status === 409) { p.dirty = false; } else throw e; }
        }
        if (a.space.metaDirty) {
          await IO.api('spaces/' + sid + '/records/anlassmeta', { method: 'PUT', headers: writeH(k), body: { data: await sealMeta(k, sid, a), updatedAt: a.updatedAt || now() } });
          a.space.metaDirty = false;
        }
      }
      a.space.lastSync = now(); a.space.error = null;
    } catch (e) {
      a.space.error = e.status === 404 ? 'Auf dem Server nicht (mehr) vorhanden oder Link ungültig' : e.message;
    } finally {
      syncing[a.id] = false; auswertungCache.clear(); save();
    }
  }
  function refreshChrome() {
    // Nur Navigation + Liste neu zeichnen, damit Eingaben im Detailbereich den Fokus behalten.
    const r = ui.route;
    $('#r-nav').innerHTML = renderNav(r);
    const aid = r.name === 'anlass' ? r.id : r.name === 'probe' ? (probeById(r.id) || {}).anlassId || null : ui.ctxAnlass;
    $('#r-list').innerHTML = renderList(r.name === 'home' || r.name === 'daten' ? ui.ctxAnlass : aid, r);
    if (r.name === 'anlass') $('#main').innerHTML = renderUebersicht(r.id);
  }

  async function shareLinks(a) {
    const k = await keysFor(a);
    const base = IO.appUrl() + '#s=' + a.space.id + '.';
    return { w: a.space.mode === 'w' ? base + 'w.' + a.space.secret : null, r: base + 'r.' + k.readSecret };
  }
  async function sheetShare(a, tab) {
    const links = await shareLinks(a);
    tab = links.w ? (tab || 'r') : 'r';
    const link = links[tab];
    const el = sheet('<h2>' + I.share.replace('<svg', '<svg width="24" height="24" style="vertical-align:-5px"') + ' Freigabe-Links</h2>' +
      (links.w ? '<div class="seg" style="margin-bottom:12px"><button data-act="share-tab" data-tab="r" data-id="' + a.id + '" aria-pressed="' + (tab === 'r') + '">Nur ansehen</button><button data-act="share-tab" data-tab="w" data-id="' + a.id + '" aria-pressed="' + (tab === 'w') + '">Bearbeiten</button></div>' : '') +
      '<p class="small" style="margin-top:0">' + (tab === 'w'
        ? '<b>Bearbeiten-Link:</b> Wer ihn hat, kann alle Angaben von «' + esc(a.titel) + '» sehen, ändern und löschen. Nur an Vertrauenspersonen weitergeben.'
        : '<b>Nur-Ansehen-Link:</b> Zeigt «' + esc(a.titel) + '» inklusive aller Namen und Notizen, erlaubt aber keine Änderungen – z. B. für die Übersicht im Büro.') +
      ' Der Schlüssel steckt im Link selbst; der Server kann die persönlichen Angaben nicht lesen.</p>' +
      '<div class="qr-box" id="shareQr"></div><div class="copy-field" style="margin-top:12px"><input class="input" readonly value="' + esc(link) + '" id="shareLink"><button class="btn" data-act="copy" data-target="#shareLink">Kopieren</button></div>' +
      (navigator.share ? '<button class="btn block" style="margin-top:10px" data-act="native-share" data-url="' + esc(link) + '" data-title="' + esc(a.titel) + '">Teilen …</button>' : '') +
      '<a class="btn block" style="margin-top:10px" href="mailto:' + encodeURIComponent(db.prefs.email || '') + '?subject=' + encodeURIComponent('Futterbeurteilung: ' + a.titel) + '&body=' + encodeURIComponent('Link zum Wiederöffnen (' + (tab === 'w' ? 'Bearbeiten' : 'nur ansehen') + '):\n' + link + '\n\nWer diesen Link hat, kann die Daten öffnen. Vertraulich aufbewahren.') + '">Link an mich mailen (später wieder abrufen)</a>' +
      '<p class="hint">' + esc(syncState(a).t) + '. Gespeichert seit ' + dateCH(a.space.consentAt) + '.' + (links.w ? ' Link gelangt in falsche Hände? → Menü › «Links erneuern».' : '') + '</p><button class="btn ghost block" data-close>Schliessen</button>');
    const svg = await IO.qrSvg(link); if (svg) el.querySelector('#shareQr').innerHTML = svg;
  }

  async function rotateSpace(a) {
    if (!confirm('Neue Links erzeugen? Alle bisherigen Links (Bearbeiten und Ansehen) werden sofort ungültig. Personen, die weiter Zugriff haben sollen, brauchen danach den neuen Link.')) return;
    try {
      await syncAnlass(a);
      if (a.space.error) throw new Error(a.space.error);
      const oldK = await keysFor(a);
      const secret = C.newSecret();
      const k = await C.keys('w', secret);
      const sid = a.space.id;
      const records = [{ id: 'anlassmeta', data: await sealMeta(k, sid, a), updatedAt: a.updatedAt || now() }];
      for (const p of probenOf(a.id)) records.push({ id: p.id, data: await sealProbe(k, sid, p), updatedAt: p.updatedAt });
      await IO.api('spaces/' + sid + '/rotate', { method: 'POST', headers: writeH(oldK), body: Object.assign({ records }, await C.hashes(k)) });
      a.space.secret = secret; spaceKeys.delete(a.id);
      probenOf(a.id).forEach((p) => { p.dirty = false; p.syncedAt = p.updatedAt; });
      save(); closeSheet(); toast('Neue Links erstellt – alte Links sind gesperrt.'); sheetShare(a, 'r');
    } catch (e) { toast('Erneuern fehlgeschlagen: ' + e.message); }
  }

  async function joinSpace(token) {
    const L = C.parseLink(token);
    if (!L) return toast('Ungültiger oder veralteter Freigabe-Link.');
    let a = db.anlaesse.find((x) => x.space && x.space.id === L.id);
    if (a) {
      // Bearbeiten-Link schlägt Nur-Ansehen; neuer Schlüssel ersetzt alten
      if (L.mode === 'w' || a.space.mode === 'r') { a.space.mode = L.mode; a.space.secret = L.secret; spaceKeys.delete(a.id); }
    } else {
      a = { id: uid(), titel: 'Geteilter Anlass', createdAt: now(), updatedAt: '', space: { id: L.id, mode: L.mode, secret: L.secret } };
      try {
        const k = await keysFor(a);
        const r = await IO.api('spaces/' + L.id, { headers: readH(k) });
        Object.assign(a.space, { consentAt: r.space.consentAt, consentVersion: r.space.consentVersion });
      } catch (e) { return toast(e.status === 404 ? 'Anlass nicht gefunden, gelöscht oder Link nicht mehr gültig.' : 'Laden fehlgeschlagen (offline?).'); }
      db.anlaesse.push(a);
    }
    await syncAnlass(a);
    if (a.space.error) toast(a.space.error); else toast('«' + a.titel + '» geladen' + (a.space.mode === 'r' ? ' (nur ansehen).' : '.'));
    save(); go('#/a/' + a.id);
  }

  // ---------- Import ----------
  async function handleImportPayload(payload) {
    try { applyImport(await IO.unpack(payload)); } catch (e) { toast('Import fehlgeschlagen: ' + e.message); }
  }
  function applyImport(obj) {
    if (obj.f === 'agff-futter-backup') {
      sheet('<h2>Sicherung wiederherstellen?</h2><p>' + obj.db.anlaesse.length + ' Anlässe und ' + obj.db.proben.length + ' Proben. Vorhandene Einträge mit gleicher Kennung werden durch die neuere Fassung ersetzt.</p><div class="row"><button class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow" id="doRestore">Wiederherstellen</button></div>', (el) => {
        el.querySelector('#doRestore').onclick = async () => {
          obj.db = Model.cleanDb(obj.db);
          let nf = 0;
          for (const f of (Array.isArray(obj.fotos) ? obj.fotos : [])) {
            if (!f || !Model.FOTO_ID_RE.test(f.id || '') || typeof f.data !== 'string' || !/^image\/(webp|jpeg)$/.test(f.mime || '')) continue;
            try { const bin = Uint8Array.from(atob(f.data), (ch) => ch.charCodeAt(0)); await F.ablegen(f.id, f.probeId, new Blob([bin], { type: f.mime })); nf++; } catch (er) { /* defektes Foto überspringen */ }
          }
          if (nf) toast(nf + ' Fotos wiederhergestellt.');
          window.Wiese.wiederherstellen(obj.wiese);
          obj.db.anlaesse.forEach((a) => { const l = anlassById(a.id); if (!l) db.anlaesse.push(a); else if ((a.updatedAt || '') > (l.updatedAt || '')) Object.assign(l, a); });
          obj.db.proben.forEach((p) => { const l = probeById(p.id); if (!l) db.proben.push(p); else if ((p.updatedAt || '') > (l.updatedAt || '')) Object.assign(l, p); });
          save(); closeSheet(); render(); toast('Sicherung wiederhergestellt.');
        };
      });
      return;
    }
    if (obj.f === 'v1') return importV1(obj.eintraege);
    obj.proben = (Array.isArray(obj.proben) ? obj.proben : []).map(Model.cleanProbe).filter(Boolean);
    obj.anlass = obj.anlass ? Model.cleanAnlass(obj.anlass) : null;
    if (!obj.proben.length) { toast('Keine gültigen Proben in den Daten gefunden.'); return; }
    const n = obj.proben.length;
    const exists = obj.proben.filter((p) => probeById(p.id));
    const an = obj.anlass;
    sheet('<h2>' + I.upload.replace('<svg', '<svg width="24" height="24" style="vertical-align:-5px"') + ' Importieren</h2>' +
      '<p style="margin-top:0">' + (an ? 'Anlass <b>«' + esc(an.titel) + '»</b> mit ' : '') + '<b>' + n + ' Probe' + (n === 1 ? '' : 'n') + '</b>: ' + obj.proben.slice(0, 5).map((p) => esc(titelOf(p))).join(', ') + (n > 5 ? ' …' : '') + '</p>' +
      (exists.length ? '<p class="small">' + exists.length + ' davon sind schon auf diesem Gerät. Neuere Fassungen ersetzen ältere.</p>' : '') +
      '<p class="small muted">Die Daten werden nur in diesem Browser gespeichert.</p>' +
      '<div class="row"><button class="btn ghost grow" data-close>Abbrechen</button>' + (exists.length ? '<button class="btn grow" id="impCopy">Als Kopie</button>' : '') + '<button class="btn primary grow" id="impOk">Importieren</button></div>', (el) => {
      const run = (asCopy) => {
        let aid = null;
        if (an) {
          let la = anlassById(an.id);
          if (asCopy || !la) { la = Object.assign({}, an, { id: asCopy && anlassById(an.id) ? uid() : an.id, createdAt: an.createdAt || now() }); delete la.space; db.anlaesse.push(la); }
          aid = la.id;
        }
        obj.proben.forEach((p) => {
          const l = probeById(p.id);
          const c = Object.assign({}, p, { anlassId: aid !== null ? aid : (l ? l.anlassId : null) });
          if (asCopy && l) { c.id = uid(); c.kopf = Object.assign({}, c.kopf, { bez: (c.kopf.bez || '') + ' (Kopie)' }); db.proben.push(c); }
          else if (!l) db.proben.push(c);
          else if ((p.updatedAt || '') >= (l.updatedAt || '')) Object.assign(l, c);
        });
        auswertungCache.clear(); save(); closeSheet();
        toast(n + ' Probe' + (n === 1 ? '' : 'n') + ' importiert.');
        go(n === 1 && !an ? '#/p/' + (asCopy ? db.proben[db.proben.length - 1].id : obj.proben[0].id) + '/ergebnis' : '#/' + (aid ? 'a/' + aid : 'e'));
      };
      el.querySelector('#impOk').onclick = () => run(false);
      const c = el.querySelector('#impCopy'); if (c) c.onclick = () => run(true);
    });
  }
  function sheetImport() {
    sheet('<h2>Importieren</h2><p class="small" style="margin-top:0">PDF-Bericht dieser App (enthält die Eingaben), JSON-Export, Sicherung oder JSON-Datei aus v1.</p>' +
      '<label class="drop" id="drop"><input type="file" accept=".pdf,.json,application/pdf,application/json" hidden id="fileIn">' + I.upload.replace('<svg', '<svg width="36" height="36"') + '<div style="font-weight:700;margin-top:6px">Datei wählen oder hierher ziehen</div><div class="small muted">PDF oder JSON</div></label>' +
      '<p class="small muted">QR-Code auf einem Bericht? Einfach mit der Handy-Kamera scannen – der Link öffnet die App und importiert die Probe.</p><button class="btn ghost block" data-close>Abbrechen</button>', (el) => {
      const handle = async (file) => { if (!file) return; try { const obj = await IO.readFile(file); closeSheet(); applyImport(obj); } catch (e) { toast(e.message); } };
      el.querySelector('#fileIn').addEventListener('change', (e) => handle(e.target.files[0]));
      const d = el.querySelector('#drop');
      d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('over'); handle(e.dataTransfer.files[0]); });
    });
  }

  function importV1(eintraege, anlassTitel) {
    let ok = 0, skip = 0; const anl = {};
    eintraege.forEach((e) => {
      const r = IO.fromV1(e, uid);
      if (r) r.probe = Model.cleanProbe(r.probe);
      if (!r || !r.probe) { skip++; return; }
      if (db.proben.some((p) => p.kopf && p.kopf.v1ProbeNr && p.kopf.v1ProbeNr === r.probe.kopf.v1ProbeNr && p.kopf.beurteiler === r.probe.kopf.beurteiler)) { skip++; return; }
      const t = anlassTitel || r.anlassTitel;
      if (t) {
        if (!anl[t]) { anl[t] = db.anlaesse.find((a) => a.titel === t && a.quelle === 'v1'); if (!anl[t]) { anl[t] = { id: uid(), titel: t, createdAt: now(), updatedAt: now(), quelle: 'v1' }; db.anlaesse.push(anl[t]); } }
        r.probe.anlassId = anl[t].id;
      }
      db.proben.push(r.probe); ok++;
    });
    save(); render();
    toast(ok + ' v1-Proben übernommen' + (skip ? ', ' + skip + ' übersprungen (bereits vorhanden oder ohne K3-Bezug)' : '') + '.');
  }
  function sheetV1Server() {
    sheet('<h2>Proben vom v1-Server laden</h2><p class="small" style="margin-top:0">Aus Datenschutzgründen liefert der v1-Server nur <b>Ihre eigenen</b> Beurteilungen (gleicher Name wie in v1). Mit dem Admin-Passwort sind alle Beurteilungen verfügbar.</p>' +
      '<form id="v1Form" class="stack"><label class="field"><span>Ihr Name wie in v1</span><input class="input" name="name" value="' + esc(db.prefs.beurteiler) + '" autocomplete="name"></label>' +
      '<label class="field"><span>Admin-Passwort (optional)</span><input class="input" name="pass" type="password" autocomplete="off"></label>' +
      '<p class="hint" id="v1Msg"></p><div class="row"><button type="button" class="btn ghost grow" data-close>Abbrechen</button><button class="btn primary grow">Laden</button></div></form>', (el) => {
      el.querySelector('#v1Form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const name = String(fd.get('name') || '').trim(); const pass = String(fd.get('pass') || '');
        const msg = el.querySelector('#v1Msg');
        if (!name && !pass) { msg.textContent = 'Bitte Namen oder Admin-Passwort angeben.'; return; }
        let rows;
        try {
          const r = await fetch('../api/proben' + (name ? '?beurteiler=' + encodeURIComponent(name) : ''), { credentials: 'omit', cache: 'no-store', headers: pass ? { 'X-Admin-Pass': pass } : {} });
          if (r.status === 401) { msg.textContent = 'Zugriff verweigert – Passwort prüfen.'; return; }
          rows = await r.json();
        } catch (er) { msg.textContent = 'v1-Server nicht erreichbar.'; return; }
        if (!Array.isArray(rows) || !rows.length) { msg.textContent = 'Keine Beurteilungen gefunden' + (name ? ' für «' + name + '»' : '') + '.'; return; }
        if (name && !db.prefs.beurteiler) { db.prefs.beurteiler = name; save(); }
        sheetV1Groups(rows);
      });
    });
  }
  function sheetV1Groups(rows) {
    const groups = {};
    rows.forEach((x) => { const pre = (x.probeNr || '').includes('_') ? x.probeNr.split('_')[0] : '(ohne Anlass)'; (groups[pre] = groups[pre] || []).push(x); });
    const keys = Object.keys(groups).sort();
    sheet('<h2>Anlass aus v1 übernehmen</h2><p class="small" style="margin-top:0">Gruppiert nach dem Präfix der Probenummer (Text vor «_»). Die Proben werden in diesen Browser kopiert.</p><div class="opts">' +
      keys.map((k) => '<button class="opt" data-v1group="' + esc(k) + '"><span class="body"><b>' + esc(k) + '</b><small>' + groups[k].length + ' Beurteilungen</small></span></button>').join('') + '</div><button class="btn ghost block" style="margin-top:10px" data-close>Abbrechen</button>', (el) => {
      el.querySelectorAll('[data-v1group]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.v1group; closeSheet(); importV1(groups[k], k === '(ohne Anlass)' ? null : k); }));
    });
  }

  // ---------- Downloads ----------
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const fileSafe = (s) => String(s || 'Probe').normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'Probe';
  async function pdfFor(anlass, proben, name) {
    toast('PDF wird erstellt …');
    try {
      const fotos = async (p) => {
        const out = [];
        for (const f of (p.fotos || []).filter((x) => x.art === 'futter' || !laborGesperrt(p))) {
          const d = await F.jpegDataUrl(f.id, 1400).catch(() => null); if (d) out.push(Object.assign(d, { art: f.art }));
        }
        return out;
      };
      const blob = await IO.makePdf({ anlass, proben, auswertung, wheelSvg: (p, res) => wheelSvg(p, res), label, fotos, titel: anlass ? anlass.titel : titelOf(proben[0]) });
      download(blob, name);
      toast('PDF gespeichert – enthält alle Eingaben zum Wiederimport.');
    } catch (e) { console.error(e); toast('PDF fehlgeschlagen: ' + e.message); }
  }

  // ---------- Ereignisse ----------
  function setPath(obj, path, val) {
    const ks = path.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { o[ks[i]] = o[ks[i]] || {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
  }
  function currentProbe() { return ui.route.name === 'probe' ? probeById(ui.route.id) : null; }
  /** Dezent zeigen, was als Nächstes zu tun ist: erste offene Pflichtauswahl, sonst «Weiter». */
  function naechstesMarkieren() {
    document.querySelectorAll('.naechstes').forEach((e) => e.classList.remove('naechstes'));
    if (ui.route.name !== 'probe') return;
    const p = probeById(ui.route.id); const w = $('#main .wizard');
    if (!p || !w || readOnly(p)) return;
    let ziel = null;
    const bez = w.querySelector('[data-k="kopf.bez"]');
    if (bez && !bez.value.trim()) ziel = bez;
    if (!ziel) {
      const namen = [];
      w.querySelectorAll('[data-set]').forEach((b) => { if (!namen.includes(b.dataset.set) && b.dataset.set !== 'leitpflanze') namen.push(b.dataset.set); });
      for (const n of namen) {
        const bs = [...w.querySelectorAll('[data-set]')].filter((b) => b.dataset.set === n);
        if (!bs.some((b) => b.getAttribute('aria-pressed') === 'true')) { ziel = bs[0].closest('.opts, .seg') || bs[0]; break; }
      }
    }
    if (!ziel) {
      const steps = stepsFor(p); const st = steps.find((x) => x.id === ui.route.step) || steps[0];
      if (stepDone(p, st.id)) ziel = document.querySelector('.actionbar .btn.primary');
    }
    if (ziel) ziel.classList.add('naechstes');
  }

  function rerenderDetail(keepScroll) {
    const m = $('#main'); const st = m.scrollTop; const ws = window.scrollY;
    const p = currentProbe(); if (!p) return render();
    m.innerHTML = renderProbe(p, ui.route.step);
    if (keepScroll) { m.scrollTop = st; window.scrollTo(0, ws); }
    $('#r-list').innerHTML = renderList(p.anlassId || null, ui.route);
    appMini(); listeGriff();
    fotosEinsetzen();
    if (window.Assistent) window.Assistent.update();
    Rad.animieren($('#radbox'));
    naechstesMarkieren();
  }

  function choose(p, set, val) {
    if (guardRO(p)) return;
    const a = p.antworten;
    if (set === 'typ') { if (p.typ !== val) { p.typ = val; p.rad = {}; } }
    else if (set.startsWith('rad.')) {
      const fid = set.slice(4);
      const f = K3.TYPEN[p.typ].rad.find((x) => x.id === fid);
      if (f && f.ph) { delete a.phWert; }
      p.rad[fid] = p.rad[fid] === val && !f.ph ? null : val;
      // nächsten offenen Faktor fokussieren
      const sel = K3.radAuswahl(p);
      const nextF = K3.TYPEN[p.typ].rad.find((x) => !sel[x.id]);
      if (nextF && p.rad[fid]) ui.fokus[p.id] = nextF.id;
    } else if (set === 'aufwuchs') { if (a.aufwuchs !== val) { a.aufwuchs = val; delete a.stadium; } }
    else if (set === 'leitpflanze') a.leitpflanze = Number(val);
    else a[set] = a[set] === val ? null : val;
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* ignore */ }
    touchProbe(p);
    rerenderDetail(true);
    // Einzelfrage-Schritte: automatisch weiter
    if ((set === 'bestand' || set === 'stadium') && a[set]) {
      const steps = stepsFor(p); const i = steps.findIndex((s) => s.id === (set === 'bestand' ? 'bestand' : 'stadium'));
      setTimeout(() => { if (currentProbe() === p && ui.route.step === steps[i].id) go('#/p/' + p.id + '/' + steps[i + 1].id); }, 260);
    }
  }

  document.addEventListener('click', async (e) => {
    if (ui.route.name === 'schweiz' && e.target.closest('[data-sw],[data-sw-region]') && window.Schweiz.handle(e.target)) return;
    if (e.target.closest('[data-bl]') && window.Bilanz.handle(e)) return;
    if (e.target.closest('[data-wi]') && window.Wiese.handle(e)) return;
    if (e.target.closest('[data-pf]') && window.Pflanzen.handle(e)) return;
    if (e.target.closest('[data-pool-foto]') && window.PoolOeffentlich.handle(e)) return;
    if (e.target.closest('[data-aw]') && window.Auswahl.handle(e)) return;
    const t = e.target.closest('[data-close],[data-act],[data-set],[data-go],[data-fokus],[data-step],[data-sort],[data-o],[data-f]');
    if (!t) return;
    if (t.tagName === 'A' && t.dataset.act) e.preventDefault();
    if (t.hasAttribute('data-close') && (e.target === t || t.tagName === 'BUTTON')) { closeSheet(); return; }
    if (t.dataset.go) { go(t.dataset.go); return; }
    const p = currentProbe();
    if (t.dataset.o && p) {
      // Touch: Antippen eines anderen Faktors wählt erst diesen aus (dreht ihn nach oben, gross) – Fehltreffer vermeiden
      const grob = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (grob && ui.fokus[p.id] !== t.dataset.f) { ui.fokus[p.id] = t.dataset.f; rerenderDetail(true); return; }
      choose(p, 'rad.' + t.dataset.f, t.dataset.o); return;
    }
    if (t.dataset.f && p && !t.dataset.o) { ui.fokus[p.id] = t.dataset.f; rerenderDetail(true); return; }
    if (t.dataset.fokus && p) { ui.fokus[p.id] = t.dataset.fokus; rerenderDetail(true); return; }
    if (t.dataset.set && p) { choose(p, t.dataset.set, t.dataset.val); return; }
    if (t.dataset.step && p) {
      if (guardRO(p)) return;
      const k = t.dataset.step; const d = Number(t.dataset.d);
      let v = Number(p.antworten[k]);
      if (k === 'phWert') { v = isFinite(v) && v > 0 ? v + d : 4.4; v = Math.round(Math.max(3, Math.min(7, v)) * 10) / 10; delete p.rad.ph; }
      else v = Math.max(1, (isFinite(v) && v > 0 ? v : 4) + d);
      p.antworten[k] = v; touchProbe(p); rerenderDetail(true); return;
    }
    if (t.dataset.sort) { const k = t.dataset.sort; ui.sort = { k, dir: ui.sort.k === k ? -ui.sort.dir : -1 }; $('#main').innerHTML = renderUebersicht(ui.route.id); return; }
    const act = t.dataset.act; const id = t.dataset.id;
    switch (act) {
      case 'new-probe': {
        const aid = t.dataset.anlass !== undefined ? (t.dataset.anlass || null) : (ui.route.name === 'anlass' ? ui.route.id : (currentProbe() ? currentProbe().anlassId : null));
        if (aid && anlassById(aid) && anlassById(aid).kurs) { toast('Im Kurs bitte eine Kursprobe aus der Liste wählen.'); break; }
        if (anlassReadOnly(aid)) { toast('Nur-Ansehen-Link: neue Proben bitte ohne Anlass oder in einem eigenen Anlass erfassen.'); sheetNewProbe(null); break; }
        sheetNewProbe(aid || null); break;
      }
      case 'meine-kurse': window.Kurs.meineKurse(); break;
      case 'app': appWechseln(t.dataset.val); break;
      case 'liste-umschalten': {
        const zu = document.documentElement.dataset.liste !== 'zu';
        if (zu) document.documentElement.dataset.liste = 'zu'; else delete document.documentElement.dataset.liste;
        try { localStorage.setItem(LISTE_KEY, zu ? 'zu' : 'auf'); } catch (er) { /* privat */ }
        listeGriff(); break;
      }
      case 'create-probe': {
        const pr = neueProbe(t.dataset.typ, t.dataset.anlass || null); closeSheet();
        go('#/p/' + pr.id + '/probe');  // bei Schritt 1 beginnen: Bezeichnung, Schnittdatum, PLZ, Fotos
        setTimeout(() => { const f = document.querySelector('[data-k="kopf.bez"]'); if (f && window.matchMedia('(pointer: fine)').matches) { f.focus(); f.select(); } }, 120); break;
      }
      case 'new-anlass':
        sheet('<h2>Neuer Anlass</h2><div class="typ-cards">' +
          '<button class="typ-card" data-act="new-anlass-eigen"><span class="ico" style="background:var(--brand-soft);color:var(--brand-ink)">' + I.wheel.replace('<svg', '<svg width="26" height="26"') + '</span><span><b>Für mich / mein Team</b><span class="small muted">Eigene Proben sammeln, z. B. Betriebsbesuch oder Silo-Kontrolle. Bleibt im Browser; bei Bedarf über den Server teilen.</span></span></button>' +
          '<button class="typ-card" data-act="kurs-anlegen"><span class="ico" style="background:#f6c35b;color:#1d2925">' + I.table.replace('<svg', '<svg width="26" height="26"') + '</span><span><b>Kurs</b><span class="small muted">Mehrere Personen erfassen Proben per QR-Etikett und beurteilen sie gegenseitig – mit Vergleich. Für freigeschaltete Kursleitende.</span></span></button>' +
          '</div><button class="btn ghost block" data-close style="margin-top:10px">Abbrechen</button>');
        break;
      case 'new-anlass-eigen': closeSheet(); sheetAnlass(null); break;
      case 'edit-anlass': if (anlassReadOnly(id)) { toast('Nur-Ansehen-Link: Änderungen sind nicht möglich.'); break; } sheetAnlass(anlassById(id)); break;
      case 'anlass-menu': sheetAnlassMenu(anlassById(id)); break;
      case 'probe-menu': sheetProbeMenu(probeById(id)); break;
      case 'tier': sheetTier(probeById(id), t.dataset.tier); break;
      case 'tier-ansicht': db.prefs.tierAnsicht = db.prefs.tierAnsicht === t.dataset.val ? '' : t.dataset.val; save(); rerenderDetail(true); break;
      case 'import': sheetImport(); break;
      case 'outdoor': {
        const on = document.documentElement.dataset.outdoor === '1';
        if (on) delete document.documentElement.dataset.outdoor; else document.documentElement.dataset.outdoor = '1';
        try { localStorage.setItem('agffV2Outdoor', on ? '0' : '1'); } catch (er) { /* ignore */ }
        toast(on ? 'Normale Darstellung' : 'Modus «Draussen»: hoher Kontrast, grosse Schaltflächen'); break;
      }
      case 'assist-ruhe': window.Assistent.ruhe = t.dataset.val === 'ruhe'; render(); break;
      case 'assist-stufe': window.Assistent.stufe = t.dataset.val; render(); break;
      case 'assist-reset': window.Assistent.zuruecksetzen(); window.Assistent.ruhe = false; toast('Der Traktor meldet sich bei jedem Schritt wieder einmal.'); render(); break;
      case 'bilanz-anlass': { const ids = probenOf(id).filter((p) => auswertung(p).vollstaendig).map((p) => p.id); window.Bilanz.hinzufuegen(ids); closeSheet(); go('#/bilanz'); toast(ids.length + ' Proben übernommen – Mengen eintragen.'); break; }
      case 'theme': {
        const v = t.dataset.val; if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
        try { localStorage.setItem('agffV2Theme', v); } catch (er) { /* ignore */ }
        render(); break;
      }
      case 'pdf-probe': { const pr = probeById(id); closeSheet(); await pdfFor(pr.anlassId ? anlassById(pr.anlassId) : null, [pr], 'Futterbeurteilung_' + fileSafe(titelOf(pr)) + '.pdf'); break; }
      case 'pdf-anlass': { const a = id ? anlassById(id) : null; closeSheet(); await pdfFor(a, probenOf(id || null), 'Futterbeurteilung_' + fileSafe(a ? a.titel : 'Einzelproben') + '.pdf'); break; }
      case 'export-anlass': { const a = anlassById(id); closeSheet(); download(new Blob([JSON.stringify(IO.bundle(a, probenOf(id)), null, 1)], { type: 'application/json' }), 'Futterbeurteilung_' + fileSafe(a.titel) + '.json'); break; }
      case 'backup': {
        const copy = JSON.parse(JSON.stringify(db));
        const fotos = [];
        for (const p of db.proben) for (const f of (p.fotos || [])) {
          const b = await F.blob(f.id).catch(() => null);
          if (b) fotos.push({ id: f.id, probeId: p.id, mime: b.type, data: await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); }) });
        }
        const wiese = window.Wiese.sicherung();
        for (const fid of window.Wiese.fotoIds()) {
          const b = await F.blob(fid).catch(() => null);
          if (b) fotos.push({ id: fid, probeId: 'wiese', mime: b.type, data: await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); }) });
        }
        download(new Blob([JSON.stringify({ f: 'agff-futter-backup', v: 2, exportiert: now(), db: copy, fotos, wiese })], { type: 'application/json' }), 'Futterbeurteilung_Sicherung_' + new Date().toISOString().slice(0, 10) + '.json');
        toast('Enthält die Schlüssel Ihrer Freigabe-Links – vertraulich aufbewahren!'); break;
      }
      case 'qr-probe': {
        const pr = probeById(id);
        const url = IO.appUrl() + '#import=' + (await IO.pack(IO.bundle(null, [pr])));
        const el = sheet('<h2>QR-Code / Link</h2><p class="small" style="margin-top:0">Der Code enthält die Eingaben dieser Probe direkt (nichts wird auf einem Server gespeichert). Scannen öffnet die App und importiert die Probe.</p><div class="qr-box" id="qrP"></div><div class="copy-field" style="margin-top:12px"><input class="input" readonly id="qrLink" value="' + esc(url) + '"><button class="btn" data-act="copy" data-target="#qrLink">Kopieren</button></div>' +
          (navigator.share ? '<button class="btn block" style="margin-top:10px" data-act="native-share" data-url="' + esc(url) + '" data-title="' + esc(titelOf(pr)) + '">Teilen …</button>' : '') + '<button class="btn ghost block" data-close style="margin-top:8px">Schliessen</button>');
        const svg = await IO.qrSvg(url); el.querySelector('#qrP').innerHTML = svg || '<p>Zu viele Daten für einen QR-Code – bitte PDF verwenden.</p>';
        break;
      }
      case 'copy': { const inp = $(t.dataset.target); inp.select(); try { await navigator.clipboard.writeText(inp.value); toast('Kopiert.'); } catch (er) { document.execCommand('copy'); toast('Kopiert.'); } break; }
      case 'native-share': try { await navigator.share({ title: t.dataset.title, url: t.dataset.url }); } catch (er) { /* abgebrochen */ } break;
      case 'dup-probe': {
        const pr = probeById(id); const c = JSON.parse(JSON.stringify(pr));
        Object.assign(c, { id: uid(), createdAt: now(), updatedAt: now(), syncedAt: undefined, dirty: false }); c.kopf.bez = (c.kopf.bez || 'Probe') + ' (Kopie)';
        if (readOnly(pr)) c.anlassId = null;
        db.proben.push(c); touchProbe(c); closeSheet(); go('#/p/' + c.id + '/probe'); break;
      }
      case 'delete-probe': {
        const pr = probeById(id);
        if (guardRO(pr)) return;
        if (!confirm('Probe «' + titelOf(pr) + '» löschen?')) return;
        window.Statistik.zurueckziehen(pr).catch(() => {});
        db.proben = db.proben.filter((x) => x.id !== id);
        const a = pr.anlassId && anlassById(pr.anlassId);
        (pr.fotos || []).forEach((f) => { F.del(f.id).catch(() => {}); if (a && a.space && f.up !== false) db.fotoTombstones = (db.fotoTombstones || []).concat({ sid: a.space.id, id: f.id }); });
        if (a && a.space) { db.tombstones = (db.tombstones || []).concat(id); scheduleSync(a); }
        save(); closeSheet(); go(pr.anlassId ? '#/a/' + pr.anlassId : '#/e'); break;
      }
      case 'delete-anlass': {
        const a = anlassById(id);
        if (!confirm('Anlass «' + a.titel + '» mit allen ' + probenOf(id).length + ' Proben auf diesem Gerät löschen?' + (a.space ? '\n\nHinweis: Die Kopie auf dem Server bleibt bestehen. Zum Löschen dort zuerst «Vom Server löschen» wählen.' : ''))) return;
        db.proben = db.proben.filter((x) => x.anlassId !== id); db.anlaesse = db.anlaesse.filter((x) => x.id !== id);
        save(); closeSheet(); go('#/'); break;
      }
      case 'consent': closeSheet(); sheetConsent(anlassById(id)); break;
      case 'consent-ok': closeSheet(); spaceEmail(anlassById(id)); break;
      case 'share-space': closeSheet(); sheetShare(anlassById(id)); break;
      case 'share-tab': sheetShare(anlassById(id), t.dataset.tab); break;
      case 'space-rotate': closeSheet(); await rotateSpace(anlassById(id)); break;
      case 'sync-now': { const a = anlassById(id); closeSheet(); await syncAnlass(a); render(); toast(syncState(a).t); break; }
      case 'space-delete': {
        const a = anlassById(id);
        if (!confirm('Alle Daten von «' + a.titel + '» endgültig vom Server löschen? Die lokale Kopie auf diesem Gerät bleibt erhalten. Andere Geräte mit dem Freigabe-Link verlieren den Zugriff.')) return;
        try { await IO.api('spaces/' + a.space.id, { method: 'DELETE', headers: writeH(await keysFor(a)) }); } catch (er) { if (er.status !== 404) { toast('Löschen fehlgeschlagen: ' + er.message); return; } }
        delete a.space; probenOf(id).forEach((x) => { delete x.syncedAt; delete x.dirty; });
        save(); closeSheet(); render(); toast('Vom Server gelöscht. Daten liegen nur noch auf diesem Gerät.'); break;
      }
      case 'v1-local': { let arr = []; try { arr = JSON.parse(localStorage.getItem('agffLocalSavedProbes') || '[]'); } catch (er) { /* leer */ } importV1(arr.map((x) => Object.assign({ probeNr: x.meta && x.meta.probeNr, beurteiler: x.meta && x.meta.beurteiler }, x))); break; }
      case 'v1-server': sheetV1Server(); break;
      case 'wipe': if (confirm('Wirklich alle lokalen v2-Daten inkl. Fotos löschen? Das kann nicht rückgängig gemacht werden.')) { db = emptyDb(); flush(); window.Wiese.allesLoeschen(); F.aufraeumen([]).catch(() => {}); fotoUrls.clear(); go('#/'); } break;
      case 'foto-neu': fotoNeu(probeById(id), t.dataset.art); break;
      case 'labor-import': {
        const pr = probeById(id); if (guardRO(pr)) break;
        if (!auswertung(pr).vollstaendig) { toast('Bitte zuerst die eigene Beurteilung abschliessen.'); break; }
        closeSheet();
        const fotos = [];
        for (const f of (pr.fotos || []).filter((x) => x.art === 'labor')) { const b = await F.blob(f.id).catch(() => null); if (b) fotos.push({ id: f.id, blob: b }); }
        const r = await window.LaborOCR.dialog({ fotos });
        if (r) { pr.labor = r.werte; touchProbe(pr); rerenderDetail(true); toast(Object.keys(r.werte).length + ' Laborwerte übernommen.'); }
        break;
      }
      case 'foto-zeigen': await fotoZeigen(probeById(id), t.dataset.foto); break;
      case 'foto-loeschen': await fotoLoeschen(probeById(id), t.dataset.foto); break;
      case 'foto-schwaerzen': {
        const pr = probeById(id); if (guardRO(pr)) break;
        const i = (pr.fotos || []).findIndex((f) => f.id === t.dataset.foto); if (i < 0) break;
        closeSheet();
        const neu = await F.nachSchwaerzen(pr.fotos[i], pr.id);
        if (neu) { pr.fotos[i] = neu; fotoUrls.delete(neu.id); touchProbe(pr); rerenderDetail(true); toast('Geschwärzte Fassung gespeichert.'); }
        break;
      }
      default:
        if (act && (act.startsWith('kurs-') || act.startsWith('pool-'))) await window.Kurs.handle(act, t);
        else if (act && (act.startsWith('beitrag-') || act.startsWith('nudge-'))) await window.Statistik.handle(act, t);
        break;
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (window.Bilanz && el.closest('.bilanz')) { window.Bilanz.eingabe(e); return; }
    if (el.dataset.pref) {
      const pr = el.dataset.pref;
      if (pr === 'kuhGewicht') db.prefs[pr] = Number(el.value) || 630;
      else if (pr === 'mastGewicht') { const v = Number(el.value); db.prefs[pr] = v >= K3.MAST.LG_MIN && v <= K3.MAST.LG_MAX ? v : 400; }
      else db.prefs[pr] = el.value;
      auswertungCache.clear(); save(); return;
    }
    const k = el.dataset.k; const p = currentProbe();
    if (!k || !p) return;
    if (guardRO(p)) { rerenderDetail(true); return; }
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'antworten.phWert') { v = v === '' ? null : Number(String(v).replace(',', '.')); if (v != null && !isFinite(v)) return; delete p.rad.ph; }
    if (k === 'antworten.wochen') { v = v === '' ? null : Number(v); }
    if (k === 'kopf.hoehe') { v = v === '' ? undefined : Number(v); if (v !== undefined && !isFinite(v)) return; }
    if (k === 'kopf.plz') { v = String(v).replace(/\D/g, '').slice(0, 4); }
    if (k === 'anlassId') {
      const old = p.anlassId && anlassById(p.anlassId);
      if (old && old.space && p.syncedAt) { db.tombstones = (db.tombstones || []).concat(p.id); scheduleSync(old); }
      p.anlassId = v || null; delete p.syncedAt;
    } else setPath(p, k, v);
    if (k === 'kopf.beurteiler' && v && !db.prefs.beurteiler) db.prefs.beurteiler = v;
    touchProbe(p);
    // Bei Text-Eingaben nicht neu rendern (Fokus/Cursor behalten), nur Seitenbereiche aktualisieren
    if (el.type === 'checkbox' || el.tagName === 'SELECT' || k === 'antworten.wochen' || (k === 'antworten.phWert' && e.type === 'change')) rerenderDetail(true);
    else { $('#r-list').innerHTML = renderList(p.anlassId || null, ui.route); clearTimeout(rerenderDetail._t); if (k === 'antworten.phWert') rerenderDetail._t = setTimeout(() => { const pos = el.selectionStart; rerenderDetail(true); const ne = $('[data-k="antworten.phWert"]'); if (ne) { ne.focus(); try { ne.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } } }, 700); }
  });

  window.addEventListener('online', () => { ui.online = true; db.anlaesse.filter((a) => a.space).forEach((a) => syncAnlass(a).then(refreshChrome)); });
  window.addEventListener('offline', () => { ui.online = false; refreshChrome(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const a = ui.route.name === 'anlass' ? anlassById(ui.route.id) : currentProbe() && anlassById(currentProbe().anlassId);
      if (a && a.space) syncAnlass(a).then(refreshChrome);
    }
  });
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const a = ui.route.name === 'anlass' && anlassById(ui.route.id);
    if (a && a.space) syncAnlass(a).then(refreshChrome);
  }, 60000);

  // ---------- Start ----------
  async function loadBasis() {
    try {
      const r = await fetch('api/basis');
      basis = await r.json();
      try { localStorage.setItem('agffV2Basis', JSON.stringify(basis)); } catch (e) { /* zu gross o. ä. */ }
    } catch (e) {
      try { basis = JSON.parse(localStorage.getItem('agffV2Basis')); } catch (er) { basis = null; }
    }
    auswertungCache.clear();
  }
  // Schnittstelle für Zusatzmodule (Kurs)
  window.__app = {
    get db() { return db; }, save, render, refreshChrome, rerenderDetail, sheet, closeSheet, toast, go, esc, I, uid, now, fmt,
    typBadge, touchProbe, neueProbe, basisTabelle: () => basis && basis.tabelle, radFokus: (p) => ui.fokus[p.id] || null, probeById, anlassById, auswertung, wheelSvg, tonOf, bestandStadium, sheetAnlass, sheetConsent, label, dateCH, route: () => ui.route,
  };
  load();
  try { basis = JSON.parse(localStorage.getItem('agffV2Basis')); } catch (e) { basis = null; }
  route();
  // Verwaiste Fotos (gelöschte Proben) aus IndexedDB entfernen
  F.aufraeumen(db.proben.flatMap((p) => (p.fotos || []).map((f) => f.id)).concat(window.Wiese.fotoIds())).catch(() => {});
  loadBasis().then(() => { render(); window.Statistik.alleAbgleichen(); });
  db.anlaesse.filter((a) => a.space).forEach((a) => syncAnlass(a).then(refreshChrome));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  // Offene Tabs auf neue Versionen hinweisen (sonst läuft nach einem Update der alte Code weiter)
  let updateGezeigt = false;
  const versionPruefen = () => {
    if (updateGezeigt || !CFG.build || document.hidden) return;
    fetch('api/config', { cache: 'no-store', credentials: 'omit' }).then((r) => r.json()).then((c) => {
      if (!c.build || c.build === CFG.build || updateGezeigt) return;
      updateGezeigt = true;
      const b = document.createElement('div'); b.className = 'update-banner';
      b.innerHTML = '<span>Neue Version verfügbar.</span><button class="btn sm primary" type="button">Neu laden</button>';
      b.querySelector('button').addEventListener('click', () => location.reload());
      document.body.appendChild(b);
    }).catch(() => {});
  };
  document.addEventListener('visibilitychange', versionPruefen);
  setInterval(versionPruefen, 10 * 60 * 1000);
  window.__futterV2 = { get db() { return db; }, auswertung, render };
})();
