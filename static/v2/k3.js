/* Futter v2 – Fachlogik nach AGFF-Merkblättern K3a (Dürrfutter), K3b (Grassilage), K3c (Maissilage).
 * Reine Daten + Funktionen, kein DOM. Alle Korrekturen in Prozent (K3a/K3b) bzw. absolut (K3c).
 */
(function (global) {
  'use strict';

  // ---------- Botanische Zusammensetzung (Schritt 1, K3a/K3b) ----------
  const BESTAENDE = [
    { id: 'G', kurz: 'G', titel: 'Gräserreich', text: '> 70 % Gräser, weniger als die Hälfte Raigras' },
    { id: 'GR', kurz: 'Gᵣ', titel: 'Gräserreich, Raigras', text: '> 70 % Gräser, mehr als die Hälfte Raigras' },
    { id: 'A', kurz: 'A', titel: 'Ausgewogen', text: '50–70 % Gräser, weniger als die Hälfte Raigras' },
    { id: 'AR', kurz: 'Aᵣ', titel: 'Ausgewogen, Raigras', text: '50–70 % Gräser, mehr als die Hälfte Raigras' },
    { id: 'L', kurz: 'L', titel: 'Kleereich', text: '> 50 % Rot- und Weissklee' },
    { id: 'KF', kurz: 'Kᵒ', titel: 'Kräuterreich, feinblättrig', text: '> 50 % feinblättrige Kräuter' },
    { id: 'KG', kurz: 'Kᵍ', titel: 'Kräuterreich, grobstänglig', text: '> 50 % grobstänglige Kräuter' },
    { id: 'ITRG', kurz: 'It.RG', titel: 'Italienisch Raigras', text: '100 % Italienisch Raigras' },
    { id: 'LUZ', kurz: 'Luz', titel: 'Luzerne', text: 'Luzerne-Reinbestand' },
  ];
  // Lesbare Kurzform ohne Unicode-Hochstellung (für PDF)
  const BESTAND_PLAIN = { G: 'G', GR: 'GR', A: 'A', AR: 'AR', L: 'L', KF: 'KF', KG: 'KG', ITRG: 'It.RG', LUZ: 'Luz' };

  // ---------- Entwicklungsstadium (Schritt 2) ----------
  const STADIEN_ERSTER = [
    // [Knaulgras/Engl. RG, Wiesenfuchsschwanz/Geruchgras, Timothe, Rotklee/Luzerne, Löwenzahn]
    ['Bestocken bis Beginn Schossen', 'Schossen (10-cm-Punkt)', 'Bestocken', 'Blattrosette', 'Blütenknöpfe'],
    ['Schossen (10-cm-Punkt)', 'Beginn Rispenschieben', 'Bestocken bis Beginn Schossen', 'Blütenknospen', 'Erste Blüten offen'],
    ['Beginn Rispenschieben', 'Volles Rispenschieben', 'Schossen (10-cm-Punkt)', 'Wachsen der Stängel', 'Volle bis Ende Blüte'],
    ['Volles Rispenschieben', 'Ende Rispenschieben bis Beginn Blüte', 'Schossen bis Beginn Rispenschieben', 'Beginn Blüte', 'Samenstände'],
    ['Ende Rispenschieben', 'Blüte bis Samenreife', 'Beginn bis volles Rispenschieben', 'Volle Blüte', 'Nackte Blütenstände'],
    ['Blüte', 'Samenreife', 'Volles Rispenschieben', 'Ende Blüte', '–'],
    ['Samenreife', 'Versamung', 'Ende Rispenschieben', 'Samen', '–'],
  ];
  const REFERENZPFLANZEN = ['Knaulgras / Engl. Raigras', 'Wiesenfuchsschwanz / Geruchgras', 'Timothe', 'Rotklee / Luzerne', 'Wiesen-Löwenzahn'];
  const STADIEN_FOLGE_HINWEIS = {
    1: 'Gräser sehr fein, viele grüne Blätter, kurzer Bestand',
    3: 'Gräser fein mit einigen trockenen Blättern',
    5: 'Stehend, viele braune Blätter',
  };
  /** Vorschlag Stadium Folgeaufwuchs aus Wochen seit letztem Schnitt. */
  function stadiumFolge(wochen, ueber600, abSeptember) {
    const w = Number(wochen);
    if (!w || w < 1) return null;
    if (!ueber600 && !abSeptember) {
      if (w <= 3) return 1; if (w <= 4) return 2; if (w <= 6) return 3; if (w <= 8) return 4; return 5;
    }
    if (w <= 4) return 1; if (w <= 7) return 2; if (w <= 9) return 3; return 4;
  }

  // ---------- Bewertungsräder ----------
  // Farbpalette angelehnt an die gedruckten Räder (Sektor-Grundfarbe)
  const C = {
    geruch: '#f2a24a', farbe: '#5f9e78', feld: '#ec8a86', sauber: '#4fbfa8',
    essig: '#b3ad7c', alkohol: '#f7b765', erwaermung: '#c99a8b', butter: '#f6c35b',
    schimmel: '#5fbfb1', farbeS: '#ef8f95', ph: '#8fb6d9',
  };
  const K = (nel, apde, apdn) => ({ nel, nev: nel, apde, apdn });
  const NO = K(0, 0, 0);

  // K3a: Optionen tragen Korrekturen in % (NEL, NEV, APDE, APDN). block = "nicht verfüttern"
  const RAD_K3A = [
    {
      id: 'geruch', gruppe: 'Geruch', farbe: C.geruch, frage: 'Wonach riecht das Heu?',
      hilfe: 'Von innen nach aussen: zuerst die Geruchsrichtung, dann die Stärke.',
      optionen: [
        { id: 'ohne', mitte: 'Ohne spez. Geruch', kurz: '0', text: 'Ohne speziellen Geruch', k: NO },
        { id: 'stall', mitte: 'Stall', kurz: '0', text: 'Stall: Ort der Lagerung, Tiere, Mist (aber nicht Urin)', k: NO },
        { id: 'gras_arom', mitte: 'Gras', kurz: '0', text: 'Gras: aromatische Pflanzen, «Ricola»', k: NO },
        { id: 'gras_frisch', mitte: 'Gras', kurz: '0', text: 'Gras: gemähter Rasen, frisches Gras', k: NO },
        { id: 'erw_leicht', mitte: 'Erwärmt', kurz: '+3', text: 'Erwärmt, leicht: aromatisch, angenehm – Vanille, Caramel, Brot, Zwieback, Malz, Melasse', k: K(0, 3, 0) },
        { id: 'erw_stark', mitte: 'Erwärmt', kurz: '−3', text: 'Erwärmt, stark: eher unangenehm – stark verbrannt, stechend, rauchig, Cheminée, Kohle, Tabak', k: K(-3, -1, -1) },
        { id: 'muff_leicht', mitte: 'Muffig', kurz: '−3', text: 'Muffig, leicht (nicht verschimmelt): sticht in der Nase, leichter Geruch nach Staub, nasser Karton', k: K(-3, -1, -1) },
        { id: 'muff_stark', mitte: 'Muffig', kurz: '!', text: 'Muffig, stark verschimmelt: Erde, Kellerboden, Schimmel, Blauschimmelkäse, Pilze, abgestorbene Blätter, Urin', k: NO, block: 'Risiko von Mykotoxinen – nicht verfüttern!' },
      ],
    },
    {
      id: 'farbe', gruppe: 'Farbe', farbe: C.farbe, frage: 'Welche Farbe haben die Blätter?',
      optionen: [
        { id: 'gruen', mitte: 'Grün', kurz: '0', text: 'Grün – auch im fortgeschrittenen Stadium grüne Blätter wie ursprünglich', k: NO },
        { id: 'leicht', mitte: 'Leicht verbl.', kurz: '−3', text: 'Leicht verbleicht – Blätter nicht mehr wirklich grün, ohne Schimmel', k: K(-3, -4, -1) },
        { id: 'verbl', mitte: 'Verbleicht', kurz: '−4', text: 'Verbleicht – Blätter total verbleicht: weisslich, gräulich (kein Grün)', k: K(-4, -8, -3) },
        { id: 'braun', mitte: 'Bräunlich', kurz: '−3', text: 'Bräunlich – Blätter braun, beige, gelblich', k: K(-3, -1, -1) },
        { id: 'mehrf', mitte: 'Mehrfarbig', kurz: '!', text: 'Mehrfarbig – Schimmelspuren weiss, grau, rosa, bläulich', k: NO, block: 'Risiko von Mykotoxinen – nicht verfüttern!' },
      ],
    },
    {
      id: 'regen', gruppe: 'Feldbedingungen', farbe: C.feld, frage: 'Gab es Niederschlag während der Bodentrocknung?',
      optionen: [
        { id: 'nein', mitte: 'Niederschlag', kurz: '0', text: 'Nein', k: NO },
        { id: 'tag1', mitte: 'Niederschlag', kurz: '−5', text: '1 Tag Regen', k: K(-5, -8, -2) },
        { id: 'tag2', mitte: 'Niederschlag', kurz: '−8', text: '2 Tage und mehr', k: K(-8, -15, -5) },
      ],
    },
    {
      id: 'blaetter', gruppe: 'Feldbedingungen', farbe: C.feld, frage: 'Sind die Blätter von Kräutern noch vorhanden?',
      optionen: [
        { id: 'sichtbar', mitte: 'Blätter v. Kräutern', kurz: '0', text: 'Blätter gut sichtbar (typisch Heubelüftung)', k: NO },
        { id: 'fehlen', mitte: 'Blätter v. Kräutern', kurz: '−4', text: 'Keine Blätter trotz Stängeln von Kräutern (Bröckelverluste, Bodentrocknung)', k: K(-4, -3, -3) },
      ],
    },
    {
      id: 'mist', gruppe: 'Sauberkeit', farbe: C.sauber, frage: 'Rückstände von Mist oder Gülle?',
      optionen: [
        { id: 'keine', mitte: 'Mist, Gülle', kurz: '0', text: 'Keine sichtbaren Rückstände', k: NO },
        { id: 'spuren', mitte: 'Mist, Gülle', kurz: '!', text: 'Sichtbare Spuren: Rückstände kleben an Blättern und Stängeln', k: NO, block: 'Achtung – nicht verfüttern!' },
      ],
    },
    {
      id: 'erde', gruppe: 'Sauberkeit', farbe: C.sauber, frage: 'Erde oder Sand?',
      optionen: [
        { id: 'sauber', mitte: 'Erde, Sand', kurz: '0', text: 'Sauber unter der Probe: Finger sauber, nicht glänzend', k: NO },
        { id: 'partikel', mitte: 'Erde, Sand', kurz: '−4', text: 'Sichtbare Partikel unter der Probe, Knirschen zwischen den Zähnen', k: K(-4, -3, -3) },
      ],
    },
    {
      id: 'staub', gruppe: 'Sauberkeit', farbe: C.sauber, frage: 'Staubt die Probe beim Schütteln?',
      optionen: [
        { id: 'kein', mitte: 'Staub', kurz: '0', text: 'Kein Staub', k: NO },
        { id: 'bluete', mitte: 'Staub', kurz: '0', text: 'Blütenstaub, z. B. Löwenzahn (ohne Schimmel)', k: NO },
        { id: 'schimmel', mitte: 'Staub', kurz: '!', text: 'Staub durch Schimmel oder Erwärmung', k: NO, block: 'Risiko von Mykotoxinen – nicht verfüttern!' },
      ],
    },
  ];

  // K3b / K3c: Optionen tragen Punkte (DLG-Schema)
  const P4 = (texte, pts) => texte.map((t, i) => ({ id: 'p' + pts[i], kurz: String(pts[i]), text: t, p: pts[i] }));
  const RAD_K3B = [
    { id: 'essig', gruppe: 'Essigsäure-gärung', mitte: 'Sticht in der Nase, Essiggeruch', farbe: C.essig, frage: 'Essigsäure: sticht es in der Nase?',
      optionen: P4(['Nicht wahrnehmbar', 'Schwach wahrnehmbar', 'Deutlich wahrnehmbar', 'Stark wahrnehmbar, unangenehm stechend'], [0, 1, 2, 4]) },
    { id: 'alkohol', gruppe: 'Alkoholgärung, Hefe', mitte: 'Mostartiger, gäriger Geruch, Alkohol', farbe: C.alkohol, frage: 'Alkohol / Hefe: mostartig, gärig?',
      optionen: P4(['Nicht wahrnehmbar', 'Schwach wahrnehmbar', 'Deutlich wahrnehmbar', 'Stark wahrnehmbar, gärig'], [0, 1, 2, 4]) },
    { id: 'erwaermung', gruppe: 'Nach-erwärmung', mitte: 'Erwärmt, Caramel, verbrannt, gegrillt', farbe: C.erwaermung, frage: 'Nacherwärmung: Caramel, verbrannt?',
      optionen: P4(['Nicht wahrnehmbar', 'Leichter Geruch, angenehm', 'Grillgeruch, Rauchgeruch', 'Starker Rauchgeruch, unangenehm'], [0, 1, 2, 4]) },
    { id: 'butter', gruppe: 'Buttersäure-gärung', mitte: 'Alte ranzige Butter, Russ, klebt an den Händen', farbe: C.butter, frage: 'Buttersäure: ranzige Butter, Fäkalgeruch?',
      optionen: P4(['Nicht wahrnehmbar', 'Nur feststellbar beim Durchreiben', 'Leicht feststellbar ohne zu reiben', 'Von 1 m Entfernung feststellbar', 'Von Weitem feststellbar, Fäkalgeruch'], [0, 2, 3, 5, 7]) },
    { id: 'schimmel', gruppe: 'Schimmel-pilz', mitte: 'Schimmel, muffig, Keller, nasser Karton', farbe: C.schimmel, frage: 'Schimmel: muffig, Kellergeruch?',
      optionen: P4(['Nicht wahrnehmbar', 'Schwach wahrnehmbar', 'Deutlich wahrnehmbar', 'Stark wahrnehmbar'], [0, 3, 5, 7]) },
    { id: 'farbe', gruppe: 'Farbe', mitte: 'Bestätigung unerwünschter Gärungen', farbe: C.farbeS, frage: 'Farbe der Silage?',
      optionen: P4(['Normal', 'Leicht bleich, bräunlich', 'Stark verbleicht, braun', 'Grau-grün, schwarz, rot'], [0, 2, 4, 7]) },
    { id: 'ph', gruppe: 'Milchsäure-gärung', mitte: 'pH-Wert (Ziel < 4,6)', farbe: C.ph, frage: 'pH-Wert (Punkte aus Schritt 5)', ph: true,
      optionen: [{ id: 'na', kurz: '–', text: 'Nicht gemessen', p: null }].concat(P4(['0 Punkte', '1 Punkt', '2 Punkte', '3 Punkte', '4 Punkte', '5 Punkte'], [0, 1, 2, 3, 4, 5])) },
  ];

  const RAD_K3C = [
    { id: 'essig', gruppe: 'Essigsäure-gärung', mitte: 'Sticht in der Nase, Essig (Propionsäure)', farbe: C.essig, frage: 'Essig-/Propionsäure: sticht es in der Nase?',
      optionen: P4(['Nicht wahrnehmbar', 'Schwach wahrnehmbar', 'Deutlich wahrnehmbar', 'Sehr stark, unangenehm'], [0, 1, 2, 4]) },
    { id: 'alkohol', gruppe: 'Alkohol-gärung', mitte: 'Saurer Most, Alkohol, reife Früchte', farbe: C.alkohol, frage: 'Alkohol: saurer Most, reife Früchte?',
      optionen: P4(['Nicht wahrnehmbar', 'Schwach wahrnehmbar', 'Deutlich wahrnehmbar', 'Stark, saurer Most'], [0, 1, 2, 4]) },
    { id: 'erwaermung', gruppe: 'Erwärmung', mitte: 'Erwärmt, Caramel, verbrannt, Grill', farbe: C.erwaermung, frage: 'Erwärmung: Caramel, Grill, Rauch?',
      optionen: P4(['Nicht wahrnehmbar', 'Leichter Geruch, angenehm', 'Deutlicher Grill-/Rauchgeruch', 'Starker Grill-/Rauchgeruch, unangenehm'], [0, 1, 2, 4]) },
    { id: 'butter', gruppe: 'Buttersäure-gärung', mitte: 'Ranzige Butter, eklig, Erbrochenes', farbe: C.butter, frage: 'Buttersäure: ranzige Butter, Erbrochenes?',
      optionen: P4(['Nicht wahrnehmbar', 'Wahrnehmbar erst nach Reiben der Finger (Fingerprobe)'], [0, 2]) },
    { id: 'schimmel', gruppe: 'Schimmel', mitte: 'Schimmlig, muffig, Keller, Socken', farbe: C.schimmel, frage: 'Schimmel: muffig, Kellergeruch?',
      optionen: P4(['Nicht wahrnehmbar', 'Schwach wahrnehmbar', 'Deutlich wahrnehmbar', 'Sehr stark, unangenehm'], [0, 3, 5, 7]) },
    { id: 'farbe', gruppe: 'Farbe', mitte: 'Bestätigung unerwünschter Gärungen', farbe: C.farbeS, frage: 'Farbe der Silage?',
      optionen: P4(['Blätter dunkelgrün, andere Teile gelb', 'Leicht bräunlich, orange', 'Orange-dunkelbraun, gräulich', 'Rote, blaue, weisse Flecken'], [0, 2, 4, 7]) },
    { id: 'ph', gruppe: 'Milchsäure-gärung', mitte: 'pH-Wert messen', farbe: C.ph, frage: 'pH-Wert', ph: true,
      optionen: [{ id: 'na', kurz: '–', text: 'Nicht gemessen', p: null }].concat(P4(['< 4,1', '4,1 – 4,2', '4,2 – 4,5', '> 4,5'], [0, 2, 4, 5])) },
  ];

  // ---------- K3b Schritte 3–5 ----------
  const K3B_SAUBERKEIT = [
    { id: 'sauber', text: 'Sauberes Futter', k: NO },
    { id: 'leicht', text: 'Leichte Verschmutzung (Erde, Sandkörner, Gülle- und Mistreste in kleinen Mengen)', k: { nel: -5, nev: -5, apde: -5, apdn: -5 } },
    { id: 'stark', text: 'Starke Verschmutzung (sichtbar, ohne die Silage in die Hände zu nehmen)', k: { nel: -10, nev: -10, apde: -10, apdn: -10 } },
  ];
  const K3B_TS = [
    { id: 'lt20', ts: '< 20 %', text: 'Probe als Kugel, Saftfluss bei leichtem Pressen', k: { nel: -1, nev: -1, apde: -6, apdn: 0 }, phSpalte: 0, tsWert: 18 },
    { id: '25', ts: '25 %', text: 'Probe als Kugel, Saftfluss bei starkem Pressen', k: NO, phSpalte: 1, tsWert: 25 },
    { id: '30', ts: '30 %', text: 'Nach dem Auswinden Saft zwischen den Fingern', k: NO, phSpalte: 1, tsWert: 30 },
    { id: '35', ts: '35 %', text: 'Kein Saft zwischen den Fingern, aber feuchte Hände', k: NO, phSpalte: 2, tsWert: 35 },
    { id: '40', ts: '40 %', text: 'Nach dem Auswinden glänzen die Hände noch', k: NO, phSpalte: 2, tsWert: 40 },
    { id: '45', ts: '45 %', text: 'Nach dem Auswinden ein leichtes Feuchtegefühl', k: NO, phSpalte: 2, tsWert: 45 },
    { id: 'gt45', ts: '> 45 %', text: 'Nach dem Auswinden sind die Hände komplett trocken', k: { nel: -1, nev: -1, apde: 6, apdn: 0 }, phSpalte: 3, tsWert: 50 },
  ];
  // pH-Punkte K3b: Spalten-Basis 4,2 / 4,4 / 4,6 / 4,8; Stufen à 0,4
  function phPunkteK3b(ph, spalte) {
    const x = Number(ph);
    if (!isFinite(x) || x <= 0 || spalte == null) return null;
    const b = [4.2, 4.4, 4.6, 4.8][spalte];
    const eps = 1e-9;
    if (x < b - eps) return 0;
    if (x < b + 0.4 - eps) return 1;
    if (x < b + 0.8 - eps) return 2;
    if (x < b + 1.2 - eps) return 3;
    if (x <= b + 1.2 + eps) return 4;
    return 5;
  }
  function phPunkteK3c(ph) {
    const x = Number(ph);
    if (!isFinite(x) || x <= 0) return null;
    if (x < 4.1) return 0; if (x <= 4.2) return 2; if (x <= 4.5) return 4; return 5;
  }
  const K3B_KLASSEN = [
    { id: 'gut', label: 'Gute Silage', ton: 'gut', k: NO },
    { id: 'leicht', label: 'Leicht fehlerhafte Silage', ton: 'mittel', k: { nel: -2, nev: -2, apde: -6, apdn: 0 } },
    { id: 'stark', label: 'Stark fehlerhafte Silage', ton: 'schlecht', k: { nel: -4, nev: -4, apde: -12, apdn: 0 } },
    { id: 'problem', label: 'Problematische Silage', ton: 'kritisch', k: { nel: -9, nev: -9, apde: -30, apdn: -6 } },
  ];
  function k3bKlasse(punkte, mitPh) {
    // mit pH: <3 | 3–4 | 5–7 | >7 ; ohne pH: <2 | 2–3 | 4 | >4 (Überlappung bei 3 → "leicht")
    const g = mitPh ? [3, 5, 8] : [2, 4, 5];
    if (punkte < g[0]) return K3B_KLASSEN[0];
    if (punkte < g[1]) return K3B_KLASSEN[1];
    if (punkte < g[2]) return K3B_KLASSEN[2];
    return K3B_KLASSEN[3];
  }

  // ---------- K3c Schritte 1–4, 6 ----------
  const K3C_SCHRITTE = [
    { id: 'laenge', titel: 'Schnittlänge', frage: 'Häcksellänge (z. B. Schüttelbox / Penn State Separator)', optionen: [
      { id: 'a', text: 'Median 10 mm, max. 5 % der Stängel > 20 mm', r: 'ausgezeichnet' },
      { id: 'b', text: 'Median 8–9 oder 11–12 mm und/oder max. 10 % > 20 mm', r: 'akzeptabel' },
      { id: 'c', text: 'Mehr als 15 % der Stängel > 20 mm', r: 'ungenügend' }] },
    { id: 'schnitt', titel: 'Schnittqualität', frage: 'Sind die Stängel sauber geschnitten?', optionen: [
      { id: 'a', text: 'Gerader Schnitt, keine verfransten Stängel', r: 'ausgezeichnet' },
      { id: 'b', text: 'Mehr oder weniger gerade, einige Stängel verfranst', r: 'akzeptabel' },
      { id: 'c', text: 'Verfranst, Stängel verrissen und schlecht geschnitten', r: 'ungenügend' }] },
    { id: 'koerner', titel: 'Zustand der Körner', frage: 'Anteil ganzer Körner (Auswaschmethode)', optionen: [
      { id: 'k0', text: 'Keine ganzen Körner' },
      { id: 'k10', text: 'Weniger als 10 % ganze Körner' },
      { id: 'k20', text: '10 bis 20 % ganze Körner' },
      { id: 'k33', text: 'Mehr als 20 %, bis über ein Drittel ganze Körner' }] },
    { id: 'ts', titel: 'Trockensubstanz', frage: 'Handtest: Hand zusammendrücken, ohne zu pressen', optionen: [
      { id: 'lt30', ts: '< 30 %', text: 'Es entsteht Gärsaft', r: 'ungenügend' },
      { id: '30', ts: '30–32 %', text: 'Ein wenig Saft fliesst', r: 'gut' },
      { id: '32', ts: '32–36 %', text: 'Etwas Feuchtigkeit zwischen den Fingern, tropft nicht', r: 'ausgezeichnet' },
      { id: '36', ts: '36–38 %', text: 'Noch ein wenig Feuchtegefühl', r: 'akzeptabel, falls gut verdichtet' },
      { id: 'gt38', ts: '> 38 %', text: 'Keine Feuchtigkeit mehr fühlbar', r: 'ungenügend' }] },
  ];
  function k3cKoernerRating(koerner, ts) {
    if (!koerner) return null;
    const ueber36 = ts === '36' || ts === 'gt38';
    if (ueber36) return koerner === 'k0' ? 'ausgezeichnet' : 'ungenügend';
    return { k0: 'ausgezeichnet', k10: 'ausgezeichnet', k20: 'akzeptabel', k33: 'ungenügend' }[koerner];
  }
  const K3C_METRIKEN = ['nel', 'nev', 'apde', 'apdn', 'rp', 'rf', 'ndf', 'staerke', 'zucker'];
  const K3C_AUSGANG = [
    { max: 1, id: 'gut', label: 'Ausgezeichnet', ton: 'gut', w: [6.5, 6.7, 65, 46, 74, 188, 389, 320, 15] },
    { max: 4, id: 'leicht', label: 'Leicht fehlerhaft', ton: 'mittel', w: [6.4, 6.6, 62, 48, 74, 188, 389, 320, 15] },
    { max: 8, id: 'stark', label: 'Stark fehlerhaft', ton: 'schlecht', w: [6.2, 6.4, 56, 47, 74, 188, 389, 320, null] },
    { max: Infinity, id: 'problem', label: 'Problematisch, geschimmelt', ton: 'kritisch', w: null },
  ];
  const K3C_KORR = {
    ts_lt32: { label: 'TS < 32 %', w: [-0.1, -0.1, 0, 1, 1, 10, 19, -25, 4] },
    ts_gt36: { label: 'TS > 36 %', w: [0, 0, 0, -1, -1, 2, 5, 0, 2] },
    kolben_45: { label: 'Kolbenanteil 45–55 %', w: [-0.2, -0.2, -2, -1, -1, 17, 25, -59, 0] },
    kolben_lt45: { label: 'Kolbenanteil < 45 %', w: [-0.8, -1.0, -9, -5, -9, 70, 100, -132, 0] },
    hoch: { label: 'Schnitthöhe > 50 cm', w: [0.2, 0.3, 0, -2, -4, -32, -55, 81, -1] },
    power: { label: '«Powermais»', w: [0.6, 0.8, 0, -8, -5, -45, -92, 186, 0] },
  };

  // ---------- Futtertypen ----------
  const TYPEN = {
    heu: { id: 'heu', merkblatt: 'K3a', farbe: '#5f9e78', titel: 'Dürrfutter', kurz: 'Heu/Emd', rad: RAD_K3A, basisKons: 'heu',
      ziel: 'Gutes Dürrfutter für Milchkühe: > 5,5 MJ NEL und > 140 g RP pro kg TS, grün, aromatisch, schmutzfrei.' },
    gras: { id: 'gras', merkblatt: 'K3b', farbe: '#6fa3d4', titel: 'Grassilage', kurz: 'Grassilage', rad: RAD_K3B, basisKons: 'silage',
      ziel: 'Eine gute Grassilage hat über 5,8 MJ NEL pro kg TS und keine Konservierungsfehler.' },
    mais: { id: 'mais', merkblatt: 'K3c', farbe: '#e9b43c', titel: 'Maissilage', kurz: 'Maissilage', rad: RAD_K3C,
      ziel: 'Ausgezeichnet: 32–36 % TS, Kolbenanteil > 55 %, pH < 4,1, keine Fehlgärungen und keine Nacherwärmung.' },
    gruen: { id: 'gruen', merkblatt: 'GF', quelle: 'Agroscope-Tabelle', farbe: '#8cbf4f', titel: 'Grünfutter', kurz: 'Grünfutter/Weide', rad: [], basisKons: 'gruen',
      ziel: 'Nährwert aus der Agroscope-Tabelle für Bestand, Aufwuchs und Stadium; Abzug bei Verschmutzung.' },
    gps: { id: 'gps', merkblatt: 'GPS', quelle: 'Richtwert-Modell, Rad K3b', farbe: '#c98f5a', titel: 'Ganzpflanzensilage', kurz: 'GPS', rad: RAD_K3B,
      ziel: 'Richtwert-Modell wie v1: Kultur, Stadium und Leguminosen; Gärqualität mit dem Rad der Grassilage (K3b).' },
  };

  // ---------- Ganzpflanzensilage (GPS): Richtwert-Modell aus v1 (AGFF-Näherung, Silage-Getreide-Referenzen) ----------
  const GPS_KULTUREN = [
    { id: 'weizen', titel: 'Weizen', w: { nel: 5.0, nev: 5.3, apde: 55, apdn: 62, rp: 105, rf: 290, ndf: 500, staerke: 170, zucker: 35 } },
    { id: 'gerste', titel: 'Gerste', w: { nel: 5.0, nev: 5.3, apde: 54, apdn: 60, rp: 100, rf: 300, ndf: 520, staerke: 160, zucker: 30 } },
    { id: 'triticale', titel: 'Triticale', w: { nel: 5.0, nev: 5.2, apde: 53, apdn: 58, rp: 95, rf: 315, ndf: 540, staerke: 150, zucker: 28 } },
    { id: 'hafer', titel: 'Hafer', w: { nel: 5.8, nev: 6.0, apde: 58, apdn: 66, rp: 112, rf: 265, ndf: 470, staerke: 200, zucker: 40 } },
    { id: 'roggen', titel: 'Roggen', w: { nel: 6.0, nev: 6.2, apde: 60, apdn: 68, rp: 115, rf: 250, ndf: 450, staerke: 220, zucker: 45 } },
    { id: 'wickhafer', titel: 'Wickhafer', w: { nel: 6.1, nev: 6.3, apde: 64, apdn: 74, rp: 135, rf: 240, ndf: 430, staerke: 190, zucker: 50 } },
    { id: 'mischung', titel: 'Mischung / unbekannt', w: { nel: 5.6, nev: 5.9, apde: 60, apdn: 70, rp: 125, rf: 265, ndf: 470, staerke: 175, zucker: 42 } },
  ];
  const GPS_STADIEN = [
    { id: 'frueh', titel: 'Früh', text: 'Frühe Kornfüllung, hoher Blattanteil', k: { nel: 0.3, nev: 0.3, apde: 6, apdn: 2, rp: 20, rf: -35, ndf: -45, staerke: -30, zucker: 10 } },
    { id: 'optimal', titel: 'Optimal', text: 'Milchreif bis frühe Teigreife', k: {} },
    { id: 'spaet', titel: 'Spät', text: 'Teigreif bis überständig', k: { nel: -0.4, nev: -0.4, apde: -8, apdn: -4, rp: -18, rf: 45, ndf: 60, staerke: 35, zucker: -8 } },
  ];
  const GPS_LEGUM = [
    { id: 'none', titel: 'Kein Anteil', k: {} },
    { id: 'low', titel: 'Gering (< 20 %)', k: { nel: 0.1, nev: 0.1, apde: 2, apdn: 3, rp: 10, rf: -4, ndf: -8, staerke: -8, zucker: 2 } },
    { id: 'medium', titel: 'Mittel (20–40 %)', k: { nel: 0.2, nev: 0.2, apde: 5, apdn: 7, rp: 22, rf: -10, ndf: -14, staerke: -18, zucker: 4 } },
    { id: 'high', titel: 'Hoch (> 40 %)', k: { nel: 0.3, nev: 0.3, apde: 8, apdn: 12, rp: 35, rf: -16, ndf: -22, staerke: -30, zucker: 6 } },
  ];
  const GPS_TS = { lt30: { nel: -0.1, nev: -0.1, apde: -2, apdn: -1, rp: 0, rf: 8, ndf: 10, staerke: -8, zucker: 2 }, gt40: { nel: -0.2, nev: -0.2, apde: -1, apdn: -2, rp: -2, rf: 12, ndf: 14, staerke: -10, zucker: -2 } };
  const GPS_KONS = { sehr_gut: { nel: 0.1, nev: 0.1, apde: 1, apdn: 1, rp: 1, rf: -2, ndf: -3, staerke: 2, zucker: 2 }, normal: {},
    kritisch: { nel: -0.2, nev: -0.2, apde: -3, apdn: -2, rp: -3, rf: 12, ndf: 18, staerke: -8, zucker: -3 },
    schlecht: { nel: -0.4, nev: -0.4, apde: -5, apdn: -4, rp: -8, rf: 35, ndf: 45, staerke: -15, zucker: -6 } };
  const addK = (w, k) => { Object.keys(k || {}).forEach((m) => { if (w[m] != null) w[m] = w[m] + k[m]; }); return w; };

  const METRIK_LABEL = {
    nel: ['NEL', 'MJ'], nev: ['NEV', 'MJ'], apde: ['APDE', 'g'], apdn: ['APDN', 'g'], rp: ['RP', 'g'], rf: ['RF', 'g'],
    ndf: ['NDF', 'g'], adf: ['ADF', 'g'], zucker: ['Zucker', 'g'], ra: ['RA', 'g'], ca: ['Ca', 'g'], p: ['P', 'g'],
    mg: ['Mg', 'g'], k: ['K', 'g'], staerke: ['Stärke', 'g'],
  };

  // ---------- Auswertung ----------
  const sumK = (list) => list.reduce((a, k) => ({ nel: a.nel + k.nel, nev: a.nev + k.nev, apde: a.apde + k.apde, apdn: a.apdn + k.apdn }), { nel: 0, nev: 0, apde: 0, apdn: 0 });
  const findOpt = (faktor, id) => faktor.optionen.find((o) => o.id === id);

  /** Wählt automatisch pH-Punkte aus dem Messwert, falls vorhanden. */
  function phOptionId(probe) {
    const a = probe.antworten || {};
    if (probe.typ === 'gras' || probe.typ === 'gps') {
      const ts = K3B_TS.find((t) => t.id === a.ts);
      const p = phPunkteK3b(a.phWert, ts ? ts.phSpalte : null);
      return p == null ? null : 'p' + p;
    }
    if (probe.typ === 'mais') {
      const p = phPunkteK3c(a.phWert);
      return p == null ? null : 'p' + p;
    }
    return null;
  }

  function radAuswahl(probe) {
    const typ = TYPEN[probe.typ];
    const rad = (probe.rad || {});
    const out = {};
    typ.rad.forEach((f) => {
      let id = rad[f.id];
      if (f.ph) { const auto = phOptionId(probe); if (auto) id = auto; }
      out[f.id] = id || null;
    });
    return out;
  }

  function pickBasis(basis, probe) {
    const typ = TYPEN[probe.typ];
    const a = probe.antworten || {};
    if (!basis || !typ.basisKons || !a.bestand || !a.aufwuchs || !a.stadium) return null;
    const t = basis[typ.basisKons] && basis[typ.basisKons][a.aufwuchs] && basis[typ.basisKons][a.aufwuchs][a.bestand];
    return (t && t[String(a.stadium)]) || null;
  }
  function verfuegbareStadien(basis, typId, aufwuchs, bestand) {
    const typ = TYPEN[typId];
    if (!basis || !typ.basisKons) return [];
    const t = basis[typ.basisKons] && basis[typ.basisKons][aufwuchs] && basis[typ.basisKons][aufwuchs][bestand];
    return t ? Object.keys(t).map(Number).sort((x, y) => x - y) : [];
  }

  /**
   * Berechnet die komplette Auswertung einer Probe.
   * Liefert { vollstaendig, fehlend[], sperre[], klasse, punkte, korr{}, basis{}, werte{}, ziel{} , ... }
   */
  function auswerten(probe, basis) {
    const typ = TYPEN[probe.typ];
    const a = probe.antworten || {};
    const sel = radAuswahl(probe);
    const fehlend = [];
    const sperre = [];
    const res = { typ: typ.id, merkblatt: typ.merkblatt, auswahl: sel, fehlend, sperre };

    typ.rad.forEach((f) => {
      const o = sel[f.id] && findOpt(f, sel[f.id]);
      if (!o && !f.ph) fehlend.push(f.gruppe.replace('-', '') + (f.gruppe === 'Feldbedingungen' || f.gruppe === 'Sauberkeit' ? ' (' + f.optionen[0].mitte + ')' : ''));
      if (o && o.block) sperre.push(o.block);
    });

    if (typ.id === 'heu' || typ.id === 'gras' || typ.id === 'gruen') {
      if (!a.bestand) fehlend.unshift('Botanische Zusammensetzung');
      if (!a.aufwuchs || !a.stadium) fehlend.unshift('Aufwuchs / Stadium');
    }

    if (typ.id === 'heu') {
      const ks = typ.rad.map((f) => { const o = sel[f.id] && findOpt(f, sel[f.id]); return o ? o.k : NO; });
      const korr = sumK(ks);
      res.korr = korr;
      res.punkte = null;
      const total = korr.nel;
      res.klasse = sperre.length ? { id: 'sperre', label: 'Nicht verfüttern', ton: 'kritisch' }
        : total >= 0 ? { id: 'gut', label: 'Ohne Konservierungsmängel', ton: 'gut' }
        : total >= -4 ? { id: 'leicht', label: 'Leichte Mängel', ton: 'mittel' }
        : total >= -9 ? { id: 'stark', label: 'Deutliche Mängel', ton: 'schlecht' }
        : { id: 'problem', label: 'Starke Mängel', ton: 'kritisch' };
    }

    if (typ.id === 'gras') {
      const sb = K3B_SAUBERKEIT.find((x) => x.id === a.sauberkeit);
      const ts = K3B_TS.find((x) => x.id === a.ts);
      if (!sb) fehlend.push('Sauberkeit');
      if (!ts) fehlend.push('TS-Gehalt (Auswringprobe)');
      let punkte = 0; let mitPh = false;
      typ.rad.forEach((f) => {
        const o = sel[f.id] && findOpt(f, sel[f.id]);
        if (o && o.p != null) { punkte += o.p; if (f.ph) mitPh = true; }
      });
      const kl = k3bKlasse(punkte, mitPh);
      res.punkte = punkte; res.mitPh = mitPh;
      res.klasse = kl;
      res.teilKorr = { sauberkeit: sb ? sb.k : NO, ts: ts ? ts.k : NO, konservierung: kl.k };
      res.korr = sumK([res.teilKorr.sauberkeit, res.teilKorr.ts, kl.k]);
      if (kl.id === 'problem') sperre.push('Problematische Silage – Verfütterung kritisch prüfen.');
    }

    if (typ.id === 'gruen') {
      const sb = K3B_SAUBERKEIT.find((x) => x.id === a.sauberkeit);
      if (!sb) fehlend.push('Sauberkeit');
      res.punkte = null;
      res.teilKorr = { sauberkeit: sb ? sb.k : NO };
      res.korr = sumK([res.teilKorr.sauberkeit]);
      res.klasse = !sb || sb.id === 'sauber' ? { id: 'gut', label: 'Sauberes Grünfutter', ton: 'gut' }
        : sb.id === 'leicht' ? { id: 'leicht', label: 'Leicht verschmutzt', ton: 'mittel' } : { id: 'stark', label: 'Stark verschmutzt', ton: 'schlecht' };
    }

    if (typ.id === 'gps') {
      const ku = GPS_KULTUREN.find((x) => x.id === a.kultur);
      const st = GPS_STADIEN.find((x) => x.id === a.gpsStadium);
      const lg = GPS_LEGUM.find((x) => x.id === (a.leguminosen || 'none'));
      const sb = K3B_SAUBERKEIT.find((x) => x.id === a.sauberkeit);
      const ts = K3B_TS.find((x) => x.id === a.ts);
      if (!ku) fehlend.push('Kultur');
      if (!st) fehlend.push('Stadium');
      if (!sb) fehlend.push('Sauberkeit');
      if (!ts) fehlend.push('TS-Gehalt (Auswringprobe)');
      let punkte = 0; let mitPh = false;
      typ.rad.forEach((f) => { const o = sel[f.id] && findOpt(f, sel[f.id]); if (o && o.p != null) { punkte += o.p; if (f.ph) mitPh = true; } });
      const kl = k3bKlasse(punkte, mitPh);
      res.punkte = punkte; res.mitPh = mitPh; res.klasse = kl;
      // Konservierung wie v1: sehr gut (keine Punkte) · normal (gut) · kritisch (leicht) · schlecht (stark/problematisch)
      res.gpsKons = kl.id === 'gut' ? (punkte === 0 ? 'sehr_gut' : 'normal') : kl.id === 'leicht' ? 'kritisch' : 'schlecht';
      if (kl.id === 'problem') sperre.push('Problematische Silage – Verfütterung kritisch prüfen.');
      if (ku && st) {
        const erwartet = addK(addK(Object.assign({}, ku.w), st.k), lg ? lg.k : null);
        res.basis = Object.assign({}, ku.w); res.erwartet = Object.assign({}, erwartet);
        const w = addK(addK(Object.assign({}, erwartet), ts ? GPS_TS[ts.tsWert < 30 ? 'lt30' : ts.tsWert > 40 ? 'gt40' : 'x'] : null), GPS_KONS[res.gpsKons]);
        if (sb && sb.k) ['nel', 'nev', 'apde', 'apdn'].forEach((m) => { if (w[m] != null && sb.k[m]) w[m] = w[m] * (1 + sb.k[m] / 100); });
        res.werte = w;
      }
      res.ziel = null;
    }

    if (typ.id === 'heu' || typ.id === 'gras' || typ.id === 'gruen') {
      const b = pickBasis(basis, probe);
      res.basis = b;
      if (b) {
        const w = Object.assign({}, b);
        ['nel', 'nev', 'apde', 'apdn'].forEach((m) => { if (b[m] != null) w[m] = b[m] * (1 + res.korr[m] / 100); });
        res.werte = w;
      } else if (a.bestand && a.stadium) {
        fehlend.push('Keine Tabellenwerte für diese Kombination');
      }
      if (typ.id === 'gruen') { res.ziel = null; res.zielErreicht = null; } else {
        const zielNel = typ.id === 'heu' ? 5.5 : 5.8;
        res.ziel = { nel: zielNel, rp: typ.id === 'heu' ? 140 : null };
        res.zielErreicht = res.werte ? (res.werte.nel >= zielNel && (typ.id !== 'heu' || res.werte.rp >= 140)) : null;
      }
    }

    if (typ.id === 'mais') {
      let punkte = 0; let mitPh = false;
      typ.rad.forEach((f) => {
        const o = sel[f.id] && findOpt(f, sel[f.id]);
        if (o && o.p != null) { punkte += o.p; if (f.ph) mitPh = true; }
      });
      res.punkte = punkte; res.mitPh = mitPh;
      const stufe = K3C_AUSGANG.find((s) => punkte <= s.max);
      res.klasse = { id: stufe.id, label: stufe.label, ton: stufe.ton };
      if (!stufe.w) sperre.push('Darf nicht verfüttert werden (Verordnung zur Hygiene bei der Milchproduktion).');
      // Bewertung Schritte 1–4
      res.schritte = K3C_SCHRITTE.map((s) => {
        const o = s.optionen.find((x) => x.id === a[s.id]);
        const r = s.id === 'koerner' ? k3cKoernerRating(a.koerner, a.ts) : (o ? o.r : null);
        if (!o) fehlend.push(s.titel);
        return { id: s.id, titel: s.titel, text: o ? (o.ts ? o.ts + ' – ' : '') + o.text : null, rating: r };
      });
      const korrIds = [];
      if (a.ts === 'lt30' || a.ts === '30') korrIds.push('ts_lt32');
      if (a.ts === '36' || a.ts === 'gt38') korrIds.push('ts_gt36');
      if (a.kolben === '45') korrIds.push('kolben_45');
      if (a.kolben === 'lt45') korrIds.push('kolben_lt45');
      if (a.hoch) korrIds.push('hoch');
      if (a.power) korrIds.push('power');
      if (!a.kolben) fehlend.push('Kolbenanteil');
      res.korrIds = korrIds;
      if (stufe.w) {
        res.basis = {}; res.werte = {};
        K3C_METRIKEN.forEach((m, i) => {
          const base = stufe.w[i];
          res.basis[m] = base;
          if (base == null) { res.werte[m] = null; return; }
          res.werte[m] = korrIds.reduce((v, id) => v + K3C_KORR[id].w[i], base);
        });
      }
      res.ziel = { nel: 6.4 };
      res.zielErreicht = res.werte ? res.klasse.id === 'gut' && a.ts === '32' && a.kolben === 'gt55' : null;
    }

    res.vollstaendig = fehlend.length === 0;
    return res;
  }

  /** Milchbildungspotenzial aus dem Grundfutter – wie v1 (Client): Agroscope-Bedarf, TS-Verzehr nach MB3. */
  const TSV_MB3 = { gruen1: [2.6, -0.3], gruenf: [2.35, 1.67], silage: [2.32, 1.86], heuf: [2.78, 0], heu: [2.87, -0.91] };
  function milchPotenzial(werte, opts) {
    if (!werte || !werte.nel || werte.apde == null) return null;
    const o = opts || {};
    const kg = Number(o.kuhGewicht) || 630;
    let tsv = Number(o.tsvBasis) > 0 ? Number(o.tsvBasis) : null;
    if (!tsv) {
      const key = o.typ === 'heu' ? (o.aufwuchs === 'f' ? 'heuf' : 'heu') : o.typ === 'gruen' ? (o.aufwuchs === 'f' ? 'gruenf' : 'gruen1') : 'silage';
      const [fa, fb] = TSV_MB3[key];
      tsv = Math.round(fa * werte.nel + fb);
    }
    const scale = Math.pow(kg / 630, 0.75);
    const mNel = 40.5 * scale; const mAp = 409 * scale;
    const nel = (werte.nel * tsv - mNel) / 3.14;
    const apde = (werte.apde * tsv - mAp) / 50;
    const apdn = (werte.apdn * tsv - mAp) / 50;
    const min = Math.min(nel, apde, apdn);
    const limit = min === nel ? 'NEL' : min === apde ? 'APDE' : 'APDN';
    return { tsv, nel, apde, apdn, mpp: Math.max(0, min), limit, kuhGewicht: kg };
  }

  /**
   * Mastpotenzial Muni aus dem Grundfutter allein – Agroscope, Grünes Buch Kap. 10 (Grossviehmast), Anhang 10.10.
   * Gesucht: höchster Tageszuwachs (g), den Energie (NEV) bzw. Protein (min. APDE/APDN) bei TS-Verzehr nach Formel decken.
   */
  const MAST = { LG_MIN: 125, LG_MAX: 550 };
  function mastNevBedarf(lg, tzw) {
    const ea = (4.453 + 0.01407 * lg) * tzw / (1000 - 0.30 * tzw);
    const q = 0.36 + 0.0002 * tzw;
    const k = (0.831 + 0.4305 * q) / (0.283 + 0.9235 * q);
    return 0.495 * Math.pow(lg, 0.75) + k * (ea - 0.165 * Math.pow(lg, 0.75));
  }
  const mastTsv = (lg, tzw) => 0.173 + 0.01372 * lg + 0.00147 * tzw;
  function mastApdBedarf(lg, tzw) {
    const a = -0.2704, b = 1.024, c = -5.433, d = 1.5352, h = 0.1541, t0 = 1220;
    const lgk = Math.exp(a + b * Math.log(lg));
    const tzwk = (lgk / lg) * b * tzw;
    const lip = Math.exp(c + d * Math.log(lgk));
    const fa = (Math.pow(tzwk, 1.78) * d * t0 * lip) / (Math.pow(t0, 1.78) * lgk);
    const pa = 1.06 * h * (tzwk - fa) * Math.pow(lgk - lip, 0.06);
    return 3.25 * Math.pow(lg, 0.75) + pa / 0.6;
  }
  function maxZuwachs(ueberschuss) {
    if (ueberschuss(0) < 0) return null; // deckt nicht einmal den Erhaltungsbedarf
    let lo = 0, hi = 2000;
    if (ueberschuss(hi) >= 0) return hi;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ueberschuss(m) >= 0) lo = m; else hi = m; }
    return lo;
  }
  function mastPotenzial(werte, opts) {
    if (!werte || !werte.nev || werte.apde == null || werte.apdn == null) return null;
    const lg = Math.max(MAST.LG_MIN, Math.min(MAST.LG_MAX, Number((opts || {}).lebendgewicht) || 400));
    const apd = Math.min(werte.apde, werte.apdn);
    const tzwE = maxZuwachs((t) => werte.nev * mastTsv(lg, t) - mastNevBedarf(lg, t));
    const tzwP = maxZuwachs((t) => apd * mastTsv(lg, t) - mastApdBedarf(lg, t));
    const tzw = tzwE == null || tzwP == null ? null : Math.min(tzwE, tzwP);
    const limit = tzwE == null ? 'NEV' : tzwP == null ? 'APD' : (tzwE <= tzwP ? 'NEV' : 'APD');
    return { lebendgewicht: lg, tzwE, tzwP, tzw, limit, apdQuelle: werte.apde <= werte.apdn ? 'APDE' : 'APDN', tsv: mastTsv(lg, tzw || 0) };
  }

  global.K3 = {
    BESTAENDE, BESTAND_PLAIN, STADIEN_ERSTER, REFERENZPFLANZEN, STADIEN_FOLGE_HINWEIS, stadiumFolge,
    TYPEN, K3B_SAUBERKEIT, K3B_TS, K3B_KLASSEN, K3C_SCHRITTE, K3C_KORR, K3C_AUSGANG, K3C_METRIKEN, METRIK_LABEL,
    phPunkteK3b, phPunkteK3c, k3bKlasse, k3cKoernerRating, radAuswahl, pickBasis, verfuegbareStadien,
    GPS_KULTUREN, GPS_STADIEN, GPS_LEGUM, auswerten, milchPotenzial, mastPotenzial, mastNevBedarf, mastApdBedarf, mastTsv, MAST,
  };
})(typeof window !== 'undefined' ? window : globalThis);
