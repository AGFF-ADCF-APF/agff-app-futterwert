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
  };

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
    if (k === 'ts' && a === 'duerr') {
      const ton = x >= 85 ? 'gut' : x >= 82 ? 'mittel' : 'schlecht';
      return { ton, text: ton === 'gut' ? 'lagerfähig' : 'unter 85 % TS', quelle: [Q.lager], art: 'app' };
    }
    if (k === 'nel' && a === 'silage') {
      const mais = /mais/i.test((p.meta.name || '') + ' ' + (p.meta.bezeichnung || ''));
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
          naechstes: 'Stärker anwelken (30–45 % TS), Verschmutzung vermeiden, rasch und gut verdichten und dicht abdecken; bei schwer silierbarem Futter Siliermittel prüfen.',
          quelle: [Q.dlg, Q.weissbach, Q.k3b] });
      }
    }
    // 2 Verschmutzung
    if (ra != null && ra > 100) {
      B.push({ id: 'erde', ton: ra > 120 ? 'schlecht' : 'mittel', titel: 'Verschmutzung (Rohasche ' + ra + ' g/kg TS)',
        text: 'Mehr Asche als bei sauberem Futter (80–100 g). Das kostet geschätzt ' + ((ra - 90) / 10 * 0.1).toFixed(1).replace('.', ',') + ' MJ NEL/kg TS und verschlechtert die Gärung.',
        ration: null, naechstes: 'Schnitthöhe 7–8 cm, Zetter und Schwader nicht zu tief einstellen, Maulwurfshaufen einebnen, nicht bei nassem Boden ernten.',
        quelle: [Q.swissgenetics, Q.sachsen] });
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
        naechstes: 'Silo der Herdengrösse anpassen, gut verdichten; bei trockenem Futter Siliermittel gegen Nacherwärmung prüfen.', quelle: [Q.ufag, Q.orientierung] });
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

  function auswerten(p) {
    const werte = {};
    Object.keys(p.werte).forEach((k) => { werte[k] = einzel(p, k); });
    const B = befunde(p);
    const gesamt = B.reduce((m, b) => (RANG[b.ton] > RANG[m] ? b.ton : m), 'gut');
    return { art: art(p), werte, verhaeltnisse: verhaeltnisse(p), befunde: B, gesamt };
  }

  global.LaborRegeln = { auswerten, LABEL, GRUPPEN, FEST, Q, pHkrit, art };
})(typeof window !== 'undefined' ? window : globalThis);
