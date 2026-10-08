/* Futter v2 – Datenmodell: Validierung aller Daten von aussen und Trennung in Schutzklassen.
 *
 * Alles, was nicht von diesem Gerät stammt (PDF/QR/JSON-Import, Sicherung, Server, v1), läuft durch cleanProbe /
 * cleanAnlass: nur bekannte Felder, geprüfte Werte, begrenzte Längen. Unbekanntes wird verworfen.
 *
 * Schutzklassen:
 *  - privat  (Personen-/Standortbezug, Freitext, Fotos, Laborberichte) → auf dem Server immer Ende-zu-Ende verschlüsselt
 *  - analyse (Futterart, Bestand, Stadium, Rad-Antworten, Messwerte)    → auf dem Server lesbar (Statistik möglich)
 */
(function (global) {
  'use strict';
  const K3 = global.K3;
  const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;  // 32 Byte base64url (Link-Geheimnis)

  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max) : undefined);
  const iso = (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : undefined);
  const date = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : undefined);
  const oneOf = (v, list) => (list.includes(v) ? v : undefined);
  const num = (v, min, max) => (typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : undefined);
  const bool = (v) => (typeof v === 'boolean' ? v : undefined);
  const compact = (o) => { Object.keys(o).forEach((k) => { if (o[k] === undefined) delete o[k]; }); return o; };
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  // Erlaubte Werte aus der Fachlogik ableiten (eine Quelle der Wahrheit)
  const BESTAND_IDS = K3.BESTAENDE.map((b) => b.id);
  const TS_IDS = K3.K3B_TS.map((t) => t.id).concat(K3.K3C_SCHRITTE.find((s) => s.id === 'ts').optionen.map((o) => o.id));
  const SAUBER_IDS = K3.K3B_SAUBERKEIT.map((s) => s.id);
  const k3cIds = (id) => K3.K3C_SCHRITTE.find((s) => s.id === id).optionen.map((o) => o.id);

  /** Felder je Schutzklasse (Pfade relativ zur Probe bzw. zum Anlass). */
  const PRIVAT = {
    probe: ['kopf.bez', 'kopf.herkunft', 'kopf.beurteiler', 'kopf.notiz', 'kopf.v1ProbeNr'],
    anlass: ['titel', 'ort', 'notiz'],
  };

  function cleanAntworten(a, typ) {
    if (!isObj(a)) return {};
    const o = {
      bestand: oneOf(a.bestand, BESTAND_IDS),
      aufwuchs: oneOf(a.aufwuchs, ['1', 'f']),
      stadium: oneOf(String(a.stadium), ['1', '2', '3', '4', '5', '6', '7']),
      leitpflanze: num(a.leitpflanze, 0, 4),
      wochen: num(a.wochen, 0, 60),
      ueber600: bool(a.ueber600), herbst: bool(a.herbst),
      sauberkeit: oneOf(a.sauberkeit, SAUBER_IDS),
      ts: oneOf(a.ts, TS_IDS),
      phWert: a.phWert === null ? undefined : num(a.phWert, 2.5, 9),
      laenge: oneOf(a.laenge, k3cIds('laenge')), schnitt: oneOf(a.schnitt, k3cIds('schnitt')), koerner: oneOf(a.koerner, k3cIds('koerner')),
      kolben: oneOf(a.kolben, ['gt55', '45', 'lt45']),
      hoch: bool(a.hoch), power: bool(a.power),
    };
    void typ;
    return compact(o);
  }

  function cleanRad(r, typ) {
    const out = {};
    if (!isObj(r)) return out;
    K3.TYPEN[typ].rad.forEach((f) => { if (f.optionen.some((x) => x.id === r[f.id])) out[f.id] = r[f.id]; });
    return out;
  }

  /** Liefert eine bereinigte Probe oder null, wenn sie unbrauchbar ist. */
  function cleanProbe(p) {
    if (!isObj(p) || !ID_RE.test(p.id || '') || !K3.TYPEN[p.typ]) return null;
    const k = isObj(p.kopf) ? p.kopf : {};
    const now = new Date().toISOString();
    return compact({
      id: p.id, typ: p.typ,
      anlassId: typeof p.anlassId === 'string' && ID_RE.test(p.anlassId) ? p.anlassId : null,
      createdAt: iso(p.createdAt) || now, updatedAt: iso(p.updatedAt) || now,
      quelle: oneOf(p.quelle, ['v1']),
      kopf: compact({ bez: str(k.bez, 120), herkunft: str(k.herkunft, 200), beurteiler: str(k.beurteiler, 120), schnitt: date(k.schnitt), notiz: str(k.notiz, 4000), v1ProbeNr: str(k.v1ProbeNr, 120) }),
      antworten: cleanAntworten(p.antworten, p.typ),
      rad: cleanRad(p.rad, p.typ),
      kursProbeId: typeof p.kursProbeId === 'string' && ID_RE.test(p.kursProbeId) ? p.kursProbeId : undefined,
      abgegebenAt: iso(p.abgegebenAt),
      // nur lokal geführte Sync-Felder
      syncedAt: iso(p.syncedAt), dirty: bool(p.dirty),
    });
  }

  function cleanSpace(s) {
    if (!isObj(s) || !ID_RE.test(s.id || '') || !SECRET_RE.test(s.secret || '') || (s.mode !== 'w' && s.mode !== 'r')) return undefined;
    return compact({ id: s.id, mode: s.mode, secret: s.secret, consentAt: iso(s.consentAt) || str(s.consentAt, 40), consentVersion: str(s.consentVersion, 40), lastSync: iso(s.lastSync), metaDirty: bool(s.metaDirty) });
  }

  function cleanKurs(k) {
    if (!isObj(k) || !ID_RE.test(k.id || '') || !SECRET_RE.test(k.secret || '')) return undefined;
    return compact({ id: k.id, secret: k.secret, session: SECRET_RE.test(k.session || '') ? k.session : undefined,
      rolle: oneOf(k.rolle, ['leitung', 'teilnahme']), ichId: typeof k.ichId === 'string' && ID_RE.test(k.ichId) ? k.ichId : undefined,
      email: typeof k.email === 'string' && /^[^@\s]{1,64}@[^@\s]{1,190}$/.test(k.email) ? k.email : undefined });
  }

  function cleanAnlass(a, opts) {
    if (!isObj(a) || !ID_RE.test(a.id || '')) return null;
    const now = new Date().toISOString();
    return compact({
      id: a.id, titel: str(a.titel, 200) || 'Ohne Titel', datum: date(a.datum), ort: str(a.ort, 200), notiz: str(a.notiz, 4000),
      createdAt: iso(a.createdAt) || now, updatedAt: iso(a.updatedAt), quelle: oneOf(a.quelle, ['v1']),
      // Server-Zugang nur aus eigener Sicherung/eigenem Speicher übernehmen, nie aus fremden Exporten
      space: opts && opts.mitSpace ? cleanSpace(a.space) : undefined,
      kurs: opts && opts.mitSpace ? cleanKurs(a.kurs) : undefined,
    });
  }

  function cleanPrefs(p) {
    p = isObj(p) ? p : {};
    return { beurteiler: str(p.beurteiler, 120) || '', kuhGewicht: num(p.kuhGewicht, 300, 1200) || 630, mastGewicht: num(p.mastGewicht, K3.MAST.LG_MIN, K3.MAST.LG_MAX) || 400 };
  }

  /** Bereinigt eine komplette lokale Datenbank (beim Laden und beim Wiederherstellen einer Sicherung). */
  function cleanDb(db) {
    db = isObj(db) ? db : {};
    const anlaesse = (Array.isArray(db.anlaesse) ? db.anlaesse : []).map((a) => cleanAnlass(a, { mitSpace: true })).filter(Boolean);
    const proben = (Array.isArray(db.proben) ? db.proben : []).map(cleanProbe).filter(Boolean);
    const tombstones = (Array.isArray(db.tombstones) ? db.tombstones : []).filter((t) => typeof t === 'string' && ID_RE.test(t));
    return { v: 1, anlaesse, proben, prefs: cleanPrefs(db.prefs), tombstones, _persistAsked: !!db._persistAsked };
  }

  // ---------- Schutzklassen ----------
  const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  function setPath(o, path, v) {
    const ks = path.split('.'); let x = o;
    for (let i = 0; i < ks.length - 1; i++) { x[ks[i]] = x[ks[i]] || {}; x = x[ks[i]]; }
    x[ks[ks.length - 1]] = v;
  }
  function delPath(o, path) {
    const ks = path.split('.'); let x = o;
    for (let i = 0; i < ks.length - 1; i++) { x = x && x[ks[i]]; }
    if (x) delete x[ks[ks.length - 1]];
  }
  /** Teilt ein Objekt in {analyse, privat}. analyse enthält keine Felder der Klasse «privat». */
  function split(obj, art) {
    const analyse = JSON.parse(JSON.stringify(obj));
    const privat = {};
    PRIVAT[art].forEach((path) => { const v = getPath(obj, path); if (v !== undefined && v !== '') setPath(privat, path, v); delPath(analyse, path); });
    delete analyse.syncedAt; delete analyse.dirty; delete analyse.space; delete analyse.kurs;
    delete analyse.kursProbeId; delete analyse.abgegebenAt;
    return { analyse, privat };
  }
  /** Gegenstück zu split. */
  function merge(analyse, privat) {
    const o = JSON.parse(JSON.stringify(analyse || {}));
    (function walk(src, prefix) {
      Object.keys(src || {}).forEach((k) => {
        const path = prefix ? prefix + '.' + k : k;
        if (isObj(src[k])) walk(src[k], path); else setPath(o, path, src[k]);
      });
    })(privat, '');
    return o;
  }

  global.Model = { ID_RE, SECRET_RE, PRIVAT, cleanProbe, cleanAnlass, cleanDb, cleanPrefs, split, merge };
})(typeof window !== 'undefined' ? window : globalThis);
