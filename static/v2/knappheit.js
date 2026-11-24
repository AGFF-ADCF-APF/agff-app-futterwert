/* Futter v2 – Futterknappheit: Lohnt sich der Futterzukauf?
 *
 * Entscheidungshilfe in fünf Schritten nach den vier Fragen von Andreas Häberli (INFORAMA, «Trockenheit: Umgang mit
 * Futterknappheit in der Winterfütterung»): 1. Wie viel Raufutter fehlt? (Futterbilanz) 2. Sparen ohne Zukauf (Rationen
 * strecken, Raufutter nach Energiegehalt zuteilen) 3. Wer liefert, was darf Ersatzfutter kosten? (Paritätspreise)
 * 4. Lohnt sich eine Abstockung oder das Verstellen von Tieren? 5. Vergleich der Varianten.
 *
 * Verzehrsschätzung tierartneutral: Standard sind die Vorgaben aus Fuplan (Agridea/Agroscope), zum Vergleich das
 * Grüne Buch von Agroscope, wo es im Code eine Grundlage gibt (Milchkuh Kap. 7.6, Mastmuni Kap. 10). Für Tierarten
 * ohne Fuplan-Vorgabe (Mutterkuh, Pferd) gibt es einen gekennzeichneten Richtwert, der überschrieben werden soll.
 * Gespeichert nur auf diesem Gerät (localStorage).
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const KEY = 'agffV2Knappheit';
  const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.').replace(/[’'\s]/g, '')); return isFinite(n) ? n : null; };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => app().esc(s == null ? '' : String(s));
  const fmt = (v, d) => app().fmt(v, d);
  const fr = (v) => (v == null || !isFinite(v) ? '–' : 'Fr. ' + fmt(Math.round(v), 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  const dCH = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('de-CH') : '–');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- Fuplan-Vorgaben ----------
  /** Lineare Interpolation in einer Tabelle (ausserhalb: Randwert). */
  function lin(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[ys.length - 1];
  }
  // Fuplan, Blatt BedarfA: TS-Verzehr Aufzuchtrinder (kg TS/Tag) nach Lebendgewicht
  const AUFZ_LG = [125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 550, 600];
  const AUFZ = { frueh: [3.4, 3.7, 4.1, 4.5, 5.2, 6.0, 6.7, 7.4, 8.2, 8.9, 9.6, 10.4], spaet: [3.4, 3.8, 4.2, 4.6, 5.4, 6.2, 6.9, 7.7, 8.5, 9.3, 10.0, 10.8] };
  // Fuplan, Blatt BedarfM: TS-Verzehr Muni nach LG (Zeilen) und Tageszuwachs 1200–1500 g (Spalten)
  const MUNI_LG = [125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 550];
  const MUNI_TZW = [1200, 1300, 1400, 1500];
  const MUNI = [[3.6, 3.7, 3.8, 4.0], [4.0, 4.2, 4.3, 4.4], [4.4, 4.6, 4.7, 4.9], [4.8, 5.0, 5.2, 5.3], [5.6, 5.8, 6.0, 6.1], [6.4, 6.6, 6.7, 6.8],
    [7.1, 7.3, 7.4, 7.5], [7.9, 8.0, 8.1, 8.2], [8.6, 8.7, 8.8, 8.9], [9.3, 9.4, 9.5, 9.6], [10.0, 10.1, 10.2, 10.3]];
  // Fuplan, Blatt BedarfAue: TS-Verzehr Mutterschafe nach LG 50–80 kg und Stadium; Variante 1 = 1,5 Föten / 1 Lamm, 2 = 2 Föten / 2 Lämmer
  const AUE_LG = [50, 60, 70, 80];
  const AUE_ST = ['l1', 'l2', 'l3', 'l4', 'galt', 't4', 't5'];
  const AUE = {
    1: [[1.2, 1.4, 1.4, 1.2, 1.1, 1.1, 1.2], [1.3, 1.5, 1.5, 1.3, 1.2, 1.2, 1.3], [1.4, 1.6, 1.6, 1.4, 1.3, 1.4, 1.5], [1.5, 1.7, 1.7, 1.5, 1.4, 1.5, 1.7]],
    2: [[2.1, 2.1, 1.8, 1.4, 1.1, 1.1, 1.2], [2.2, 2.2, 1.9, 1.5, 1.2, 1.2, 1.3], [2.3, 2.3, 2.0, 1.6, 1.3, 1.4, 1.5], [2.4, 2.4, 2.1, 1.7, 1.4, 1.5, 1.7]],
  };
  // Fuplan, Blatt Verzehr_Milchvieh: Korrekturen zum Basis-Grundfutterverzehr von 16 kg TS (Kühe ab 2. Laktation)
  const KORR_SEL = [
    ['vorlage', 'Futtervorlage', [['', 'Norm: 7–9 Std. pro Tag', 0], ['immer', 'rund um die Uhr', 1], ['kurz', 'unter 7 Std. pro Tag', -0.5]]],
    ['reste', 'Krippenreste', [['', 'Norm: 5–10 %', 0], ['viel', 'stets grössere Mengen', 0.5], ['kaum', 'kaum vorhanden', -0.5]]],
    ['beginn', 'Fütterungsbeginn mit …', [['', 'üblich', 0], ['heu', 'Heu oder Emd', 0.5], ['schlecht', 'schlecht strukturiertem Raufutter', -0.5], ['kf', 'Kraftfutter, Rüben(schnitzel), Kartoffeln, CCM', -1]]],
    ['ration', 'Zusammensetzung der Grundfutterration', [['', 'üblich (keine Korrektur)', 0], ['keineGS', 'keine Grassilage', 1], ['gsW', 'Grassilage < 1/3, TS > 35 %', 1], ['gsV', 'Grassilage > 1/3, TS > 35 %', 0.5], ['gsN', 'Grassilage > 1/3, TS < 35 %', -0.5], ['sil34', 'Silagen > 3/4 (Dürrfutter < 1/4)', -1]]],
    ['gaer', 'Gärqualität', [['', 'einwandfrei', 0], ['nach', 'Nachgärung', -2], ['essig', 'hoher Essigsäuregehalt oder Erdbesatz', -1], ['butter', 'leichter Buttersäure- oder Ammoniakgeruch', -1]]],
  ];
  const KORR_CHK = [
    ['lang', 'Grassilage lang oder ungeschnitten (> 15 cm)', -1], ['mais', 'Maissilage > 1/3 der Ration', -0.5], ['rueben', '> 5 kg FS Rüben, Kartoffeln, Obst', 0.5],
    ['s1', 'Struktur: Grünfutter oder Silage sehr jung oder nass', -1], ['s2', 'Struktur zerstört (Häcksler, Fräse, Mischwagen)', -1],
    ['s3', 'Struktur: > 1/3 strukturarme Futter (Rübenblätter, -schnitzel)', -1], ['keinKf', 'kein Kraftfutter', 1],
  ];

  /* Kategorien. fuplan(g)/gb(g) liefern { ts, gf, quelle, teile } – gf: Wert ist bereits Grundfutterverzehr (sonst Gesamtverzehr,
   * davon wird das Kraftfutter abgezogen). richtwert: kein Fuplan-Wert vorhanden. */
  const KAT = {
    milchkuh: {
      t: 'Milchkühe', art: 'Rindvieh', def: { lg: 650, jahresmilch: 7000, phase: 'prod', laktation: '2' },
      felder: [['lg', 'Lebendgewicht (kg)'], ['jahresmilch', 'Jahresmilch (kg)'], ['phase', 'Phase', [['prod', 'Produktionsphase'], ['start', 'Startphase'], ['galt', 'Galtphase']]], ['bcs', 'Startphase: BCS > 4 (sehr fett)', 'chk']],
      gbFelder: [['milchTag', 'Milch aktuell (kg ECM/Tag)'], ['lwo', 'Laktationswoche'], ['laktation', 'Laktation', [['2', 'ab 2. Laktation'], ['1', '1. Laktation']]]],
      fuplan(g) {
        const t = [['Basisverzehr', 16]]; const add = (l, v) => { if (v) t.push([l, v]); };
        const lg = num(g.lg) || 650; const jm = num(g.jahresmilch) || 7000;
        if (g.phase === 'start' || g.phase === 'galt') add(g.phase === 'start' ? 'Startphase' : 'Galtphase', -1);
        add('Lebendgewicht ' + lg + ' kg', Math.round((lg - 650) / 10 * 0.1 * 100) / 100);
        add('Jahresmilch ' + jm + ' kg', Math.round((jm - 7000) / 100 * 0.1 * 100) / 100);
        if (g.bcs && g.phase === 'start') add('BCS > 4', -1);
        const k = g.korr || {};
        KORR_SEL.forEach(([key, , opt]) => { const o = opt.find((x) => x[0] === (k[key] || '')); if (o && o[2]) add(o[1], o[2]); });
        KORR_CHK.forEach(([key, l, v]) => { if (k[key]) add(l, v); });
        const nel = num(k.nel); if (nel) add('NEL-Korrektur (' + fmt(nel, 1) + ' MJ)', Math.round((nel - 5.6) * 3 * 100) / 100);
        return { ts: t.reduce((s, x) => s + x[1], 0), gf: true, quelle: 'Fuplan, Grundfutterverzehr Milchkuh', teile: t };
      },
      gb(g) {
        if (g.phase === 'galt' || !global.Bilanz || !global.Bilanz.verzehrKuh) return null;
        const jm = num(g.jahresmilch) || 7000; const ecm = num(g.milchTag) != null ? num(g.milchTag) : jm / 305;
        const lwo = num(g.lwo) || (g.phase === 'start' ? 5 : 20);
        const duerr = (g.korr || {}).ration === 'keineGS';
        return { ts: global.Bilanz.verzehrKuh(ecm, lwo, g.laktation === '1' ? '1' : '2', duerr), gf: false, quelle: 'Grünes Buch Kap. 7.6, Gesamtverzehr bei ' + fmt(ecm, 1) + ' kg ECM, Woche ' + lwo };
      },
    },
    mutterkuh: {
      t: 'Mutterkühe', art: 'Rindvieh', def: { lg: 650, phase: 'lakt' },
      felder: [['lg', 'Lebendgewicht (kg)'], ['phase', 'Phase', [['lakt', 'mit Kalb (laktierend)'], ['galt', 'galt / trocken']]]],
      fuplan(g) { const lg = num(g.lg) || 650; const f = g.phase === 'galt' ? 1.7 : 1.9; return { ts: lg * f / 100, gf: false, richtwert: true, quelle: 'Richtwert ' + fmt(f, 1) + ' kg TS je 100 kg LG (kein Fuplan-Wert – bitte prüfen)' }; },
    },
    aufzucht: {
      t: 'Aufzuchtrinder', art: 'Rindvieh', def: { lg: 350, reife: 'frueh' },
      felder: [['lg', 'Ø Lebendgewicht im Zeitraum (kg)'], ['reife', 'Rassentyp', [['frueh', 'frühreif (Erstkalbealter ~27 Mt.)'], ['spaet', 'spätreif (Erstkalbealter ~32 Mt.)']]]],
      fuplan(g) { const lg = clamp(num(g.lg) || 350, 125, 600); return { ts: lin(AUFZ_LG, AUFZ[g.reife === 'spaet' ? 'spaet' : 'frueh'], lg), gf: false, quelle: 'Fuplan, Aufzuchtrinder ' + (g.reife === 'spaet' ? 'spätreif' : 'frühreif') + ', ' + lg + ' kg' }; },
    },
    mast: {
      t: 'Mastrinder', art: 'Rindvieh', def: { typ: 'muni', lg: 400, tzw: 1300 },
      felder: [['typ', 'Kategorie', [['muni', 'Muni'], ['ochse', 'Ochsen'], ['rind', 'Mastrinder (weiblich)']]], ['lg', 'Ø Lebendgewicht (kg)'], ['tzw', 'Tageszuwachs (g)']],
      fuplan(g) {
        const lg = clamp(num(g.lg) || 400, 125, 600); const tzw = num(g.tzw) || 1300;
        if (g.typ === 'ochse' || g.typ === 'rind') return { ts: 1.306 + 0.01486 * lg + 0.212 * tzw / 1000, gf: false, quelle: 'Fuplan, Ochsen- und Rindermast' };
        const l = clamp(lg, 125, 550); const t = clamp(tzw, 1200, 1500);
        const zeile = MUNI.map((r) => lin(MUNI_TZW, r, t));
        return { ts: lin(MUNI_LG, zeile, l), gf: false, quelle: 'Fuplan, Munimast' + (tzw < 1200 || tzw > 1500 ? ' (Tageszuwachs auf 1200–1500 g begrenzt)' : '') };
      },
      gb(g) {
        const K3 = global.K3; if (g.typ !== 'muni' || !K3 || !K3.mastTsv) return null;
        const lg = clamp(num(g.lg) || 400, K3.MAST.LG_MIN, K3.MAST.LG_MAX); const tzw = num(g.tzw) || 1300;
        return { ts: K3.mastTsv(lg, tzw), gf: false, quelle: 'Grünes Buch Kap. 10, Mastmuni' };
      },
    },
    milchziege: {
      t: 'Milchziegen', art: 'Ziegen', def: { lg: 65, milch: 3, phase: 'prod' },
      felder: [['lg', 'Lebendgewicht (kg)'], ['milch', 'Milch (kg ECM/Tag)'], ['phase', 'Phase', [['prod', 'Laktation ab 3. Monat'], ['lm1', '1. Laktationsmonat (−15 %)'], ['lm2', '2. Laktationsmonat (−10 %)'], ['tm5', '5. Trächtigkeitsmonat (−10 bis −20 %)'], ['galt', 'galt, nicht trächtig']]]],
      fuplan(g) {
        const lg = num(g.lg) || 65; const m = g.phase === 'galt' || g.phase === 'tm5' ? 0 : (num(g.milch) || 0);
        const basis = 0.9 + lg / 100 + 0.27 * m; const t = [['Basis 0,9 + LG/100 + 0,27 × ECM', basis]];
        const proz = { lm1: -15, lm2: -10, tm5: lg <= 60 ? -20 : -10 }[g.phase];
        if (proz) t.push([proz + ' %', basis * proz / 100]);
        return { ts: t.reduce((s, x) => s + x[1], 0), gf: false, quelle: 'Fuplan, Verzehrsschätzung Milchziege', teile: t };
      },
    },
    milchschaf: {
      t: 'Milchschafe', art: 'Schafe', def: { lg: 70, milch: 1.5, phase: 'prod' },
      felder: [['lg', 'Lebendgewicht (kg)'], ['milch', 'Milch (kg/Tag)'], ['phase', 'Phase', [['prod', 'Laktation'], ['beginn', 'Laktationsbeginn (−10 %)'], ['tm45', '4./5. Trächtigkeitsmonat'], ['galt', 'galt, nicht trächtig']]], ['naehr', 'deutliche Verbesserung des Nährzustands (+10 %)', 'chk']],
      fuplan(g) {
        const lg = num(g.lg) || 70; const m = g.phase === 'galt' || g.phase === 'tm45' ? 0 : (num(g.milch) || 0);
        const basis = 0.6 + lg / 100 + 0.6 * m; const t = [['Basis 0,6 + LG/100 + 0,6 × Milch', basis]];
        if (g.phase === 'beginn') t.push(['Laktationsbeginn −10 %', -basis * 0.1]);
        if (g.phase === 'tm45' && lg > 60) t.push(['Trächtigkeit: +0,1 kg je 10 kg LG über 60 kg', (lg - 60) / 10 * 0.1]);
        if (g.naehr) t.push(['Verbesserung Nährzustand +10 %', basis * 0.1]);
        return { ts: t.reduce((s, x) => s + x[1], 0), gf: false, quelle: 'Fuplan, Verzehrsschätzung Milchschaf', teile: t };
      },
    },
    mutterschaf: {
      t: 'Mutterschafe', art: 'Schafe', def: { lg: 70, stadium: 'galt', wurf: '1' },
      felder: [['lg', 'Lebendgewicht (kg)'], ['stadium', 'Stadium', [['galt', 'Galtzeit'], ['t4', '4. Trächtigkeitsmonat'], ['t5', '5. Trächtigkeitsmonat'], ['l1', '1. Laktationsmonat'], ['l2', '2. Laktationsmonat'], ['l3', '3. Laktationsmonat'], ['l4', '4. Laktationsmonat']]], ['wurf', 'Föten / Lämmer', [['1', '1 Lamm (Ø 1,5 Föten)'], ['2', '2 Lämmer (2 Föten)']]]],
      fuplan(g) {
        const lg = clamp(num(g.lg) || 70, 50, 80); const i = Math.max(0, AUE_ST.indexOf(g.stadium || 'galt'));
        return { ts: lin(AUE_LG, AUE[g.wurf === '2' ? 2 : 1].map((r) => r[i]), lg), gf: false, quelle: 'Fuplan, Mutterschafe' };
      },
    },
    lamm: {
      t: 'Mastlämmer', art: 'Schafe', def: { lg: 30 },
      felder: [['lg', 'Ø Lebendgewicht (kg)']],
      fuplan(g) { const lg = clamp(num(g.lg) || 30, 20, 40); return { ts: lin([20, 25, 30, 35, 40], [0.8, 1.0, 1.2, 1.4, 1.6], lg), gf: false, quelle: 'Fuplan, Lämmermast' }; },
    },
    pferd: {
      t: 'Pferde', art: 'Pferde', def: { lg: 550, nutzung: 'erhaltung' },
      felder: [['lg', 'Lebendgewicht (kg)'], ['nutzung', 'Nutzung', [['erhaltung', 'Erhaltung, leichte Arbeit'], ['arbeit', 'mittlere bis schwere Arbeit'], ['stute', 'laktierende Stute']]]],
      fuplan(g) { const lg = num(g.lg) || 550; const f = { erhaltung: 1.75, arbeit: 2.0, stute: 2.25 }[g.nutzung] || 1.75; return { ts: lg * f / 100, gf: false, richtwert: true, quelle: 'Richtwert ' + fmt(f, 2) + ' kg TS je 100 kg LG (kein Fuplan-Wert – bitte prüfen; Raufutter mind. 1,5 kg TS je 100 kg LG)' }; },
    },
    andere: { t: 'Andere Tiere', art: 'Andere', def: {}, felder: [] },
  };

  // Fuplan, Blatt Futterbilanz: Raumgewichte und Ballengewichte
  const RAUM = [
    ['Dürrfutter am Stock, bis 3 m, normal (40 %), mittel-spät', 'm3', 85, 88], ['Dürrfutter am Stock, bis 3 m, schwer (55 %), mittel', 'm3', 105, 88],
    ['Dürrfutter am Stock, 4–5 m, normal', 'm3', 100, 88], ['Dürrfutter am Stock, über 5 m, normal', 'm3', 115, 88],
    ['Heu-Rundballe 1,2 × 1,2 m', 'ballen', 200, 88], ['Heu-Rundballe 1,2 × 1,5 m', 'ballen', 300, 88], ['Heu-Quaderballe 2 × 0,8 × 0,9 m', 'ballen', 230, 88],
    ['Heu-Quaderballe 2,4 × 1,2 × 0,7 m', 'ballen', 380, 88], ['Heu-Hochdruckballe', 'ballen', 27, 88],
    ['Stroh-Rundballe 1,2 × 1,2 m', 'ballen', 160, 88], ['Stroh-Rundballe 1,2 × 1,5 m', 'ballen', 250, 88], ['Stroh-Quaderballe 2 × 0,8 × 0,9 m', 'ballen', 180, 88], ['Stroh-Quaderballe 2,4 × 1,2 × 0,7 m', 'ballen', 300, 88],
    ['Silage-Rundballe 120 × 120 cm (35–40 % TS)', 'ballen', 650, 38], ['Silage-Quaderballe 150 × 90 × 60 cm', 'ballen', 350, 38], ['Silage-Quaderballe 170 × 90 × 80 cm', 'ballen', 650, 38],
    ['Grassilage angewelkt 30 % TS, Silo 3 m', 'm3', 600, 30], ['Grassilage angewelkt 30 % TS, Silo 8 m', 'm3', 700, 30], ['Grassilage 40 % TS, Silo 3 m', 'm3', 500, 40], ['Grassilage 40 % TS, Silo 8 m', 'm3', 600, 40],
    ['Grassilage 50 % TS, Silo 3 m', 'm3', 400, 50], ['Maissilage 30 % TS, Silo 4 m', 'm3', 550, 30], ['Maissilage 30 % TS, Silo 8 m', 'm3', 600, 30], ['CCM 50–60 % TS, Silo 3 m', 'm3', 800, 55],
  ];
  // Richtwerte für die Futterwahl (je kg TS). Heu: Beispiel aus dem Merkblatt Häberli; Stroh: Richtwert, bitte prüfen.
  const RICHTWERTE = [
    { n: 'Dürrfutter (Heu), Beispiel Merkblatt', ts: 88, nel: 5.3, rp: 130, rau: true, q: 'Beispiel aus dem Merkblatt Häberli (5,3 MJ NEL, 13 % RP)' },
    { n: 'Getreidestroh', ts: 88, nel: 3.6, nev: 3.4, apde: 42, apdn: 22, rp: 35, rau: false, q: 'Richtwert – bitte mit Tabelle oder Analyse prüfen' },
  ];
  // Referenzfutter für den Paritätspreis (Fuplan-Kraftfutterliste und Merkblatt Häberli; Gehalte je kg TS umgerechnet)
  const REF_DEF = {
    lf: { n: 'Leistungsfutter (Merkblatt: 7,2 MJ NEL, 17 % RP je kg)', ts: 88, nel: 8.18, rp: 193, preis: 55 },
    e: { n: 'Energieausgleichsfutter Gerste:Mais:Triticale 5:3:2 (Fuplan)', ts: 87, nel: 8.16, apde: 102, apdn: 78, preis: 41.5 },
    p: { n: 'Sojaschrot 44 % RP (Fuplan)', ts: 88, nel: 7.84, apde: 274, apdn: 388, preis: 70 },
  };

  // ---------- Zustand ----------
  function standardZeitraum() {
    const h = new Date(); const j = h.getMonth() >= 6 ? h.getFullYear() + 1 : h.getFullYear();
    return { start: iso(h), ende: j + '-04-30' };
  }
  function leer() {
    const z = standardZeitraum();
    return { v: 1, schritt: 1, start: z.start, ende: z.ende, verlust: 10, quelle: 'fuplan', gruppen: [], vorraete: [], angebote: [], massnahmen: [], ref: JSON.parse(JSON.stringify(REF_DEF)), zukaufId: '' };
  }
  function laden() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || !Array.isArray(s.gruppen)) s = leer();
    const l = leer(); Object.keys(l).forEach((k) => { if (s[k] == null) s[k] = l[k]; });
    Object.keys(REF_DEF).forEach((k) => { if (!s.ref[k]) s.ref[k] = JSON.parse(JSON.stringify(REF_DEF[k])); });
    return s;
  }
  let S = laden();
  const merken = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* privat */ } };
  const liste = (n) => S[n];
  const finde = (n, id) => (S[n] || []).find((x) => x.id === id);

  // ---------- Rechnen ----------
  const tageZwischen = (a, b) => { const d = (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5; return isFinite(d) ? Math.max(0, Math.round(d)) : 0; };
  /** Verzehr einer Gruppe: Fuplan, Grünes Buch und verwendeter Grundfutterverzehr je Tier und Tag. */
  function verzehr(g) {
    const k = KAT[g.kat] || KAT.andere; const kf = num(g.kf) || 0;
    const fu = k.fuplan ? k.fuplan(g) : null; const gb = k.gb ? k.gb(g) : null;
    const gfVon = (r) => (r ? Math.max(0, r.gf ? r.ts : r.ts - kf) : null);
    let gf; let quelle;
    const man = num(g.tsv);
    if (man != null) { gf = man; quelle = 'eigene Angabe'; }
    else if (S.quelle === 'gb' && gb) { gf = gfVon(gb); quelle = gb.quelle; }
    else if (fu) { gf = gfVon(fu); quelle = fu.quelle; }
    else { gf = 0; quelle = 'Verzehr eintragen'; }
    return { fu, gb, gfFu: gfVon(fu), gfGb: gfVon(gb), gf, quelle, man: man != null, kf };
  }
  function vorratWerte(v) {
    const m = num(v.menge) || 0; const je = v.einheit === 'dt' ? 100 : v.einheit === 'kg' ? 1 : (num(v.kgJe) || 0);
    const kgFs = m * je; const ts = num(v.ts) || 0;
    return { kgFs, kgTs: kgFs * ts / 100 };
  }
  function angebotWerte(a) {
    const ts = num(a.ts); const p = num(a.preis); const f = num(a.fracht) || 0; const nel = num(a.nel);
    const preis = p != null ? p + f : null; // Fr. je dt FS frei Hof
    const frDtTs = preis != null && ts ? preis / (ts / 100) : null;
    const fr10Mj = frDtTs != null && nel ? frDtTs / (nel * 100) * 10 : null;
    const par = paritaet(a);
    const basis = par.ep != null ? par.ep : par.lf;
    const verh = preis != null && basis ? preis / basis : null;
    return { ts, preis, frDtTs, fr10Mj, par, verh, ton: verh == null ? null : verh <= 1 ? 'gut' : verh <= 1.1 ? 'mittel' : 'schlecht' };
  }
  const apd = (x) => { const e = num(x.apde); const n = num(x.apdn); return e != null && n != null ? Math.min(e, n) : (e != null ? e : n); };
  /** Paritätspreise in Fr. je dt FS: (1) nur Energie gegenüber dem Leistungsfutter, (2) Energie und Protein aus zwei Referenzfuttern. */
  function paritaet(a) {
    const ts = num(a.ts); const nel = num(a.nel); const out = { lf: null, ep: null };
    if (!ts || !nel) return out;
    const lf = S.ref.lf; const lfTs = num(lf.ts); const lfNel = num(lf.nel); const lfP = num(lf.preis);
    if (lfTs && lfNel && lfP) out.lf = lfP * (nel * ts) / (lfNel * lfTs);
    const e = S.ref.e; const p = S.ref.p;
    const fs = (x, w) => (num(x.ts) || 0) / 100 * (w || 0); // Gehalt je kg FS
    const e1 = fs(e, num(e.nel)); const p1 = fs(e, apd(e)); const c1 = (num(e.preis) || 0) / 100;
    const e2 = fs(p, num(p.nel)); const p2 = fs(p, apd(p)); const c2 = (num(p.preis) || 0) / 100;
    const det = e1 * p2 - e2 * p1; const ax = apd(a);
    if (Math.abs(det) > 1e-9 && c1 && c2 && ax != null) {
      const fe = (c1 * p2 - c2 * p1) / det; const fp = (e1 * c2 - e2 * c1) / det; // Fr. je MJ NEL und je g APD
      if (fe > 0 && fp >= 0) { out.ep = (fe * nel + fp * ax) * ts / 100 * 100; out.fe = fe; out.fp = fp; }
    }
    return out;
  }
  function rechnen() {
    const tage = tageZwischen(S.start, S.ende); const vf = 1 + (num(S.verlust) || 0) / 100;
    const gruppen = S.gruppen.map((g) => {
      const v = verzehr(g); const n = num(g.anzahl) || 0; const t = num(g.tage) != null ? num(g.tage) : tage;
      return { g, v, n, t, kgTs: n * t * v.gf * vf, proTag: n * v.gf * vf };
    });
    const bedarf = gruppen.reduce((s, x) => s + x.kgTs, 0);
    const vorraete = S.vorraete.map((v) => Object.assign({ v }, vorratWerte(v)));
    const vorrat = vorraete.reduce((s, x) => s + x.kgTs, 0);
    const mitNel = vorraete.filter((x) => num(x.v.nel) && x.kgTs > 0);
    const nelVorrat = mitNel.length ? mitNel.reduce((s, x) => s + x.kgTs * num(x.v.nel), 0) / mitNel.reduce((s, x) => s + x.kgTs, 0) : null;
    const proTag = tage ? bedarf / tage : 0;
    const reichtTage = proTag ? vorrat / proTag : null;
    const reichtBis = reichtTage != null && S.start ? iso(new Date(new Date(S.start + 'T12:00:00').getTime() + reichtTage * 864e5)) : null;
    const fehl = bedarf - vorrat;
    const angebote = S.angebote.map((a) => Object.assign({ a }, angebotWerte(a)));
    const rau = angebote.filter((x) => x.a.rau && x.frDtTs != null);
    const zukauf = rau.find((x) => x.a.id === S.zukaufId) || rau.slice().sort((p, q) => p.frDtTs - q.frDtTs)[0] || null;
    const massnahmen = S.massnahmen.map((m) => Object.assign({ m }, wirkung(m, gruppen, angebote, vf, nelVorrat)));
    // Milch im Zeitraum (für Rp./kg Milch)
    const milch = gruppen.filter((x) => x.g.kat === 'milchkuh' && x.g.phase !== 'galt').reduce((s, x) => s + x.n * x.t * (num(x.g.milchTag) != null ? num(x.g.milchTag) : (num(x.g.jahresmilch) || 7000) / 305), 0);
    const r = { tage, vf, gruppen, bedarf, vorraete, vorrat, nelVorrat, proTag, reichtTage, reichtBis, fehl, angebote, zukauf, massnahmen, milch };
    r.varianten = varianten(r);
    return r;
  }
  /** Wirkung einer Massnahme: eingespartes Grundfutter (kg TS, inkl. Verluste) und Kosten in Franken. */
  function wirkung(m, gruppen, angebote, vf, nelVorrat) {
    const gr = gruppen.find((x) => x.g.id === m.gruppeId);
    const tiere = num(m.tiere) != null ? num(m.tiere) : (gr ? gr.n : 0);
    const tage = num(m.tage) != null ? num(m.tage) : (gr ? gr.t : 0);
    const out = { tiere, tage, kgTs: 0, kosten: 0, fehlt: [], gr };
    if (m.typ === 'strecken') {
      const ers = num(m.ersetzt) || 0; out.kgTs = tiere * tage * ers * vf;
      let nelZu = 0; let nelFehlt = false;
      (m.zusatz || []).forEach((z) => {
        const a = angebote.find((x) => x.a.id === z.aid); const kg = num(z.kgTs) || 0; if (!kg) return;
        if (!a) { out.fehlt.push('Zusatzfutter wählen'); return; }
        if (a.ts && a.preis != null) out.kosten += tiere * tage * kg / (a.ts / 100) / 100 * a.preis; else out.fehlt.push('Preis für «' + a.a.name + '» fehlt');
        if (num(a.a.nel)) nelZu += kg * num(a.a.nel); else nelFehlt = true;
      });
      const nelWeg = nelVorrat ? ers * nelVorrat : null;
      out.nel = { weg: nelWeg, zu: nelFehlt ? null : nelZu };
    } else if (m.typ === 'abstocken' || m.typ === 'verstellen') {
      const gf = gr ? gr.v.gf : 0; out.kgTs = tiere * tage * gf * vf;
      let tag;
      if (m.typ === 'abstocken') {
        tag = num(m.dbTag);
        if (tag == null && num(m.milchTag) != null) tag = num(m.milchTag) * (num(m.milchpreis) || 0) / 100 - (num(m.kfTag) || 0) * (num(m.kfPreis) || 0) / 100;
        if (tag == null) out.fehlt.push('entgangenen Deckungsbeitrag eintragen');
        out.tag = tag;
      } else { tag = num(m.pension); if (tag == null) out.fehlt.push('Pensionskosten eintragen'); out.tag = tag; }
      out.kosten = tiere * ((tag || 0) * tage + (num(m.einmalig) || 0));
    }
    out.frDtTs = out.kgTs > 0 ? out.kosten / (out.kgTs / 100) : null;
    return out;
  }
  /** Drei Varianten: alles zukaufen, Plan (aktive Massnahmen), günstigste Reihenfolge. */
  function varianten(r) {
    const fehl = Math.max(0, r.fehl); const zk = r.zukauf; const p = zk ? zk.frDtTs : null;
    const kauf = (kg) => (p != null ? kg / 100 * p : null);
    const v = [];
    v.push({ id: 'zukauf', t: 'Alles zukaufen', s: zk ? 'Lücke mit «' + zk.a.name + '» decken' : 'Raufutter-Angebot mit Preis erfassen', teile: [], kauf: fehl, kosten: kauf(fehl) });
    const akt = r.massnahmen.filter((x) => x.m.aktiv !== false && x.kgTs > 0);
    const gespart = akt.reduce((s, x) => s + x.kgTs, 0); const rest = Math.max(0, fehl - gespart);
    const kp = kauf(rest);
    v.push({ id: 'plan', t: 'Ihr Plan', s: akt.length ? akt.length + ' aktive Massnahme' + (akt.length > 1 ? 'n' : '') + ', Rest zukaufen' : 'Noch keine Massnahme aktiv', teile: akt.map((x) => ({ x, anteil: 1 })), kauf: rest, kosten: kp == null && rest > 0 ? null : akt.reduce((s, x) => s + x.kosten, 0) + (kp || 0), ueber: Math.max(0, gespart - fehl) });
    // günstigste Reihenfolge: nur Massnahmen, die je dt TS günstiger sind als der Zukauf
    const kand = r.massnahmen.filter((x) => x.kgTs > 0 && x.frDtTs != null && !x.fehlt.length && (p == null || x.frDtTs < p)).sort((a, b) => a.frDtTs - b.frDtTs);
    let offen = fehl; const teile = []; let k = 0;
    kand.forEach((x) => { if (offen <= 0) return; const ant = Math.min(1, offen / x.kgTs); teile.push({ x, anteil: ant }); k += x.kosten * ant; offen -= x.kgTs * ant; });
    const ko = kauf(offen);
    v.push({ id: 'opt', t: 'Günstigste Reihenfolge', s: 'Massnahmen nach Kosten je dt TS, bis die Lücke gedeckt ist', teile, kauf: Math.max(0, offen), kosten: ko == null && offen > 0 ? null : k + (ko || 0) });
    return v;
  }

  // ---------- Darstellung ----------
  const SCHRITTE = [[1, 'Bilanz'], [2, 'Sparen'], [3, 'Zukauf'], [4, 'Abstocken'], [5, 'Vergleich']];
  const dt = (kg) => fmt(kg / 100, 0);
  function inp(key, label, val, o) {
    o = o || {};
    return '<label class="field"><span>' + label + '</span><input class="input" data-knf="' + key + '"' + (o.typ ? ' data-kn-typ="' + o.typ + '"' : '') + ' type="' + (o.type || 'text') + '"' + (o.type || o.typ ? '' : ' inputmode="decimal"') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + ' value="' + esc(val == null ? '' : val) + '"></label>';
  }
  function sel(key, label, val, opts) {
    return '<label class="field"><span>' + label + '</span><select class="input" data-knf="' + key + '">' + opts.map((o) => '<option value="' + esc(o[0]) + '"' + (String(val == null ? '' : val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>';
  }
  const chk = (key, label, val) => '<label class="toggle"><input type="checkbox" data-knf="' + key + '"' + (val ? ' checked' : '') + '> ' + esc(label) + '</label>';
  function feld(f, g) { const [k, l, t] = f; return t === 'chk' ? chk(k, l, g[k]) : Array.isArray(t) ? sel(k, l, g[k], t) : inp(k, l, g[k]); }
  const card = (l, id, inner) => '<div class="card kn-karte" data-kn-l="' + l + '" data-kn-id="' + id + '">' + inner + '</div>';
  const weg = (l) => '<button class="icon-btn" data-kn="weg" data-liste="' + l + '" aria-label="Entfernen">×</button>';

  function render() {
    const A = app(); const r = rechnen();
    let h = '<div class="bar"><a class="icon-btn back-btn hide-wide" href="#/" aria-label="Zurück">' + A.I.back + '</a><h2>Futterknappheit <span class="badge-beta">Beta</span><span class="sub">Lohnt sich der Futterzukauf?</span></h2>' +
      '<button class="btn sm" data-kn="pdf">' + A.I.pdf + ' PDF</button></div><div class="wizard knappheit">';
    h += '<div class="seg kn-schritte" role="tablist">' + SCHRITTE.map(([n, t]) => '<button data-kn="schritt" data-val="' + n + '" aria-pressed="' + (S.schritt === n) + '"><span class="kn-nr">' + n + '</span> ' + t + '</button>').join('') + '</div>';
    h += kpis(r);
    h += [null, schritt1, schritt2, schritt3, schritt4, schritt5][S.schritt](r);
    const nx = SCHRITTE.find((x) => x[0] === S.schritt + 1);
    h += '<div class="row" style="margin-top:18px;flex-wrap:wrap">' + (S.schritt > 1 ? '<button class="btn" data-kn="schritt" data-val="' + (S.schritt - 1) + '">← Zurück</button>' : '') + '<span class="grow"></span>' +
      (nx ? '<button class="btn primary" data-kn="schritt" data-val="' + nx[0] + '">Weiter: ' + nx[1] + ' →</button>' : '') + '</div>';
    h += '<p class="small muted" style="margin-top:22px">Grundlagen: A. Häberli, INFORAMA: «Trockenheit: Umgang mit Futterknappheit in der Winterfütterung»; Verzehrsvorgaben aus Fuplan (Agridea), zum Vergleich Agroscope, Fütterungsempfehlungen für Wiederkäuer (Grünes Buch); Einzelfutter: Agroscope-Referenzwerte. Die Rechnung ist eine Orientierung und ersetzt keine Fütterungs- oder Betriebsberatung. Ihre Angaben bleiben auf diesem Gerät.</p>';
    return h + '</div>';
  }
  function kpis(r) {
    const saldo = r.vorrat - r.bedarf;
    const k = (l, v, u, d, ton) => '<div class="kpi"><div class="l">' + l + '</div><div class="v">' + v + (u ? ' <small>' + u + '</small>' : '') + '</div>' + (d ? '<div class="d ' + (ton || '') + '">' + d + '</div>' : '') + '</div>';
    return '<div class="kpis" style="margin:14px 0 18px">' +
      k('Bedarf Grundfutter', dt(r.bedarf), 'dt TS', r.tage + ' Tage bis ' + dCH(S.ende)) +
      k('Vorrat', dt(r.vorrat), 'dt TS', r.nelVorrat ? 'Ø ' + fmt(r.nelVorrat, 1) + ' MJ NEL/kg TS' : '') +
      k(saldo < 0 ? 'Fehlmenge' : 'Überschuss', dt(Math.abs(saldo)), 'dt TS', r.bedarf ? fmt(Math.abs(saldo) / r.bedarf * 100, 0) + ' % des Bedarfs' : '', saldo < 0 ? 'neg' : 'pos') +
      k('Vorrat reicht bis', r.reichtBis && r.bedarf ? (r.reichtTage >= r.tage ? 'Ende ✓' : dCH(r.reichtBis)) : '–', '', r.reichtTage != null && r.bedarf ? fmt(r.reichtTage, 0) + ' Futtertage' : '', r.reichtTage != null && r.reichtTage < r.tage ? 'neg' : 'pos') + '</div>';
  }

  // Schritt 1: Bilanz
  function schritt1(r) {
    let h = '<div class="alert info">' + app().I.warn + '<div><b>1. Wie viel Raufutter fehlt mir tatsächlich?</b> Erfassen Sie Ihre Tiergruppen und Ihre Vorräte. Der Verzehr wird nach den Vorgaben von Fuplan geschätzt; Sie können ihn je Gruppe überschreiben.' +
      (S.gruppen.length || S.vorraete.length ? '' : ' <button class="btn sm" data-kn="beispiel" style="margin-top:6px">Beispielbetrieb laden</button>') + '</div></div>';
    h += '<section class="q" style="margin-top:16px"><h3>Zeitraum</h3><div class="grid4">' +
      inp('start', 'Vorrat erhoben am', S.start, { type: 'date', typ: 's' }) + inp('ende', 'Ende Winterfütterung', S.ende, { type: 'date', typ: 's' }) +
      inp('verlust', 'Futterverluste (%)', S.verlust) + '<div class="field"><span>Futtertage</span><div class="bl-wert">' + r.tage + '</div></div></div>' +
      '<p class="small muted">Fuplan rechnet standardmässig 10 % Verluste (Krippenreste, Lagerverluste) zum Bedarf hinzu.</p></section>';
    h += '<section class="q"><h3>Verzehrsschätzung</h3><div class="seg" role="group">' + [['fuplan', 'Fuplan (Standard)'], ['gb', 'Grünes Buch (Vergleich)']].map(([v, t]) => '<button data-kn="quelle" data-val="' + v + '" aria-pressed="' + (S.quelle === v) + '">' + t + '</button>').join('') + '</div>' +
      '<p class="small muted">Das Grüne Buch ist im Programm für Milchkühe (Kap. 7.6) und Mastmuni (Kap. 10) hinterlegt; für die übrigen Tiere gilt immer Fuplan oder der angezeigte Richtwert.</p></section>';
    // Herde
    h += '<section class="q"><h3>Tiere im Winter</h3><div class="stack">' + (r.gruppen.length ? r.gruppen.map((x) => gruppeKarte(x, r)).join('') : '<p class="small muted">Noch keine Tiergruppe.</p>') + '</div>' +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap"><select class="input" id="knNeuKat" style="max-width:260px">' +
      ['Rindvieh', 'Schafe', 'Ziegen', 'Pferde', 'Andere'].map((art) => '<optgroup label="' + art + '">' + Object.entries(KAT).filter(([, k]) => k.art === art).map(([id, k]) => '<option value="' + id + '">' + k.t + '</option>').join('') + '</optgroup>').join('') +
      '</select><button class="btn" data-kn="add-gruppe">+ Tiergruppe</button></div></section>';
    // Vorräte
    h += '<section class="q"><h3>Grundfuttervorräte</h3><div class="stack">' + (r.vorraete.length ? r.vorraete.map((x) => vorratKarte(x)).join('') : '<p class="small muted">Noch kein Vorrat erfasst.</p>') + '</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn" data-kn="add-vorrat">+ Vorrat</button></div></section>';
    // Ergebnis
    if (r.gruppen.length) {
      h += '<section class="q"><h3>Bedarf nach Tiergruppe</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Gruppe</th><th>Tiere</th><th>Tage</th><th>Fuplan</th><th>Grünes Buch</th><th>verwendet</th><th>dt TS</th></tr></thead><tbody>' +
        r.gruppen.map((x) => '<tr><td>' + esc(x.g.name || KAT[x.g.kat].t) + '</td><td>' + fmt(x.n, 0) + '</td><td>' + fmt(x.t, 0) + '</td><td>' + fmt(x.v.gfFu, 1) + (x.v.fu && x.v.fu.richtwert ? '*' : '') + '</td><td>' + fmt(x.v.gfGb, 1) + '</td><td><b>' + fmt(x.v.gf, 1) + '</b></td><td>' + dt(x.kgTs) + '</td></tr>').join('') +
        '<tr><td><b>Total</b> (inkl. ' + fmt(num(S.verlust) || 0, 0) + ' % Verluste)</td><td></td><td></td><td></td><td></td><td></td><td><b>' + dt(r.bedarf) + '</b></td></tr></tbody></table></div>' +
        '<p class="small muted">Grundfutterverzehr in kg TS je Tier und Tag (Kraftfutter abgezogen). * Richtwert, kein Fuplan-Wert.</p></section>';
      h += zuteilung(r);
    }
    return h;
  }
  function gruppeKarte(x, r) {
    const g = x.g; const k = KAT[g.kat] || KAT.andere; const v = x.v;
    let h = '<div class="row"><b class="grow">' + esc(k.t) + '</b>' + weg('gruppen') + '</div>' +
      '<div class="grid4" style="margin-top:6px">' + inp('name', 'Bezeichnung', g.name, { typ: 's', ph: k.t }) + inp('anzahl', 'Anzahl Tiere', g.anzahl) + inp('tage', 'Futtertage', g.tage, { ph: String(r.tage) }) +
      inp('kf', 'Kraftfutter kg TS/Tag', g.kf, { ph: '0' }) + '</div>';
    const fo = k.felder.filter((f) => f[2] !== 'chk'); const fc = k.felder.filter((f) => f[2] === 'chk');
    if (fo.length) h += '<div class="grid4" style="margin-top:6px">' + fo.map((f) => feld(f, g)).join('') + '</div>';
    if (fc.length && !(g.kat === 'milchkuh' && g.phase !== 'start')) h += '<div class="row" style="margin-top:6px">' + fc.map((f) => feld(f, g)).join('') + '</div>';
    if (g.kat === 'milchkuh') {
      const kk = g.korr || {};
      h += '<details class="kn-det"><summary>Korrekturen nach Fuplan (Fütterungstechnik, Ration)</summary><div class="grid2" style="margin-top:8px">' +
        KORR_SEL.map(([key, l, opt]) => sel('korr.' + key, l, kk[key] || '', opt.map((o) => [o[0], o[1] + (o[2] ? ' (' + (o[2] > 0 ? '+' : '') + fmt(o[2], 1) + ')' : '')]))).join('') +
        inp('korr.nel', 'NEL der Grundfutterration (MJ/kg TS)', kk.nel, { ph: r.nelVorrat ? fmt(r.nelVorrat, 1) : '5,6' }) + '</div>' +
        '<div class="stack" style="margin-top:8px;gap:4px">' + KORR_CHK.map(([key, l, val]) => chk('korr.' + key, l + ' (' + (val > 0 ? '+' : '') + fmt(val, 1) + ')', kk[key])).join('') + '</div>' +
        '<p class="small muted">Fuplan: Basis 16 kg TS Grundfutter für Kühe ab 2. Laktation; NEL-Korrektur ±0,3 kg je 0,1 MJ Abweichung von 5,6 MJ. Bei Erstmelkkühen ist der Verzehr tiefer.</p></details>' +
        '<details class="kn-det"><summary>Angaben für den Vergleich mit dem Grünen Buch</summary><div class="grid4" style="margin-top:8px">' + k.gbFelder.map((f) => feld(f, g)).join('') + '</div></details>';
    }
    const zeile = (l, w, rq) => '<span><span>' + l + '</span><b>' + (w == null ? '–' : fmt(w, 1)) + '</b>' + (rq ? '<i class="small muted">' + esc(rq) + '</i>' : '') + '</span>';
    h += '<div class="kn-verzehr">' + zeile('Fuplan' + (v.fu && v.fu.richtwert ? ' (Richtwert)' : ''), v.gfFu, v.fu ? v.fu.quelle : 'keine Vorgabe') +
      (k.gb ? zeile('Grünes Buch', v.gfGb, v.gb ? v.gb.quelle : 'nicht anwendbar') : '') +
      '<label><span>eigener Wert</span><input class="input sm" data-knf="tsv" inputmode="decimal" placeholder="' + (v.gfFu != null ? fmt(v.gfFu, 1) : 'kg TS') + '" value="' + esc(g.tsv == null ? '' : g.tsv) + '"></label>' +
      '<span class="kn-res"><span>Grundfutter je Tier/Tag</span><b>' + fmt(v.gf, 1) + ' kg TS</b><i class="small muted">' + esc(v.quelle) + '</i></span></div>';
    if (v.fu && v.fu.teile && v.fu.teile.length > 1) h += '<p class="small muted" style="margin:6px 0 0">' + v.fu.teile.map(([l, w], i) => (i ? (w >= 0 ? '+ ' : '− ') + fmt(Math.abs(w), 2) : fmt(w, 2)) + ' ' + esc(l)).join(' ') + '</p>';
    if (v.gfFu != null && v.gfGb != null && Math.abs(v.gfFu - v.gfGb) > 1) h += '<p class="small" style="margin:6px 0 0">Fuplan und Grünes Buch liegen ' + fmt(Math.abs(v.gfFu - v.gfGb), 1) + ' kg TS auseinander – das sind ' + dt(Math.abs(v.gfFu - v.gfGb) * x.n * x.t) + ' dt TS im Zeitraum.</p>';
    if (g.kat === 'milchkuh' && !num(g.kf) && S.quelle === 'gb') h += '<p class="small muted" style="margin:6px 0 0">Für das Grüne Buch das Kraftfutter eintragen – es wird vom Gesamtverzehr abgezogen.</p>';
    return card('gruppen', g.id, h);
  }
  function vorratKarte(x) {
    const v = x.v;
    let h = '<div class="row"><input class="input grow" data-knf="name" data-kn-typ="s" value="' + esc(v.name) + '" placeholder="Bezeichnung, z. B. Heu 1. Schnitt" aria-label="Bezeichnung">' + weg('vorraete') + '</div>' +
      '<div class="grid4" style="margin-top:6px">' + inp('menge', 'Menge', v.menge) + sel('einheit', 'Einheit', v.einheit || 'dt', [['dt', 'dt Frischsubstanz'], ['kg', 'kg Frischsubstanz'], ['ballen', 'Ballen'], ['m3', 'm³']]) +
      (v.einheit === 'ballen' || v.einheit === 'm3' ? inp('kgJe', v.einheit === 'ballen' ? 'kg je Ballen' : 'kg je m³', v.kgJe) : '<span></span>') + inp('ts', 'TS %', v.ts) + '</div>' +
      (v.einheit === 'ballen' || v.einheit === 'm3' ? '<label class="field" style="margin-top:6px"><span>Raumgewicht nach Fuplan übernehmen</span><select class="input" data-knrg="1"><option value="">– wählen –</option>' + RAUM.map((rg, i) => rg[1] === v.einheit ? '<option value="' + i + '">' + esc(rg[0]) + ' – ' + rg[2] + ' kg' + (rg[1] === 'm3' ? '/m³' : '') + '</option>' : '').join('') + '</select></label>' : '') +
      '<div class="bl-werte">' + ['nel', 'apde', 'apdn', 'rp'].map((k) => '<label><span>' + k.toUpperCase() + '</span><input class="input sm" data-knf="' + k + '" inputmode="decimal" value="' + esc(v[k] == null ? '' : v[k]) + '"></label>').join('') + '<span class="small muted">je kg TS</span>' +
      '<button class="btn sm" data-kn="futter" data-liste="vorraete">Gehalte übernehmen …</button></div>' +
      '<p class="small" style="margin:6px 0 0"><b>' + fmt(x.kgFs / 100, 1) + ' dt FS = ' + fmt(x.kgTs / 100, 1) + ' dt TS</b>' + (v.herkunft ? ' <span class="muted">· Gehalte: ' + esc(v.herkunft) + '</span>' : '') + '</p>';
    return card('vorraete', v.id, h);
  }
  function zuteilung(r) {
    const v = r.vorraete.filter((x) => x.kgTs > 0 && num(x.v.nel)).sort((a, b) => num(b.v.nel) - num(a.v.nel));
    if (v.length < 2) return '';
    return '<section class="q"><h3>Raufutter nach Energiegehalt zuteilen</h3><p class="qhint">Das beste Raufutter für frischmelkende Kühe und Kühe in der Startphase; das energieärmere für Galtkühe, Jungvieh im 2. Lebensjahr, Altmelkkühe, Mutterkühe und Pferde – dort lässt sich auch mit Stroh strecken (Schritt 2).</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vorrat</th><th>MJ NEL</th><th>dt TS</th><th>passt für</th></tr></thead><tbody>' +
      v.map((x, i) => '<tr><td>' + esc(x.v.name || 'Vorrat') + '</td><td>' + fmt(num(x.v.nel), 1) + '</td><td>' + fmt(x.kgTs / 100, 0) + '</td><td style="text-align:left;white-space:normal">' + (num(x.v.nel) >= 5.8 ? 'Startphase, hohe Leistung' : num(x.v.nel) >= 5.2 ? (i === 0 ? 'Milchkühe' : 'Milchkühe Produktion, Aufzucht 1. Jahr') : 'Galtkühe, Jungvieh 2. Jahr, Mutterkühe, Pferde') + '</td></tr>').join('') + '</tbody></table></div></section>';
  }

  // Schritt 2: Sparen ohne (viel) Zukauf
  function schritt2(r) {
    let h = '<div class="alert info">' + app().I.warn + '<div><b>Sparen, bevor man zukauft.</b> Rationen mit Stroh strecken und mit Ausgleichsfutter ergänzen, vor allem bei Galtkühen, Jungvieh im 2. Lebensjahr und Altmelkkühen. Je Massnahme sehen Sie das eingesparte Grundfutter und die Kosten der Ersatzfutter.</div></div>';
    h += '<section class="q" style="margin-top:16px"><h3>Vorlagen aus dem Merkblatt</h3><div class="row" style="flex-wrap:wrap">' +
      '<button class="btn" data-kn="vorlage" data-val="galt">Galtkühe: Stroh statt Dürrfutter</button><button class="btn" data-kn="vorlage" data-val="jung">Jungvieh 2. Jahr: weniger Dürrfutter</button></div>' +
      '<p class="small muted">Häberli: Galtkühe 6,6 kg Dürrfutter A4 + 6,6 kg Ökoheu + 0,7 kg Maissilage ersetzt durch 8,1 kg Stroh, 3,8 kg Maissilage und 2,0 kg Rapskuchen (je kg TS, 4,7 MJ NEL) – bei 5 Galtkühen und 150 Tagen rund 112 dt Dürrfutter gespart. Jungvieh: 8,9 kg Dürrfutter ersetzt durch 4,4 kg Dürrfutter, 1,8 kg Stroh und 2,7 kg Mühlennachproduktegemisch – bei 10 Tieren rund 76 dt.</p></section>';
    const ms = r.massnahmen.filter((x) => x.m.typ === 'strecken');
    h += '<section class="q"><h3>Rationen strecken</h3><div class="stack">' + (ms.length ? ms.map((x) => massKarte(x, r)).join('') : '<p class="small muted">Noch keine Massnahme.</p>') + '</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn" data-kn="add-mass" data-val="strecken"' + (S.gruppen.length ? '' : ' disabled title="Zuerst Tiergruppen erfassen"') + '>+ Ration strecken</button></div></section>';
    return h;
  }
  function gruppenOpt(m) { return [['', '– Gruppe wählen –']].concat(S.gruppen.map((g) => [g.id, (g.name || KAT[g.kat].t) + ' (' + (num(g.anzahl) || 0) + ')'])); }
  function massKarte(x, r) {
    const m = x.m; const titel = { strecken: 'Ration strecken', abstocken: 'Früher verkaufen (abstocken)', verstellen: 'Tiere verstellen (Pension)' }[m.typ];
    let h = '<div class="row"><label class="toggle grow"><input type="checkbox" data-knf="aktiv"' + (m.aktiv !== false ? ' checked' : '') + '> <b>' + titel + '</b></label>' + weg('massnahmen') + '</div>' +
      (m.notiz ? '<p class="small muted" style="margin:4px 0 0">' + esc(m.notiz) + '</p>' : '') + '<div class="grid4" style="margin-top:6px">' + sel('gruppeId', 'Tiergruppe', m.gruppeId, gruppenOpt(m)) + inp('tiere', 'Tiere', m.tiere, { ph: x.gr ? String(x.gr.n) : '' }) +
      inp('tage', m.typ === 'abstocken' ? 'Tage früher verkauft' : m.typ === 'verstellen' ? 'Tage auswärts' : 'Tage', m.tage, { ph: x.gr ? String(x.gr.t) : '' });
    if (m.typ === 'strecken') {
      h += inp('ersetzt', 'Grundfutter ersetzt (kg TS/Tier/Tag)', m.ersetzt) + '</div>';
      const opts = [['', '– Futter wählen –']].concat(S.angebote.map((a) => [a.id, a.name || 'Futter']));
      h += '<div class="stack" style="margin-top:8px;gap:6px">' + (m.zusatz || []).map((z, i) => '<div class="row kn-zusatz" data-kn-z="' + i + '">' + sel('aid', i ? '' : 'Ersatz- und Ausgleichsfutter', z.aid, opts) + inp('kgTs', i ? '' : 'kg TS/Tier/Tag', z.kgTs) + '<button class="icon-btn" data-kn="zusatz-weg" data-i="' + i + '" aria-label="Entfernen">×</button></div>').join('') +
        '<div class="row"><button class="btn sm" data-kn="zusatz-add">+ Ersatzfutter</button><a class="small" href="#" data-kn="schritt" data-val="3">Futter und Preise erfassen (Schritt 3)</a></div></div>';
      if (x.nel && x.nel.weg != null && x.nel.zu != null && num(m.ersetzt)) {
        const d = x.nel.zu - x.nel.weg;
        h += '<p class="small" style="margin:8px 0 0">Energie: ersetzt ' + fmt(x.nel.weg, 0) + ' MJ NEL, Ersatz liefert ' + fmt(x.nel.zu, 0) + ' MJ NEL je Tier und Tag' + (Math.abs(d) > 3 ? ' – <b>' + (d < 0 ? 'Energielücke ' : 'Überschuss ') + fmt(Math.abs(d), 0) + ' MJ</b>' : ' – vergleichbar') + '.</p>';
      }
    } else if (m.typ === 'abstocken') {
      h += inp('einmalig', 'Einmalig Fr./Tier (Mindererlös +, Mehrerlös −)', m.einmalig) + '</div>' +
        '<div class="grid4" style="margin-top:6px">' + inp('dbTag', 'Entgangener Deckungsbeitrag Fr./Tier/Tag', m.dbTag, { ph: x.tag != null ? fmt(x.tag, 2) : '' }) + inp('milchTag', 'oder: Milch kg/Tag', m.milchTag) + inp('milchpreis', 'Milchpreis Rp./kg', m.milchpreis) + inp('kfTag', 'Kraftfutter kg/Tag', m.kfTag) + inp('kfPreis', 'KF-Preis Fr./dt', m.kfPreis) + '</div>' +
        '<p class="small muted">Für Milchkühe: Milchmenge × Milchpreis − Kraftfutterkosten; für andere Tiere den Deckungsbeitrag direkt eintragen.</p>';
    } else {
      h += inp('pension', 'Pension Fr./Tier/Tag', m.pension) + '</div><div class="grid4" style="margin-top:6px">' + inp('einmalig', 'Transport u. a. Fr./Tier', m.einmalig) + '</div>';
    }
    h += '<p class="small" style="margin:8px 0 0"><b>Spart ' + dt(x.kgTs) + ' dt TS Grundfutter</b> (≈ ' + fmt(x.kgTs / 88, 0) + ' dt Heu) · Kosten ' + fr(x.kosten) + (x.frDtTs != null ? ' · <b>' + fr(x.frDtTs) + ' je dt TS</b>' : '') +
      (r.zukauf && x.frDtTs != null ? ' <span class="kn-ton ' + (x.frDtTs < r.zukauf.frDtTs ? 'gut' : 'schlecht') + '">' + (x.frDtTs < r.zukauf.frDtTs ? 'günstiger' : 'teurer') + ' als Zukauf (' + fr(r.zukauf.frDtTs) + ')</span>' : '') + '</p>' +
      (x.fehlt.length ? '<p class="small" style="margin:4px 0 0;color:var(--kritisch)">' + esc(Array.from(new Set(x.fehlt)).join(' · ')) + '</p>' : '');
    return card('massnahmen', m.id, h);
  }

  // Schritt 3: Zukauf und Paritätspreise
  function schritt3(r) {
    let h = '<div class="alert info">' + app().I.warn + '<div><b>2. Wer liefert? 3. Was darf Ersatzfutter kosten?</b> Erfassen Sie Angebote mit Preis frei Hof. Der Paritätspreis zeigt, was ein Futter im Vergleich zu Kraftfutter wert ist – Maissilage und silierte Zuckerrübenschnitzel haben meist eine gute Preisparität, Dürrfutter liegt teils darüber; bei Grassilage auf die Qualität achten.</div></div>';
    h += '<section class="q" style="margin-top:16px"><h3>Bezugsquellen</h3><ul class="kn-links">' +
      [['https://www.bernerbauern.ch', 'Berner Bauern Verband – Services, Futtermittelbörse'], ['https://www.raufutterboerse.ch', 'raufutterboerse.ch'], ['https://www.sbv-usp.ch/de/preise/pflanzenbau/', 'SBV: Richtpreise Pflanzenbau (Raufutter)']]
        .map(([u, t]) => '<li><a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + ' ↗</a></li>').join('') +
      '<li class="small muted">Berufskollegen, Inserate in Agrarmedien, Lebensmittelindustrie (Brauereien, Zuckerfabrik, Mühlen)</li></ul></section>';
    // Angebote
    h += '<section class="q"><h3>Angebote und Ersatzfutter</h3>' + (r.angebote.filter((x) => x.a.rau).length ? '<label class="field" style="margin-bottom:10px"><span>Fehlendes Raufutter decken mit</span><select class="input" data-knf="zukaufId"><option value="">günstigstes Raufutter je dt TS</option>' +
      r.angebote.filter((x) => x.a.rau).map((x) => '<option value="' + x.a.id + '"' + (S.zukaufId === x.a.id ? ' selected' : '') + '>' + esc(x.a.name) + (x.frDtTs != null ? ' – ' + fr(x.frDtTs) + '/dt TS' : ' – Preis fehlt') + '</option>').join('') + '</select></label>' : '') +
      (r.zukauf && r.nelVorrat && num(r.zukauf.a.nel) && num(r.zukauf.a.nel) < r.nelVorrat - 0.4 ? '<div class="alert warn" style="margin-bottom:10px">' + app().I.warn + '<div>«' + esc(r.zukauf.a.name) + '» hat mit ' + fmt(num(r.zukauf.a.nel), 1) + ' MJ NEL deutlich weniger Energie als Ihr Vorrat (Ø ' + fmt(r.nelVorrat, 1) + ' MJ). Es ersetzt Ihr Grundfutter nicht gleichwertig – die Energie muss mit Kraftfutter ergänzt werden.</div></div>' : '') +
      '<p class="small muted">«Raufutter» heisst hier: Futter, das Ihr eigenes Grundfutter gleichwertig ersetzt (Heu, Emd, Gras- oder Maissilage). Stroh und Nebenprodukte zum Strecken gehören zu den Ersatzfuttern (Schritt 2).</p>' +
      '<div class="stack">' + (r.angebote.length ? r.angebote.map((x) => angebotKarte(x)).join('') : '<p class="small muted">Noch kein Angebot erfasst.</p>') + '</div>' +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn" data-kn="add-angebot" data-val="rau">+ Raufutter-Angebot</button><button class="btn" data-kn="add-angebot" data-val="">+ Ersatz-/Kraftfutter</button></div></section>';
    // Referenzen
    h += '<section class="q"><h3>Referenzpreise für die Parität</h3><p class="qhint">Fuplan-Vorgaben als Startwert – bitte aktuelle Preise frei Hof einsetzen. Gehalte je kg TS.</p><div class="stack">' +
      [['lf', 'Nur Energie: Vergleich mit Leistungsfutter'], ['e', 'Energie und Protein: Energiefutter'], ['p', 'Energie und Protein: Proteinfutter']].map(([k, l]) => {
        const f = S.ref[k];
        return '<div class="card" data-kn-ref="' + k + '"><div class="small muted" style="font-weight:700">' + l + '</div><div class="row" style="margin-top:4px"><input class="input grow" data-knf="n" data-kn-typ="s" value="' + esc(f.n) + '" aria-label="Bezeichnung"></div>' +
          '<div class="bl-werte">' + [['preis', 'Fr./dt FS'], ['ts', 'TS %'], ['nel', 'NEL'], ['apde', 'APDE'], ['apdn', 'APDN']].filter(([kk]) => k !== 'lf' || ['preis', 'ts', 'nel'].includes(kk)).map(([kk, ll]) => '<label><span>' + ll + '</span><input class="input sm" data-knf="' + kk + '" inputmode="decimal" value="' + esc(f[kk] == null ? '' : f[kk]) + '"></label>').join('') + '</div></div>';
      }).join('') + '</div>' +
      '<p class="small muted">Energie und Protein: Aus den Preisen der beiden Referenzfutter werden die Kosten je MJ NEL und je g APD bestimmt (APD = der tiefere von APDE und APDN); damit wird jedes Futter bewertet. Merkblatt Häberli: Dürrfutter mit 5,3 MJ NEL und 13 % RP hat gegenüber Leistungsfutter (7,2 MJ NEL, 17 % RP, Fr. 55.–/dt) einen Paritätspreis von rund Fr. 40.–/dt. Rechnet man das Heu wie das Leistungsfutter auf Frischsubstanz (88 % TS) um, ergeben sich rund Fr. 36.–/dt – so rechnet dieses Werkzeug. Raufutter hat zusätzlich einen Wert für die Struktur, den die Parität nicht abbildet.</p></section>';
    return h;
  }
  function angebotKarte(x) {
    const a = x.a; const p = x.par;
    let h = '<div class="row"><input class="input grow" data-knf="name" data-kn-typ="s" value="' + esc(a.name) + '" placeholder="Bezeichnung" aria-label="Bezeichnung">' + weg('angebote') + '</div>' +
      '<div class="grid4" style="margin-top:6px">' + inp('preis', 'Preis Fr./dt FS', a.preis) + inp('fracht', 'Fracht Fr./dt FS', a.fracht) + inp('ts', 'TS %', a.ts) + '<label class="toggle" style="align-self:end"><input type="checkbox" data-knf="rau"' + (a.rau ? ' checked' : '') + '> Raufutter</label></div>' +
      '<div class="bl-werte">' + ['nel', 'apde', 'apdn', 'rp'].map((k) => '<label><span>' + k.toUpperCase() + '</span><input class="input sm" data-knf="' + k + '" inputmode="decimal" value="' + esc(a[k] == null ? '' : a[k]) + '"></label>').join('') + '<span class="small muted">je kg TS</span><button class="btn sm" data-kn="futter" data-liste="angebote">Gehalte übernehmen …</button></div>' +
      '<div class="kn-verzehr">' +
      '<span><span>Fr. je dt TS</span><b>' + (x.frDtTs != null ? fmt(x.frDtTs, 1) : '–') + '</b></span>' +
      '<span><span>Fr. je 10 MJ NEL</span><b>' + (x.fr10Mj != null ? fmt(x.fr10Mj, 2) : '–') + '</b></span>' +
      '<span><span>Parität Energie</span><b>' + (p.lf != null ? fmt(p.lf, 1) : '–') + '</b><i class="small muted">Fr./dt FS</i></span>' +
      '<span><span>Parität Energie + Protein</span><b>' + (p.ep != null ? fmt(p.ep, 1) : '–') + '</b><i class="small muted">Fr./dt FS</i></span>' +
      (x.ton ? '<span class="kn-ton ' + x.ton + '">' + { gut: 'günstig', mittel: 'an der Parität', schlecht: 'zu teuer' }[x.ton] + ' (' + fmt(x.verh * 100, 0) + ' %)</span>' : '') + '</div>' +
      (a.herkunft ? '<p class="small muted" style="margin:4px 0 0">Gehalte: ' + esc(a.herkunft) + '</p>' : '');
    return card('angebote', a.id, h);
  }

  // Schritt 4: Abstocken / verstellen
  function schritt4(r) {
    let h = '<div class="alert info">' + app().I.warn + '<div><b>4. Lohnt sich eine Abstockung?</b> Vorab: Das Futtersparpotenzial ist oft klein (wenige Tierfuttertage). Tiere verstellen (Jungvieh 2. Jahr, Galtkühe, Altmelkkühe) ist eine Alternative. Ausmelkkühe früher zu verkaufen ist in der Regel sinnvoll; gesunde Kühe freiwillig zu selektieren ist in der Regel teurer.</div></div>';
    const ms = r.massnahmen.filter((x) => x.m.typ !== 'strecken');
    h += '<section class="q" style="margin-top:16px"><h3>Massnahmen</h3><div class="stack">' + (ms.length ? ms.map((x) => massKarte(x, r)).join('') : '<p class="small muted">Noch keine Massnahme.</p>') + '</div>' +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn" data-kn="add-mass" data-val="abstocken"' + (S.gruppen.length ? '' : ' disabled') + '>+ Früher verkaufen</button><button class="btn" data-kn="add-mass" data-val="verstellen"' + (S.gruppen.length ? '' : ' disabled') + '>+ Tiere verstellen</button></div></section>';
    return h;
  }

  // Schritt 5: Vergleich
  function schritt5(r) {
    const fehl = Math.max(0, r.fehl);
    let h = '';
    if (!r.bedarf) return '<p class="small muted">Erfassen Sie zuerst Tiere und Vorräte (Schritt 1).</p>';
    if (fehl <= 0) h += '<div class="alert info">' + app().I.warn + '<div>Der Vorrat deckt den geschätzten Bedarf' + (r.fehl < 0 ? ' mit ' + dt(-r.fehl) + ' dt TS Reserve' : '') + '. Prüfen Sie die Annahmen zum Verzehr und zu den Verlusten.</div></div>';
    else if (!r.zukauf) h += '<div class="alert warn">' + app().I.warn + '<div>Für den Vergleich fehlt ein Raufutter-Angebot mit Preis (Schritt 3).</div></div>';
    const milch = r.milch > 0;
    h += '<section class="q" style="margin-top:16px"><h3>Varianten für ' + dt(fehl) + ' dt TS Fehlmenge</h3><div class="kn-var">' + r.varianten.map((v, i) => {
      const best = r.varianten.filter((y) => y.kosten != null).sort((a, b) => a.kosten - b.kosten)[0];
      return '<div class="card kn-var-k' + (best && best.id === v.id && fehl > 0 ? ' kn-best' : '') + '"><div class="small muted" style="font-weight:700">Variante ' + 'ABC'[i] + '</div><h4 style="margin:2px 0 4px">' + esc(v.t) + '</h4><p class="small muted" style="margin:0 0 8px">' + esc(v.s) + '</p>' +
        '<div class="kn-gross">' + fr(v.kosten) + '</div>' +
        '<div class="small">' + (fehl > 0 && v.kosten != null ? fr(v.kosten / (fehl / 100)) + ' je dt TS Fehlmenge' : '') + (milch && v.kosten != null ? '<br>' + fmt(v.kosten / r.milch * 100, 1) + ' Rp./kg Milch im Zeitraum' : '') + '</div>' +
        '<ul class="small kn-teile">' + v.teile.map((t) => '<li>' + esc(massName(t.x)) + (t.anteil < 0.999 ? ' (' + fmt(t.anteil * 100, 0) + ' %)' : '') + ': ' + dt(t.x.kgTs * t.anteil) + ' dt TS, ' + fr(t.x.kosten * t.anteil) + '</li>').join('') +
        (v.kauf > 0 ? '<li>Zukauf ' + (r.zukauf ? esc(r.zukauf.a.name) : 'Raufutter') + ': ' + dt(v.kauf) + ' dt TS' + (r.zukauf ? ' (≈ ' + fmt(v.kauf / (r.zukauf.ts || 88), 0) + ' dt FS), ' + fr(v.kauf / 100 * r.zukauf.frDtTs) : '') + '</li>' : '') +
        (v.ueber > 0 ? '<li>Massnahmen sparen ' + dt(v.ueber) + ' dt TS mehr als nötig</li>' : '') + '</ul></div>';
    }).join('') + '</div></section>';
    // Kostenleiter
    const rows = r.massnahmen.filter((x) => x.kgTs > 0).map((x) => ({ n: massName(x), kg: x.kgTs, k: x.kosten, p: x.frDtTs, akt: x.m.aktiv !== false }));
    r.angebote.filter((x) => x.a.rau && x.frDtTs != null).forEach((x) => rows.push({ n: 'Zukauf: ' + (x.a.name || 'Raufutter'), kg: null, k: null, p: x.frDtTs, zk: true }));
    rows.sort((a, b) => (a.p == null) - (b.p == null) || a.p - b.p);
    if (rows.length) {
      h += '<section class="q"><h3>Kosten je dt TS im Vergleich</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Massnahme</th><th>dt TS</th><th>Kosten</th><th>Fr./dt TS</th></tr></thead><tbody>' +
        rows.map((x) => '<tr><td>' + esc(x.n) + (x.akt === false ? ' <span class="small muted">(inaktiv)</span>' : '') + '</td><td>' + (x.kg != null ? dt(x.kg) : '') + '</td><td>' + (x.k != null ? fr(x.k) : '') + '</td><td><b>' + (x.p != null ? fmt(x.p, 1) : '–') + '</b></td></tr>').join('') + '</tbody></table></div>' +
        '<p class="small muted">Je tiefer die Kosten je dt TS, desto eher lohnt sich die Massnahme gegenüber dem Zukauf. Nicht enthalten: Arbeitszeit, Tierwohl und Tiergesundheit, Folgen für die Remontierung und Milchkontingent-/Lieferverträge.</p></section>';
    }
    h += '<div class="row"><button class="btn primary" data-kn="pdf">' + app().I.pdf + ' PDF für die Beratung</button><button class="btn ghost" data-kn="neu">Neu beginnen</button></div>';
    return h;
  }
  function massName(x) {
    const g = x.gr ? (x.gr.g.name || KAT[x.gr.g.kat].t) : 'Gruppe ?';
    return ({ strecken: 'Ration strecken', abstocken: 'Früher verkaufen', verstellen: 'Verstellen' }[x.m.typ]) + ' – ' + g + ' (' + fmt(x.tiere, 0) + ' Tiere, ' + fmt(x.tage, 0) + ' Tage)';
  }

  // ---------- Futter wählen (Tabelle, Einzelfutter, Richtwert, eigene Probe) ----------
  let ZIEL = null;
  async function futterWahl(listeName, id) {
    const A = app(); const B = global.Bilanz || {}; ZIEL = { liste: listeName, id };
    let ef = { futter: [] }; try { if (B.einzelfutter) ef = await B.einzelfutter(); } catch (e) { /* offline */ }
    const prob = A.db.proben.filter((p) => A.auswertung(p).vollstaendig);
    const K = global.K3;
    const eintraege = RICHTWERTE.map((f, i) => ({ k: 'rw', i, n: f.n, f, s: f.q }))
      .concat(prob.map((p) => ({ k: 'probe', i: p.id, n: (p.kopf && p.kopf.bez) || 'Probe', s: 'eigene Probe' })))
      .concat(ef.futter.map((f, i) => ({ k: 'ef', i, n: f.n, f, s: 'Agroscope-Referenzwert' })));
    const zeile = (e) => '<li><a class="item" href="#" data-kn="w-' + e.k + '" data-i="' + esc(e.i) + '"><span><span class="t">' + esc(e.n) + '</span><span class="s">' + esc(e.s) + (e.f ? ' · NEL ' + fmt(e.f.nel, 1) + ' · TS ' + fmt(e.f.ts, 0) + ' %' : '') + '</span></span></a></li>';
    const filt = (q) => { const w = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); const t = eintraege.filter((e) => w.every((x) => e.n.toLowerCase().includes(x))); return t.slice(0, 80).map(zeile).join('') + (t.length > 80 ? '<li class="small muted" style="padding:8px">… weitere – Suche verfeinern</li>' : ''); };
    A.sheet('<h2>Gehalte übernehmen</h2>' +
      (K && B.tabellenFutter ? '<details class="kn-det" open><summary>Grundfutter-Tabelle (Agroscope/AGFF)</summary><form id="knTab" class="stack" style="margin-top:8px"><div class="grid2"><label class="field"><span>Futter</span><select class="input" name="kons"><option value="heu">Dürrfutter</option><option value="silage">Grassilage</option><option value="mais">Maissilage</option><option value="gruen">Grünfutter</option></select></label>' +
        '<label class="field"><span>Bestand</span><select class="input" name="bestand">' + K.BESTAENDE.map((b) => '<option value="' + b.id + '">' + b.kurz + ' ' + b.titel + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Aufwuchs</span><select class="input" name="aufwuchs"><option value="1">1. Aufwuchs</option><option value="f">Folgeaufwuchs</option></select></label>' +
        '<label class="field"><span>Stadium</span><select class="input" name="stadium">' + [1, 2, 3, 4, 5, 6, 7].map((n) => '<option' + (n === 4 ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></div><p class="hint" id="knTabInfo"></p><button class="btn primary">Übernehmen</button></form></details>' : '') +
      '<input class="input" id="knSuche" type="search" placeholder="Suchen: Stroh, Schnitzel, Treber, Raps, eigene Probe …" autocomplete="off" style="margin-top:10px">' +
      '<ul class="list" id="knListe" style="max-height:45vh;overflow:auto;margin-top:8px">' + filt('') + '</ul><button class="btn ghost block" data-close>Abbrechen</button>', (el) => {
      el.querySelector('#knSuche').addEventListener('input', (e) => { el.querySelector('#knListe').innerHTML = filt(e.target.value); });
      const f = el.querySelector('#knTab'); if (!f) return;
      const wert = () => { const d = Object.fromEntries(new FormData(f)); return d.kons === 'mais' ? B.maisTabelle() : B.tabellenFutter(d.kons, d.aufwuchs, d.bestand, d.stadium); };
      const info = () => { const d = Object.fromEntries(new FormData(f)); const w = wert(); ['bestand', 'aufwuchs', 'stadium'].forEach((n) => { f.querySelector('[name=' + n + ']').disabled = d.kons === 'mais'; });
        el.querySelector('#knTabInfo').textContent = w ? 'NEL ' + fmt(w.nel, 2) + ' MJ · APDE ' + fmt(w.apde, 0) + ' g · APDN ' + fmt(w.apdn, 0) + ' g je kg TS · TS ' + w.ts + ' %' : 'Für diese Kombination gibt es keinen Tabellenwert.'; };
      f.addEventListener('change', info); info();
      f.addEventListener('submit', (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const w = wert(); if (!w) return;
        const n = d.kons === 'mais' ? 'Maissilage' : ({ gruen: 'Grünfutter', heu: 'Dürrfutter', silage: 'Grassilage' }[d.kons] + ' ' + (K.BESTAND_PLAIN[d.bestand] || d.bestand) + ', ' + (d.aufwuchs === '1' ? '1. Aufw.' : 'Folgeaufw.') + ', St. ' + d.stadium);
        uebernehmen({ n, ts: d.kons === 'heu' ? 88 : w.ts, nel: w.nel, nev: w.nev, apde: w.apde, apdn: w.apdn, rp: w.rp, rau: true }, 'Tabelle Agroscope/AGFF'); });
    });
  }
  function uebernehmen(f, herkunft) {
    const x = ZIEL && finde(ZIEL.liste, ZIEL.id); if (!x) return;
    if (!x.name) x.name = f.n;
    ['ts', 'nel', 'apde', 'apdn', 'rp'].forEach((k) => { x[k] = f[k] != null ? Math.round(f[k] * 100) / 100 : null; });
    if (ZIEL.liste === 'angebote' && f.rau != null && x.rau == null) x.rau = f.rau;
    x.herkunft = herkunft; merken(); app().closeSheet(); app().render();
  }

  // ---------- Vorlagen und Beispiel ----------
  function angebotFinden(name, f) {
    let a = S.angebote.find((x) => x.name === name);
    if (!a) { a = Object.assign({ id: uid(), name, preis: null, fracht: null }, f); S.angebote.push(a); }
    return a;
  }
  async function vorlage(typ) {
    const B = global.Bilanz || {}; let ef = { futter: [] }; try { if (B.einzelfutter) ef = await B.einzelfutter(); } catch (e) { /* offline */ }
    const efw = (rx, name) => { const f = ef.futter.find((x) => rx.test(x.n)); return f ? { ts: f.ts, nel: f.nel, apde: f.apde, apdn: f.apdn, rp: f.rp, herkunft: 'Agroscope-Referenzwert' } : { ts: 88 }; };
    const rw = RICHTWERTE[1]; const stroh = angebotFinden('Getreidestroh', { rau: false, ts: rw.ts, nel: rw.nel, apde: rw.apde, apdn: rw.apdn, rp: rw.rp, herkunft: rw.q });
    const gruppe = S.gruppen.find((g) => typ === 'galt' ? g.kat === 'milchkuh' && g.phase === 'galt' : g.kat === 'aufzucht');
    let m;
    if (typ === 'galt') {
      const rk = angebotFinden('Rapskuchen', Object.assign({ rau: false }, efw(/^Rapskuchen 00-Typ$/)));
      m = { ersetzt: 10.1, zusatz: [{ aid: stroh.id, kgTs: 8.1 }, { aid: rk.id, kgTs: 2.0 }], notiz: 'Häberli: 13,2 kg TS Dürrfutter weniger, dafür 3,1 kg TS Maissilage mehr (aus dem eigenen Vorrat) – netto 10,1 kg TS Grundfutter gespart.' };
    } else {
      const mng = angebotFinden('Mühlennachproduktegemisch', Object.assign({ rau: false }, efw(/^Mühlennachproduktegemisch/)));
      m = { ersetzt: 4.5, zusatz: [{ aid: stroh.id, kgTs: 1.8 }, { aid: mng.id, kgTs: 2.7 }] };
    }
    S.massnahmen.push(Object.assign({ id: uid(), typ: 'strecken', aktiv: true, gruppeId: gruppe ? gruppe.id : '', tiere: null, tage: null }, m));
    merken(); app().render();
    app().toast(gruppe ? 'Vorlage übernommen – Preise in Schritt 3 eintragen.' : 'Vorlage übernommen – Tiergruppe wählen und Preise in Schritt 3 eintragen.');
  }
  function beispiel() {
    const g = (kat, o) => Object.assign({ id: uid(), kat }, JSON.parse(JSON.stringify(KAT[kat].def)), o);
    S.gruppen = [g('milchkuh', { name: 'Milchkühe', anzahl: 25, jahresmilch: 8000, phase: 'prod', kf: 3 }), g('milchkuh', { name: 'Galtkühe', anzahl: 5, phase: 'galt' }),
      g('aufzucht', { name: 'Jungvieh 2. Jahr', anzahl: 10, lg: 420 }), g('aufzucht', { name: 'Kälber/Jungvieh 1. Jahr', anzahl: 8, lg: 180 })];
    S.vorraete = [{ id: uid(), name: 'Dürrfutter am Stock', menge: 400, einheit: 'm3', kgJe: 85, ts: 88, nel: 5.3, rp: 130, herkunft: 'Beispiel' },
      { id: uid(), name: 'Grassilage Rundballen', menge: 100, einheit: 'ballen', kgJe: 650, ts: 38, nel: 5.8, herkunft: 'Beispiel' },
      { id: uid(), name: 'Maissilage', menge: 200, einheit: 'm3', kgJe: 600, ts: 33, nel: 6.4, herkunft: 'Beispiel' }];
    S.angebote = [{ id: uid(), name: 'Heu zugekauft', rau: true, preis: 38, fracht: 4, ts: 88, nel: 5.3, rp: 130, herkunft: 'Beispiel – Preis bitte ersetzen' },
      { id: uid(), name: 'Maissilage ab Feld', rau: true, preis: 9, fracht: 1.5, ts: 33, nel: 6.4, apde: 68, apdn: 50, rp: 75, herkunft: 'Beispiel – Preis bitte ersetzen' }];
    S.massnahmen = []; merken();
  }

  // ---------- PDF ----------
  async function pdf() {
    const A = app(); const r = rechnen(); const IO = global.FutterIO;
    await IO.loadScript('assets/vendor/jspdf.umd.min.js');
    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4' }); const T = (s) => IO.pdfText(String(s));
    let y = 18; const neu = (n) => { if (y + (n || 10) > 285) { doc.addPage(); y = 18; } };
    const zeile = (cols, xs, bold) => { neu(6); doc.setFont('helvetica', bold ? 'bold' : 'normal'); cols.forEach((c, i) => doc.text(T(c), xs[i], y, i ? { align: 'right' } : undefined)); y += 5; };
    const titel = (t) => { neu(14); y += 3; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(T(t), 15, y); doc.setFontSize(9); y += 6; };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(T('Futterknappheit – lohnt sich der Zukauf?'), 15, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text(T('Orientierung, keine Beratung · erstellt ' + new Date().toLocaleDateString('de-CH') + ' mit der AGFF-Futterbeurteilung'), 15, y + 6); doc.setTextColor(20);
    y += 14;
    doc.text(T('Zeitraum ' + dCH(S.start) + ' bis ' + dCH(S.ende) + ' (' + r.tage + ' Tage), Verluste ' + (num(S.verlust) || 0) + ' %, Verzehr nach ' + (S.quelle === 'gb' ? 'Grünem Buch (wo vorhanden)' : 'Fuplan')), 15, y); y += 6;
    doc.setFont('helvetica', 'bold'); doc.text(T('Bedarf ' + dt(r.bedarf) + ' dt TS · Vorrat ' + dt(r.vorrat) + ' dt TS · ' + (r.fehl > 0 ? 'Fehlmenge ' + dt(r.fehl) : 'Überschuss ' + dt(-r.fehl)) + ' dt TS' + (r.reichtTage != null && r.reichtTage < r.tage ? ' · Vorrat reicht bis ' + dCH(r.reichtBis) : '')), 15, y); y += 4;
    titel('Tiere');
    const xs = [15, 110, 128, 150, 172, 195];
    zeile(['Gruppe', 'Tiere', 'Tage', 'Fuplan', 'Grünes Buch', 'dt TS'], xs, true);
    r.gruppen.forEach((x) => zeile([(x.g.name || KAT[x.g.kat].t).slice(0, 48), fmt(x.n, 0), fmt(x.t, 0), fmt(x.v.gfFu, 1) + (x.v.fu && x.v.fu.richtwert ? '*' : ''), fmt(x.v.gfGb, 1), dt(x.kgTs)], xs));
    doc.setFontSize(7); doc.setTextColor(100); neu(); doc.text(T('Grundfutter kg TS je Tier und Tag; verwendet: ' + (S.quelle === 'gb' ? 'Grünes Buch, sonst Fuplan' : 'Fuplan') + ' oder eigener Wert. * Richtwert, kein Fuplan-Wert.'), 15, y); y += 4; doc.setFontSize(9); doc.setTextColor(20);
    titel('Vorräte');
    const xv = [15, 120, 145, 170, 195];
    zeile(['Vorrat', 'dt FS', 'TS %', 'NEL', 'dt TS'], xv, true);
    r.vorraete.forEach((x) => zeile([(x.v.name || 'Vorrat').slice(0, 52), fmt(x.kgFs / 100, 0), fmt(num(x.v.ts), 0), fmt(num(x.v.nel), 1), dt(x.kgTs)], xv));
    if (r.angebote.length) {
      titel('Angebote und Ersatzfutter');
      const xa = [15, 105, 125, 147, 171, 195];
      zeile(['Futter', 'Fr./dt FS', 'Fr./dt TS', 'Par. Energie', 'Par. E+P', 'Bewertung'], xa, true);
      r.angebote.forEach((x) => zeile([(x.a.name || 'Futter').slice(0, 44), fmt(x.preis, 1), fmt(x.frDtTs, 1), fmt(x.par.lf, 1), fmt(x.par.ep, 1), x.ton ? { gut: 'günstig', mittel: 'Parität', schlecht: 'zu teuer' }[x.ton] : '–'], xa));
    }
    if (r.massnahmen.length) {
      titel('Massnahmen');
      const xm = [15, 150, 172, 195];
      zeile(['Massnahme', 'dt TS', 'Kosten Fr.', 'Fr./dt TS'], xm, true);
      r.massnahmen.forEach((x) => zeile([(massName(x) + (x.m.aktiv === false ? ' (inaktiv)' : '')).slice(0, 80), dt(x.kgTs), fmt(x.kosten, 0), fmt(x.frDtTs, 1)], xm));
    }
    titel('Varianten');
    r.varianten.forEach((v, i) => {
      neu(12); doc.setFont('helvetica', 'bold'); doc.text(T('Variante ' + 'ABC'[i] + ': ' + v.t + ' – ' + (v.kosten != null ? 'Fr. ' + fmt(v.kosten, 0) : 'nicht berechenbar') + (r.milch > 0 && v.kosten != null ? ' (' + fmt(v.kosten / r.milch * 100, 1) + ' Rp./kg Milch)' : '')), 15, y); y += 5; doc.setFont('helvetica', 'normal');
      v.teile.forEach((t) => { neu(); doc.text(T('- ' + massName(t.x) + (t.anteil < 0.999 ? ' (' + fmt(t.anteil * 100, 0) + ' %)' : '') + ': ' + dt(t.x.kgTs * t.anteil) + ' dt TS, Fr. ' + fmt(t.x.kosten * t.anteil, 0)), 18, y); y += 5; });
      if (v.kauf > 0) { neu(); doc.text(T('- Zukauf ' + (r.zukauf ? r.zukauf.a.name : 'Raufutter') + ': ' + dt(v.kauf) + ' dt TS' + (r.zukauf ? ', Fr. ' + fmt(v.kauf / 100 * r.zukauf.frDtTs, 0) : '')), 18, y); y += 5; }
      y += 1;
    });
    neu(24); y += 4; doc.setFontSize(7.5); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(T('Grundlagen: A. Häberli, INFORAMA, «Trockenheit: Umgang mit Futterknappheit in der Winterfütterung»; Verzehrsvorgaben Fuplan (Agridea); Agroscope, Fütterungsempfehlungen für Wiederkäuer (Grünes Buch) Kap. 7.6 und 10; Agroscope-Referenzwerte Einzelfutter. Orientierung ohne Gewähr: nicht berücksichtigt sind Arbeitszeit, Tierwohl, Tiergesundheit, Mineralstoffe und Struktur der Ersatzrationen. Für Rationsberechnungen und betriebliche Entscheide eine Fachperson beiziehen.'), 180), 15, y);
    const blob = doc.output('blob'); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'Futterknappheit.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---------- Ereignisse ----------
  function ziel(el) {
    const ref = el.closest('[data-kn-ref]'); if (ref) return S.ref[ref.dataset.knRef];
    const c = el.closest('[data-kn-id]'); if (!c) return S;
    const x = finde(c.dataset.knL, c.dataset.knId); if (!x) return null;
    const z = el.closest('[data-kn-z]'); if (z) return (x.zusatz || [])[Number(z.dataset.knZ)] || null;
    return x;
  }
  function handle(e) {
    const A = app(); const t = e.target.closest('[data-kn]'); if (!t) return false;
    e.preventDefault();
    const a = t.dataset.kn; const c = t.closest('[data-kn-id]');
    if (a === 'schritt') { S.schritt = Number(t.dataset.val) || 1; merken(); A.render(); const m = document.querySelector('#main'); if (m) m.scrollTop = 0; window.scrollTo(0, 0); }
    else if (a === 'quelle') { S.quelle = t.dataset.val; merken(); A.render(); }
    else if (a === 'add-gruppe') { const kat = (document.querySelector('#knNeuKat') || {}).value || 'milchkuh'; S.gruppen.push(Object.assign({ id: uid(), kat, name: '', anzahl: null, tage: null, kf: null }, JSON.parse(JSON.stringify(KAT[kat].def)))); merken(); A.render(); }
    else if (a === 'add-vorrat') { S.vorraete.push({ id: uid(), name: '', menge: null, einheit: 'dt', kgJe: null, ts: 88 }); merken(); A.render(); }
    else if (a === 'add-angebot') { S.angebote.push({ id: uid(), name: '', rau: t.dataset.val === 'rau', preis: null, fracht: null, ts: 88 }); merken(); A.render(); }
    else if (a === 'add-mass') { const g = S.gruppen[0]; S.massnahmen.push({ id: uid(), typ: t.dataset.val, aktiv: true, gruppeId: g ? g.id : '', tiere: null, tage: null, zusatz: t.dataset.val === 'strecken' ? [{ aid: '', kgTs: null }] : undefined }); merken(); A.render(); }
    else if (a === 'weg' && c) { const l = c.dataset.knL; S[l] = S[l].filter((x) => x.id !== c.dataset.knId); if (l === 'gruppen') S.massnahmen.forEach((m) => { if (m.gruppeId === c.dataset.knId) m.gruppeId = ''; }); merken(); A.render(); }
    else if (a === 'zusatz-add' && c) { const m = finde('massnahmen', c.dataset.knId); (m.zusatz = m.zusatz || []).push({ aid: '', kgTs: null }); merken(); A.render(); }
    else if (a === 'zusatz-weg' && c) { const m = finde('massnahmen', c.dataset.knId); m.zusatz.splice(Number(t.dataset.i), 1); merken(); A.render(); }
    else if (a === 'futter' && c) futterWahl(c.dataset.knL, c.dataset.knId).catch(() => A.toast('Futterliste konnte nicht geladen werden.'));
    else if (a === 'w-rw') uebernehmen(RICHTWERTE[Number(t.dataset.i)], RICHTWERTE[Number(t.dataset.i)].q);
    else if (a === 'w-ef') { const B = global.Bilanz; B.einzelfutter().then((d) => { const f = d.futter[Number(t.dataset.i)]; if (f) uebernehmen(f, 'Agroscope-Referenzwert'); }); }
    else if (a === 'w-probe') {
      const p = A.probeById(t.dataset.i); const B = global.Bilanz;
      if (p && B.probenWerte) { const v = B.probenWerte(p, true); uebernehmen(Object.assign({ n: (p.kopf && p.kopf.bez) || 'Probe', ts: v.ts, rau: true }, v.w), 'eigene Probe' + (v.labor ? ' (Labor)' : ' (Schätzung)')); }
    }
    else if (a === 'vorlage') vorlage(t.dataset.val).catch(() => {});
    else if (a === 'beispiel') { beispiel(); A.render(); A.toast('Beispielbetrieb geladen – Zahlen durch Ihre ersetzen.'); }
    else if (a === 'neu') { if (confirm('Alle Angaben zur Futterknappheit löschen und neu beginnen?')) { S = leer(); merken(); A.render(); } }
    else if (a === 'pdf') pdf().catch((er) => A.toast('PDF fehlgeschlagen: ' + er.message));
    return true;
  }
  let timer = null;
  function eingabe(e) {
    const A = app(); const el = e.target;
    if (el.dataset.knrg) { // Raumgewicht nach Fuplan
      const x = ziel(el); const rg = RAUM[Number(el.value)]; if (!x || !rg) return;
      x.kgJe = rg[2]; x.ts = rg[3]; if (!x.name) x.name = rg[0]; merken(); A.render(); return;
    }
    const key = el.dataset.knf; if (!key) return;
    const x = ziel(el); if (!x) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.tagName === 'SELECT' || el.dataset.knTyp === 's') v = el.value;
    else v = el.value.trim() === '' ? null : (num(el.value) != null ? num(el.value) : el.value);
    if (key.indexOf('.') > 0) { const [a, b] = key.split('.'); x[a] = x[a] || {}; x[a][b] = v; } else x[key] = v;
    merken();
    clearTimeout(timer);
    const sofort = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date';
    timer = setTimeout(() => {
      const c = el.closest('[data-kn-id]'); const ref = el.closest('[data-kn-ref]'); const z = el.closest('[data-kn-z]');
      const sel = (c ? '[data-kn-id="' + c.dataset.knId + '"] ' : ref ? '[data-kn-ref="' + ref.dataset.knRef + '"] ' : '') + (z ? '[data-kn-z="' + z.dataset.knZ + '"] ' : '') + '[data-knf="' + key + '"]';
      let pos = null; try { pos = el.selectionStart; } catch (er) { /* date/checkbox */ }
      const m = document.querySelector('#main'); const st = m ? m.scrollTop : 0; const ws = window.scrollY;
      const fokus = document.activeElement === el;
      A.render(); if (m) m.scrollTop = st; window.scrollTo(0, ws);
      const neu = document.querySelector(sel);
      if (neu && fokus && !sofort) { neu.focus(); try { if (pos != null) neu.setSelectionRange(pos, pos); } catch (er) { /* egal */ } }
    }, sofort ? 0 : 700);
  }

  global.Knappheit = { render, handle, eingabe, rechnen, _intern: { KAT, verzehr, paritaet, lin, S: () => S } };
})(window);
