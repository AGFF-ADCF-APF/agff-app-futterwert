/* Futter v2 – Regelwerk «Laboranalyse auswerten» (Prototyp, fachlich zu prüfen).
 *
 * Keine KI: jede Aussage stammt aus einer Regel mit Grenzen, Begründung und Quelle («Warum?» in der App).
 * Reihenfolge der Referenz je Messwert: 1. feste Regel der App (falls vorhanden, mit Quelle),
 * 2. Zielbereich des Labors (steht im Prüfbericht), 3. nur Anzeige mit dem Labor-Mittelwert.
 * Werte je kg TS wie im Schweizer Prüfbericht; TS in %.
 */
(function (global) {
  'use strict';

  const Q = {
    swissgenetics: 'Swissgenetics «Weil Dreck nicht schmeckt» (2014): Grassilage höchstens 80–100 g Rohasche/kg TS; +10 g Asche ≈ −0,1 MJ NEL',
    sachsen: 'LfULG Sachsen, Grundfutterqualität: Rohasche > 100 g/kg TM verbesserungsbedürftig, > 150 problematisch',
    ufag: 'Zielbereich bzw. Zielwert im Prüfbericht des Labors (UFAG)',
    dlg: 'DLG-Schlüssel zur Beurteilung der Gärqualität (Buttersäure, Essigsäure, pH je nach TS)',
    weissbach: 'Kritischer pH-Wert nach Weissbach (pH-krit = 0,0257 × TS % + 3,71), wie im DLG-Schlüssel; angewendet bis 45 % TS',
    agff_gs: 'AGFF/Agroscope Merkblatt Grassilage: gute Grassilage über 5,8 MJ NEL/kg TS',
    mais: 'Raufutter-Enquête Maissilage (AGRIDEA/Agroscope): angestrebter Zielbereich über 6,5 MJ NEL/kg TS',
    agridea: 'AGRIDEA Fütterungsplan (2019): APDN und APDE; negativer Nrum = Stickstoffmangel im Pansen',
    tetanie: 'K/(Ca+Mg) in Milliäquivalenten ≥ 2,2: erhöhtes Risiko für Weidetetanie (internationale Studien)',
    k3b: 'AGFF-Schlüssel K3b Grassilage',
    mb3: 'AGFF-Merkblatt 3: Bewertung von Wiesenfutter (Stadium, Zeitperiode)',
    lager: 'Zielbereich Dürrfutter 85–95 % TS (Prüfbericht); darunter Lagerrisiko (Schimmel, Erwärmung)',
    orientierung: 'Orientierungswert der App (Prototyp) – fachlich zu prüfen',
    k4b: 'AGFF-Informationsblatt K4b «Interpretation der Silagebewertung – Optimierung der Silierprozesse» (Aeby, Wyss; AGFF 2024)',
    k4b_ts: 'AGFF K4b: Grassilage im Hoch- und Fahrsilo 30–35 % TS (höchstens 36 %), Siloballen über 40 % TS (höchstens 55 %), Silomais 32–36 % TS',
    dlg_es: 'DLG-Schlüssel zur Beurteilung der Gärqualität: Abzüge ab 3,0 % Essigsäure in der TS (30 g/kg TS)',
    enquete: 'Raufutter-Enquête (AGRIDEA und Agroscope): Schweizer Jahresmittel, Dürrfutter 2015–2025 je Belüftung, Grassilage 2019–2025 (öffentliche Berichte auf agridea.ch; Abschrift)',
  };

  // Schweizer Jahresmittel der Raufutter-Enquête (je kg TS; TS in %). Dürrfutter: belüftet (b) / unbelüftet (u).
  // Spalten Dürrfutter: n, NEL, APDE, APDN, RP, RF, NDF, ADF, RA, Zucker
  const ENQ_DF_K = ['n', 'nel', 'apde', 'apdn', 'rp', 'rf', 'ndf', 'adf', 'ra', 'zucker'];
  const ENQ_DF = {
    2015: { b: [1875,5.4,88,85,134,247,499,283,101,127], u: [266,5.2,82,74,117,273,535,306,91,113] },
    2016: { b: [1524,5.4,87,83,130,247,498,282,110,123], u: [225,5.1,81,72,112,279,550,316,94,102] },
    2017: { b: [1877,5.5,90,91,143,230,469,265,112,127], u: [227,5.2,85,80,126,262,526,300,104,99] },
    2018: { b: [1772,5.4,89,88,139,249,505,281,106,114], u: [224,5,81,73,114,283,557,321,94,94] },
    2019: { b: [1616,5.5,90,89,139,249,505,281,109,118], u: [219,5.1,83,77,121,277,542,306,101,97] },
    2020: { b: [1671,5.4,90,86,134,247,497,279,103,128], u: [255,5.1,82,74,117,275,541,308,91,109] },
    2021: { b: [1655,5.4,88,86,124,245,504,283,102,136], u: [234,5.1,81,71,112,280,555,318,96,104] },
    2022: { b: [1530,5.5,89,86,134,247,501,284,103,122], u: [134,5.2,83,72,114,275,542,314,89,115] },
    2023: { b: [1147,5.4,88,84,132,258,519,297,105,118], u: [141,5.1,82,73,115,283,556,319,92,113] },
    2024: { b: [1056,5.3,86,80,125,261,523,299,113,116], u: [97,4.9,80,73,113,290,573,331,109,90] },
    2025: { b: [1158,5.6,90,87,135,243,489,278,105,143], u: [132,5.2,83,74,114,268,530,300,98,128] },
  };
  // Spalten Grassilage: n, TS, NEL, APDE, APDN, RP, RF, NDF, ADF, RA, Zucker, pH, Milchsäure, Essigsäure, Buttersäure (pH erst ab 2022, Buttersäure nur bis 2021)
  const ENQ_GS_K = ['n', 'ts', 'nel', 'apde', 'apdn', 'rp', 'rf', 'ndf', 'adf', 'ra', 'zucker', 'ph', 'milchsaeure', 'essigsaeure', 'bs'];
  const ENQ_GS = {
    2019: [846,43,5.8,79,96,152,240,447,266,114,79,null,48,13,2],
    2020: [591,43.7,5.7,79,92,146,248,467,277,108,81,null,44,13,3],
    2021: [973,43.1,5.6,77,85,136,254,473,285,105,78,null,45,14,3],
    2022: [653,41.6,5.8,79,94,150,248,461,279,108,73,4.8,51.8,13.6,null],
    2023: [886,38,5.5,75,89,142,272,498,307,112,57,4.8,54,15,null],
    2024: [948,40,5.6,77,93,148,255,472,290,116,61,4.7,57,15,null],
    2025: [1014,41,5.8,79,94,149,244,454,277,109,81,4.8,55,17,null],
  };
  // höher = besser (+1), tiefer = besser (−1), neutral (0)
  const RICHTUNG = { nel: 1, apde: 1, apdn: 1, rp: 1, zucker: 1, milchsaeure: 1, rf: -1, ndf: -1, adf: -1, ra: -1, bs: -1, essigsaeure: 0, ts: 0, ph: 0 };

  /** Feste Regeln für Einzelwerte: [gut bis, mittel bis] (aufsteigend schlechter) oder eigene Funktion. */
  const FEST = {
    ra: { titel: 'Rohasche', gut: 100, mittel: 120, q: [Q.swissgenetics, Q.sachsen] },
    bs: { titel: 'Buttersäure', nur: 'silage', gut: 3, mittel: 6, q: [Q.ufag, Q.dlg] },
    nh3: { titel: 'NH3 (Anteil am Gesamt-N)', nur: 'silage', gut: 8, mittel: 12, q: [Q.ufag] },
    lprot: { titel: 'Lösliches Protein', nur: 'silage', gut: 60, mittel: 70, q: [Q.ufag] },
  };
  const LABEL = {
    ts: ['Trockensubstanz', '%', 1], ra: ['Rohasche', 'g', 0], rp: ['Rohprotein', 'g', 0], rf: ['Rohfaser', 'g', 0], rfe: ['Rohfett', 'g', 0], vcos: ['Verdaulichkeit (VCOS)', '%', 1],
    zucker: ['Zucker', 'g', 0], ndf: ['NDF', 'g', 0], dndf: ['NDF-Verdaulichkeit', '%', 1], adf: ['ADF', 'g', 0], adl: ['ADL (Lignin)', 'g', 0], vos: ['VOS', 'g', 0],
    apde: ['APDE', 'g', 0], apdn: ['APDN', 'g', 0], nel: ['NEL', 'MJ', 1], nev: ['NEV', 'MJ', 1], pme: ['PME', 'g', 0], pmn: ['PMN', 'g', 0], lys: ['Lysin', 'g', 1], met: ['Methionin', 'g', 1],
    ph: ['pH-Wert', '', 1], milchsaeure: ['Milchsäure', 'g', 0], essigsaeure: ['Essigsäure', 'g', 0], bs: ['Buttersäure', 'g', 1], nh3: ['NH3 (Anteil am N)', '%', 1], lprot: ['Lösliches Protein', '%', 0],
    ca: ['Calcium', 'g', 1], p: ['Phosphor', 'g', 1], mg: ['Magnesium', 'g', 1], k: ['Kalium', 'g', 1], na: ['Natrium', 'g', 2], cl: ['Chlorid', 'g', 1],
    kindex: ['Konservierungsindex', '', 0], nerisk: ['Nacherwärmungsrisiko', '', 0], nindex: ['N-Index', '', 0],
  };
  const GRUPPEN = [
    ['Gärqualität', ['ph', 'milchsaeure', 'essigsaeure', 'bs', 'nh3', 'lprot']],
    ['Trockensubstanz und Nährstoffe', ['ts', 'ra', 'rp', 'rf', 'rfe', 'zucker']],
    ['Energie und Protein', ['nel', 'nev', 'apde', 'apdn', 'pme', 'pmn', 'vos', 'vcos', 'lys', 'met']],
    ['Zellwand', ['ndf', 'dndf', 'adf', 'adl']],
    ['Mineralstoffe', ['ca', 'p', 'mg', 'k', 'na', 'cl']],
    ['Silagemanager (Labor)', ['kindex', 'nerisk', 'nindex']],
  ];
  const RANG = { schlecht: 3, mittel: 2, gut: 1, info: 0 };

  const art = (p) => {
    if (p.werte.ph || p.werte.milchsaeure || /silage/i.test((p.meta.name || '') + ' ' + (p.meta.bezeichnung || ''))) return 'silage';
    // ohne Gärsäuren und mit wenig TS: frisches Futter (Grünfutter, GPS-Ausgangsmaterial) – keine Lager- und Gärregeln
    if (p.werte.ts && p.werte.ts.v < 60) return 'gruen';
    return 'duerr';
  };
  const v = (p, k) => (p.werte[k] ? p.werte[k].v : null);
  const pHkrit = (ts) => 0.0257 * ts + 3.71;
  const istMais = (p) => /mais/i.test((p.meta.name || '') + ' ' + (p.meta.bezeichnung || ''));
  const istGps = (p) => /gps|ganzpflanz/i.test((p.meta.name || '') + ' ' + (p.meta.bezeichnung || ''));

  /** Ampel für einen Messwert */
  function einzel(p, k) {
    const w = p.werte[k]; if (!w) return null; const x = w.v; const a = art(p);
    const f = FEST[k];
    if (f && (!f.nur || f.nur === a)) {
      const ton = x <= f.gut ? 'gut' : x <= f.mittel ? 'mittel' : 'schlecht';
      return { ton, text: ton === 'gut' ? 'im Zielbereich' : 'über ' + (ton === 'mittel' ? f.gut : f.mittel), quelle: f.q, art: 'app' };
    }
    if (k === 'ph' && a === 'silage' && v(p, 'ts') && v(p, 'ts') <= 45) {  // kritischer pH nach Weissbach nur bis ca. 45 % TS
      const kr = pHkrit(v(p, 'ts')); const ton = x <= kr ? 'gut' : x <= kr + 0.2 ? 'mittel' : 'schlecht';
      return { ton, text: 'kritischer pH bei ' + v(p, 'ts').toFixed(0) + ' % TS: ' + kr.toFixed(2).replace('.', ','), quelle: [Q.weissbach], art: 'app' };
    }
    if (k === 'ts' && a === 'silage') {
      if (istMais(p)) {
        const ton = x >= 32 && x <= 36 ? 'gut' : x >= 30 && x <= 38 ? 'mittel' : 'schlecht';
        return { ton, text: ton === 'gut' ? 'im Bereich 32–36 % (Silomais)' : (x < 32 ? 'unter' : 'über') + ' 32–36 % (Silomais)', quelle: [Q.k4b_ts], art: 'app' };
      }
      const ton = x >= 30 && x <= 50 ? 'gut' : x >= 28 && x <= 55 ? 'mittel' : 'schlecht';
      return { ton, text: x < 30 ? 'unter 30 % – zu nass' : x > 55 ? 'über 55 % – auch für Ballen zu trocken' : x > 36 ? 'für Ballen gut; im Hoch- oder Fahrsilo höchstens 36 %' : 'gut angewelkt', quelle: [Q.k4b_ts], art: 'app' };
    }
    if (k === 'essigsaeure' && a === 'silage' && !(w.ziel)) {
      const ton = x <= 30 ? 'gut' : x <= 40 ? 'mittel' : 'schlecht';
      return { ton, text: ton === 'gut' ? 'bis 30 g' : 'über ' + (ton === 'mittel' ? 30 : 40) + ' g', quelle: [Q.dlg_es], art: 'app' };
    }
    if (k === 'ts' && a === 'duerr') {
      const ton = x >= 85 ? 'gut' : x >= 82 ? 'mittel' : 'schlecht';
      return { ton, text: ton === 'gut' ? 'lagerfähig' : 'unter 85 % TS', quelle: [Q.lager], art: 'app' };
    }
    if (k === 'nel' && a === 'silage') {
      const mais = istMais(p);
      const [g, m] = mais ? [6.5, 6.2] : [5.8, 5.4];
      const ton = x >= g ? 'gut' : x >= m ? 'mittel' : 'schlecht';
      return { ton, text: (ton === 'gut' ? 'mindestens ' : 'unter ') + String(g).replace('.', ',') + ' MJ' + (mais ? ' (Maissilage)' : ''), quelle: [mais ? Q.mais : Q.agff_gs], art: 'app' };
    }
    if (w.ziel) {
      const [lo, hi] = w.ziel; const breite = lo != null && hi != null ? (hi - lo) : Math.abs(hi || lo || 1) * 0.25;
      const unter = lo != null && x < lo; const ueber = hi != null && x > hi;
      if (!unter && !ueber) return { ton: 'gut', text: 'im Zielbereich des Labors', quelle: [Q.ufag], art: 'labor' };
      const abstand = unter ? lo - x : x - hi;
      return { ton: abstand <= Math.max(breite * 0.25, 1e-9) ? 'mittel' : 'schlecht', text: (unter ? 'unter' : 'über') + ' dem Zielbereich des Labors', quelle: [Q.ufag], art: 'labor' };
    }
    if (w.mittel != null) {
      const d = (x - w.mittel) / (w.mittel || 1) * 100;
      return { ton: 'info', text: (Math.abs(d) < 3 ? 'wie' : d > 0 ? Math.round(d) + ' % über' : Math.round(-d) + ' % unter') + ' dem Mittel aller Proben des Labors', quelle: [], art: 'mittel' };
    }
    return null;
  }

  /** Verhältnisse und abgeleitete Grössen */
  function verhaeltnisse(p) {
    const out = []; const a = art(p);
    const apde = v(p, 'apde'); const apdn = v(p, 'apdn'); const nel = v(p, 'nel');
    if (apde != null && apdn != null) {
      const d = apdn - apde;
      out.push({ id: 'pansen', titel: 'Pansen-Bilanz (APDN − APDE)', wert: (d > 0 ? '+' : '') + d.toFixed(0) + ' g/kg TS', ton: d > 15 || d < -10 ? 'mittel' : 'gut',
        text: d > 15 ? 'Mehr abbaubares Protein als Energie im Pansen: Energie begrenzt die Mikroben. Mit energiereichem Futter ergänzen, nicht mit Proteinkonzentrat.'
          : d < -10 ? 'Zu wenig abbaubares Protein für die vorhandene Energie (Stickstoffmangel im Pansen): mit proteinreichem Futter ergänzen.'
            : 'Energie und abbaubares Protein sind ausgeglichen.', quelle: [Q.agridea, Q.orientierung] });
    }
    if (apde != null && nel) out.push({ id: 'apdnel', titel: 'Proteindichte (APDE je MJ NEL)', wert: (apde / nel).toFixed(1).replace('.', ',') + ' g/MJ', ton: 'info', text: 'Wird im Rationscheck mit dem Bedarf der Tiere verglichen.', quelle: [] });
    const ra = v(p, 'ra');
    if (ra != null && ra > 90) out.push({ id: 'asche', titel: 'Energieverlust durch Asche', wert: '≈ −' + ((ra - 90) / 10 * 0.1).toFixed(2).replace('.', ',') + ' MJ NEL', ton: ra > 100 ? 'mittel' : 'info', text: 'Geschätzt gegenüber 90 g Rohasche/kg TS.', quelle: [Q.swissgenetics] });
    const ms = v(p, 'milchsaeure'); const es = v(p, 'essigsaeure');
    if (a === 'silage' && ms != null && es) {
      const r = ms / es; out.push({ id: 'mses', titel: 'Milchsäure : Essigsäure', wert: r.toFixed(1).replace('.', ',') + ' : 1', ton: r >= 3 ? 'gut' : r >= 1.5 ? 'mittel' : 'schlecht', text: r >= 3 ? 'Milchsäure dominiert – erwünschte Gärung.' : 'Wenig Milchsäure im Verhältnis: Gärung nicht optimal verlaufen.', quelle: [Q.orientierung] });
    }
    const K = v(p, 'k'); const Ca = v(p, 'ca'); const Mg = v(p, 'mg');
    if (K != null && Ca != null && Mg != null) {
      const q = (K / 39.1) / (Ca / 20.04 + Mg / 12.15);
      out.push({ id: 'tetanie', titel: 'Tetanie-Quotient K/(Ca+Mg)', wert: q.toFixed(2).replace('.', ','), ton: q >= 2.2 ? 'schlecht' : q >= 1.8 ? 'mittel' : 'gut', text: q >= 2.2 ? 'Erhöhtes Risiko für Weidetetanie (Magnesiummangel): Magnesium ergänzen, Kalidüngung prüfen.' : 'Unkritisch.', quelle: [Q.tetanie] });
    }
    const P = v(p, 'p'); if (Ca != null && P) out.push({ id: 'cap', titel: 'Calcium : Phosphor', wert: (Ca / P).toFixed(1).replace('.', ',') + ' : 1', ton: 'info', text: 'Für die Mineralstoffergänzung der Ration.', quelle: [] });
    return out;
  }

  // Massnahmen gemäss AGFF K4b (Auswahl, gekürzt)
  const M = {
    buttersaeure: ['Schnitthöhe 8–10 cm einhalten; Wühlmäuse bekämpfen, Wiesen im Frühling eggen oder walzen', 'Gülle vor Regen ausbringen bzw. verdünnen; nur mit sauberen Reifen ins Fahrsilo fahren',
      'Raigrasschwache Bestände über 30 % TS anwelken; beim Rispenschieben der Hauptgräser mähen', 'Nicht bei über 30 °C silieren; bei schwierig silierbarem Futter Siliermittel der Liste A'],
    ph: ['Anwelken, aber nicht zu stark: Hoch- und Fahrsilo bis 36 % TS, Ballen bis 45 % TS', 'Gut silierbare Bestände (Raigras) bevorzugen; Vorsicht bei klee- und kräuterreichen Beständen',
      'Spätestens bei Beginn Ährenschieben der Hauptgräser mähen', 'Verdichtung über 220 kg TS/m³ (über 700 kg Frischmasse/m³); Silo sofort luftdicht schliessen; evtl. Siliermittel'],
    essig: ['Über 30 % TS anwelken, aber nicht über 55 %', 'Häcksellänge Gras unter 5 cm; im Fahrsilo höchstens 30 cm pro Schicht, mindestens drei Überfahrten vor dem nächsten Wagen',
      'Verdichtung über 220 kg TS/m³; Silo sofort luftdicht schliessen', 'Evtl. Siliermittel der Liste B'],
    nacherw: ['Vorschub mindestens 2 m pro Woche im Sommer, 1 m im Winter', 'Folie und Sandsäcke bis zur Anschnittfläche liegen lassen; Anschnitt sauber entnehmen',
      'Silo mindestens 6 Wochen gären lassen, bevor es geöffnet wird', 'Verdichtung über 220 kg TS/m³; Ballen mit 6–8 Folienlagen (über 250 µm) ohne Löcher; evtl. Siliermittel der Liste B'],
    trocken: ['Ballen höchstens 55 % TS, Hoch- und Fahrsilo höchstens 36 % TS', 'Trockenes Futter besonders gut verdichten und rasch luftdicht verschliessen', 'Folien, Türen und Deckel regelmässig auf Löcher kontrollieren'],
  };

  /** Befunde: Ursachenketten über mehrere Werte, mit Massnahmen (Ration / nächstes Jahr) */
  function befunde(p) {
    const B = []; const a = art(p); const w = (k) => v(p, k); const z = (k) => (p.werte[k] && p.werte[k].ziel) || null;
    const ts = w('ts'); const ra = w('ra');
    // 1 Fehlgärung
    if (a === 'silage') {
      const bs = w('bs'); const ph = w('ph'); const kr = ts && ts <= 45 ? pHkrit(ts) : null;
      const zuHoch = ph != null && kr != null && ph > kr + 0.2;
      if ((bs != null && bs > 3) || zuHoch) {
        const gruende = [];
        if (ts != null && ts < 30) gruende.push('zu nass siliert (' + ts.toFixed(0) + ' % TS; Ziel 30–45 %)');
        else if (ts != null && ts < 35 && zuHoch) gruende.push('eher nass siliert (' + ts.toFixed(0) + ' % TS)');
        if (ra != null && ra > 100) gruende.push('Erde im Futter (Rohasche ' + ra + ' g) – bringt Buttersäurebakterien (Clostridien) mit');
        if (w('milchsaeure') != null && w('milchsaeure') < 40) gruende.push('wenig Milchsäure gebildet (' + w('milchsaeure') + ' g)');
        if (zuHoch) gruende.push('pH ' + String(ph).replace('.', ',') + ' liegt über dem kritischen Wert (' + kr.toFixed(2).replace('.', ',') + ')');
        const schwer = (bs != null && bs > 6) || (ph != null && kr != null && ph > kr + 0.4 && bs != null && bs > 3);
        B.push({ id: 'fehlgaerung', ton: schwer ? 'schlecht' : 'mittel', titel: (schwer ? 'Fehlgärung' : 'Gärqualität an der Grenze') + (bs != null && bs > 3 ? ' (Buttersäure ' + String(bs).replace('.', ',') + ' g/kg TS)' : ''),
          text: gruende.length ? 'Wahrscheinliche Ursachen: ' + gruende.join('; ') + '.' : 'Die Gärung ist nicht optimal verlaufen.',
          ration: 'Buttersäure-Silage sauber entnehmen und nur begrenzt verfüttern; Sporen gelangen über Kot und Euter in die Milch – auf Melkhygiene achten.',
          naechstes: bs != null && bs > 3 ? M.buttersaeure : M.ph,
          quelle: [Q.dlg, Q.weissbach, Q.k3b, Q.k4b] });
      }
    }
    // 2 Verschmutzung
    if (ra != null && ra > 100) {
      B.push({ id: 'erde', ton: ra > 120 ? 'schlecht' : 'mittel', titel: 'Verschmutzung (Rohasche ' + ra + ' g/kg TS)',
        text: 'Mehr Asche als bei sauberem Futter (80–100 g). Das kostet geschätzt ' + ((ra - 90) / 10 * 0.1).toFixed(1).replace('.', ',') + ' MJ NEL/kg TS und verschlechtert die Gärung.',
        ration: null, naechstes: ['Schnitthöhe 8–10 cm; Zetter und Schwader nicht zu tief einstellen', 'Wühlmäuse bekämpfen, Wiesen im Frühling eggen oder walzen', 'Nicht bei nassem Boden ernten; Gülle vor Regen ausbringen bzw. verdünnen'],
        quelle: [Q.swissgenetics, Q.sachsen, Q.k4b] });
    }
    // 2b Essigsäure (K4b «Essigsäuregeruch»)
    const es = w('essigsaeure'); const esGrenze = z('essigsaeure') && z('essigsaeure')[1] != null ? z('essigsaeure')[1] : 30;
    if (a === 'silage' && es != null && es > esGrenze) {
      const gr = [];
      if (ts != null && ts < 30) gr.push('nass siliert (' + ts.toFixed(0) + ' % TS)');
      gr.push('wenig verdichtet oder Luft im Silo (faseriges Futter lässt sich schlecht verdichten)');
      B.push({ id: 'essig', ton: es > Math.max(40, esGrenze * 1.3) ? 'schlecht' : 'mittel', titel: 'Viel Essigsäure (' + String(es).replace('.', ',') + ' g/kg TS)',
        text: 'Kostet Trockenmasse und Schmackhaftigkeit. Wahrscheinliche Ursachen: ' + gr.join('; ') + '.',
        ration: 'Futteraufnahme beobachten; mit schmackhaftem Futter kombinieren.', naechstes: M.essig, quelle: [z('essigsaeure') ? Q.ufag : Q.dlg_es, Q.k4b] });
    }
    // 2c Silage zu trocken (K4b: Ballen höchstens 55 % TS)
    if (a === 'silage' && ts != null && ts > (istMais(p) ? 38 : 55)) {
      B.push({ id: 'trocken', ton: 'mittel', titel: 'Sehr trocken siliert (' + ts.toFixed(0) + ' % TS)', text: 'Trockenes Futter lässt sich schlecht verdichten, säuert langsamer an und erwärmt sich leichter, sobald Luft zutritt.',
        ration: 'Nach dem Öffnen rasch verfüttern; auf warme und schimmlige Stellen achten.', naechstes: M.trocken, quelle: [Q.k4b_ts, Q.k4b] });
    }
    // 3 Später Schnitt / tiefe Verdaulichkeit
    const spaet = [];
    if (w('rf') != null && z('rf') && z('rf')[1] != null && w('rf') > z('rf')[1]) spaet.push('Rohfaser ' + w('rf') + ' g (Ziel bis ' + z('rf')[1] + ')');
    if (w('dndf') != null && z('dndf') && z('dndf')[0] != null && w('dndf') < z('dndf')[0]) spaet.push('NDF-Verdaulichkeit ' + String(w('dndf')).replace('.', ',') + ' % (Ziel ab ' + z('dndf')[0] + ')');
    if (w('vcos') != null && z('vcos') && z('vcos')[0] != null && w('vcos') < z('vcos')[0]) spaet.push('Verdaulichkeit ' + String(w('vcos')).replace('.', ',') + ' % (Ziel ab ' + z('vcos')[0] + ')');
    if (spaet.length) {
      const kontext = [p.meta.schnitt ? p.meta.schnitt + ' Schnitt' : '', p.meta.schnittdatum ? 'geerntet ' + p.meta.schnittdatum.split('-').reverse().join('.') : '', p.meta.hoehe || ''].filter(Boolean).join(', ');
      // deutlich: Rohfaser > 30 g über, Verdaulichkeit > 4 Punkte bzw. NDF-Verdaulichkeit > 6 Punkte unter dem Zielbereich
      const deutlich = (w('rf') != null && z('rf') && z('rf')[1] != null && w('rf') > z('rf')[1] + 30) || (w('vcos') != null && z('vcos') && z('vcos')[0] != null && w('vcos') < z('vcos')[0] - 4)
        || (w('dndf') != null && z('dndf') && z('dndf')[0] != null && w('dndf') < z('dndf')[0] - 6);
      B.push({ id: 'spaet', ton: deutlich ? 'schlecht' : 'mittel', titel: 'Futter älter als ideal', text: spaet.join('; ') + '.' + (kontext ? ' (' + kontext + ')' : ''),
        ration: 'Tiefere Energiedichte: mit energiereichem Futter ergänzen oder an Tiere mit geringerem Bedarf verfüttern.',
        naechstes: 'Früher nutzen – Stadium der Leitgräser beachten (Beginn Rispenschieben); in höheren Lagen die Zeitperiode berücksichtigen.', quelle: [Q.ufag, Q.mb3] });
    }
    // 4 Eiweissabbau
    if (a === 'silage' && w('nh3') != null && w('lprot') != null && w('nh3') > 8 && w('lprot') > 60) {
      B.push({ id: 'eiweiss', ton: w('nh3') > 12 ? 'schlecht' : 'mittel', titel: 'Eiweissabbau in der Silage', text: 'NH3 ' + String(w('nh3')).replace('.', ',') + ' % und lösliches Protein ' + w('lprot') + ' %: ein Teil des Eiweisses ist zu Ammoniak und löslichen Verbindungen abgebaut.',
        ration: 'Das Protein ist rasch verfügbar: Energie im Pansen sicherstellen (z. B. Mais, Getreide), Proteinkonzentrat eher sparen.',
        naechstes: 'Schneller ansäuern: anwelken, gut verdichten, rasch schliessen.', quelle: [Q.ufag] });
    }
    // 5 Nacherwärmung
    const nr = w('nerisk');
    if ((nr != null && nr > 20) || (nr == null && a === 'silage' && ts != null && ts > 40 && w('essigsaeure') != null && w('essigsaeure') < 10)) {
      B.push({ id: 'nacherw', ton: nr != null && nr > 40 ? 'schlecht' : 'mittel', titel: 'Risiko Nacherwärmung', text: nr != null ? 'Nacherwärmungsrisiko gemäss Labor ' + nr + ' (Ziel 1–20).' + (ts != null && ts > 40 ? ' Trockene Silage ist anfällig, sobald Luft zutritt.' : '') : 'Trockene Silage mit wenig Essigsäure ist anfällig, sobald Luft zutritt.',
        ration: 'Täglich genügend entnehmen (Vorschub), Anschnittfläche glatt halten, Futter rasch verfüttern.',
        naechstes: M.nacherw, quelle: [Q.ufag, Q.k4b] });
    }
    // 6 Heu nicht lagerfähig
    if (a === 'duerr' && ts != null && ts < 85) {
      B.push({ id: 'lager', ton: ts < 82 ? 'schlecht' : 'mittel', titel: 'Heu zu feucht für die Lagerung (' + ts.toFixed(1).replace('.', ',') + ' % TS)', text: 'Unter 85 % TS drohen Erwärmung und Schimmel.', ration: 'Futter auf Geruch und Schimmel prüfen, warme Stellen meiden.', naechstes: 'Länger trocknen bzw. belüften; vor dem Einführen die Trockenheit prüfen.', quelle: [Q.lager] });
    }
    // 7 Pansen-Bilanz
    const vb = verhaeltnisse(p).find((x) => x.id === 'pansen');
    if (vb && vb.ton !== 'gut') B.push({ id: 'pansen', ton: 'mittel', titel: 'Ergänzung für die Ration', text: vb.text, ration: vb.text, naechstes: null, quelle: vb.quelle });
    // 8 Tetanie
    const tt = verhaeltnisse(p).find((x) => x.id === 'tetanie');
    if (tt && tt.ton === 'schlecht') B.push({ id: 'tetanie', ton: 'schlecht', titel: 'Tetanie-Risiko', text: tt.text, ration: 'Magnesium ergänzen.', naechstes: 'Kalium- und Stickstoffdüngung prüfen.', quelle: tt.quelle });
    if (!B.length) B.push({ id: 'gut', ton: 'gut', titel: a === 'silage' ? 'Gut konservierte Silage' : a === 'gruen' ? 'Keine Auffälligkeiten' : 'Gutes Dürrfutter', text: 'Keine Auffälligkeiten in Gärung, Verschmutzung und Verdaulichkeit.', ration: null, naechstes: null, quelle: [] });
    return B.sort((x, y) => RANG[y.ton] - RANG[x.ton]);
  }

  /** Vergleich mit dem Schweizer Jahresmittel der Raufutter-Enquête (nur Dürrfutter und Grassilage). */
  function enquete(p) {
    const a = art(p); if (a === 'gruen' || istMais(p) || istGps(p)) return null;
    const jm = String(p.meta.schnittdatum || '').match(/(?:19|20)\d\d/); const jahrProbe = jm ? Number(jm[0]) : null;
    const tab = a === 'silage' ? ENQ_GS : ENQ_DF; const jahre = Object.keys(tab).map(Number);
    const jahr = jahrProbe && tab[jahrProbe] ? jahrProbe : Math.max.apply(null, jahre);
    const unbel = a === 'duerr' && /unbel|boden/i.test(p.meta.belueftung || '');
    const reihe = a === 'silage' ? tab[jahr] : tab[jahr][unbel ? 'u' : 'b']; const K = a === 'silage' ? ENQ_GS_K : ENQ_DF_K;
    const zeilen = [];
    K.forEach((k, i) => {
      if (k === 'n' || reihe[i] == null || !p.werte[k]) return;
      const x = p.werte[k].v; const m = reihe[i]; const d = x - m; const r = RICHTUNG[k] || 0;
      const rel = Math.abs(d) / (m || 1);
      const urteil = rel < 0.03 || r === 0 ? 'gleich' : (d > 0) === (r > 0) ? 'besser' : 'schlechter';
      zeilen.push({ k, probe: x, mittel: m, diff: d, urteil: r === 0 ? 'neutral' : urteil });
    });
    if (!zeilen.length) return null;
    return { jahr, genau: jahr === jahrProbe, art: a === 'silage' ? 'Grassilage' : 'Dürrfutter ' + (unbel ? 'unbelüftet' : 'belüftet'), n: reihe[0], zeilen, quelle: [Q.enquete] };
  }

  function auswerten(p) {
    const werte = {};
    Object.keys(p.werte).forEach((k) => { werte[k] = einzel(p, k); });
    const B = befunde(p);
    const gesamt = B.reduce((m, b) => (RANG[b.ton] > RANG[m] ? b.ton : m), 'gut');
    return { art: art(p), werte, verhaeltnisse: verhaeltnisse(p), befunde: B, gesamt, enquete: enquete(p) };
  }

  global.LaborRegeln = { auswerten, enquete, LABEL, GRUPPEN, FEST, Q, pHkrit, art };
})(typeof window !== 'undefined' ? window : globalThis);
