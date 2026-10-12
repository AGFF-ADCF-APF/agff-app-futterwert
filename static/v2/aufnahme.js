/* Futter v2 – Wiesenaufnahme nach AGFF-Merkblatt 8 «Beurteilung von Wiesenbeständen» (3. Auflage 2012) mit Arbeitsblatt.
 * Ablauf wie im Merkblatt: 1 Pflanzenbestand aufnehmen und beurteilen · 2 Standort und bisherige Bewirtschaftung ·
 * 3 Angestrebte Bewirtschaftung und Zielbestand · 4 Bestandeslenkende Massnahmen.
 * Fachliche Grundlagen ausschliesslich aus MB 8 (Tabellen 1, 3, 4, Raigrasfähigkeit, Zielbestand) und MB 3 (Botanischer Typ).
 * Alles bleibt auf diesem Gerät (localStorage), Sicherung über «Daten».
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const esc = (s) => app().esc(s);
  const KEY = 'agffV2Aufnahmen';
  const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

  // ---------- Tabelle 1: Futterbauliche Bewertung (Gruppe, Name, Wert, botanischer Name) ----------
  const KAT = [
    { id: 'fg', t: 'Futtergräser', gruppe: 'g', wert: true },
    { id: 'gg', t: 'Geringwertige Gräser', gruppe: 'g' },
    { id: 'kl', t: 'Kleearten', gruppe: 'k', wert: true },
    { id: 'fk', t: 'Futterkräuter', gruppe: 'kr', wert: true },
    { id: 'gk', t: 'Geringwertige Kräuter', gruppe: 'kr' },
    { id: 'uk', t: 'Unkräuter/Giftpflanzen', gruppe: 'kr' },
  ];
  const KATI = Object.fromEntries(KAT.map((k) => [k.id, k]));
  const T1 = {
    fg: [['Englisches Raigras', 'Sehr wertvoll; ertrag- und energiereich; kann einen dichten Rasen bilden', 'Lolium perenne'], ['Fromental', 'In wenig intensiven Wiesen; Emd ist blattreich und wertvoll', 'Arrhenatherum elatius'],
      ['Goldhafer', 'Ab 10 % im Bestand nicht vor vollem Rispenschieben nutzen (Kalzinose)', 'Trisetum flavescens'], ['Italienisches Raigras', 'Sehr ertragreich; Blätter energiereich; in Weiden wenig geschätzt', 'Lolium multiflorum'],
      ['Kammgras', 'Wenig ertragreich; gehaltvolles Weidefutter; trittfest; für höhere Lagen', 'Cynosurus cristatus'], ['Knaulgras', 'Ertragreich; trockenheitsresistent; in Weiden wenig geschätzt', 'Dactylis glomerata'],
      ['Rotschwingel', 'In tiefen Lagen mittelwertig, Zuchtsorten und im Berggebiet wertvoll', 'Festuca rubra'], ['Timothe', 'Ertragreich; vielseitig verwendbar; auch wertvoll in intensiven Weiden', 'Phleum pratense'],
      ['Wiesenfuchsschwanz', 'Ertragreich auch in nicht raigrasfähigen Lagen; winterhart', 'Alopecurus pratensis'], ['Wiesenrispengras', 'Sehr wertvoll, besonders in Weiden; bildet dichte, trittfeste Grasnarbe', 'Poa pratensis'],
      ['Wiesenschwingel', 'Wertvoll zum Mähen und Beweiden; winterhart', 'Festuca pratensis']],
    gg: [['Ausläufer-Straussgras', 'Gräserfilz wird von Weidetieren verschmäht', 'Agrostis stolonifera'], ['Gewöhnliches Rispengras', 'Filzbildendes Gras, Lückenfüller; Ertrag nur im ersten Aufwuchs', 'Poa trivialis'],
      ['Hirse-Arten', 'Lückenfüller; vor der Blüte mittelwertig, später geringwertig; einjährig', 'Echinochloa/Setaria'], ['Quecke', 'Geringer Nährwert; von Weidetieren ungern gefressen', 'Agropyron repens'],
      ['Rohrschwingel', 'Wildformen haben sehr raue Blätter; wertvolle, feinblättrige Zuchtsorten', 'Festuca arundinacea'], ['Ruchgras', 'Ertragsarm; in wenig intensiven Wiesen und Weiden mittelwertig ¹', 'Anthoxanthum odoratum'],
      ['Weiche Trespe', 'Geringwertiges, von Weidetieren verschmähtes Futter; einjährig', 'Bromus hordeaceus'], ['Wolliges Honiggras', 'Geringer Nährwert, wird ungern gefressen ¹', 'Holcus lanatus']],
    kl: [['Luzerne', 'Ertrag- und proteinreich; trockenheitsresistent (tiefe Wurzel)', 'Medicago sativa'], ['Rotklee', 'Ertrag- und proteinreich; anpassungsfähig an Klima und Boden', 'Trifolium pratense'],
      ['Weissklee', 'Erträgt häufige Nutzung; protein- und energiereich; manchmal Blausäure', 'Trifolium repens']],
    fk: [['Frauenmantel', 'Reich an Ca und Mg; in kleinen Anteilen gerne gefressen', 'Alchemilla vulgaris'], ['Gewöhnliche Schafgarbe', 'Reich an P und Ca; in kleinen Anteilen gerne gefressen', 'Achillea millefolium'],
      ['Kohldistel', 'Junge Blätter werden gerne gefressen; Stängel sind schwer zu trocknen', 'Cirsium oleraceum'], ['Kriechender Hahnenfuss', 'Mittelwertig bis gut bis 20 % Bestandesanteil; verursacht lückige Bestände', 'Ranunculus repens'],
      ['Muttern', 'Im Alpgebiet; sehr wertvoll', 'Ligusticum mutellina'], ['Spitzwegerich', 'In Anteilen bis etwa 10 % wertvoll; schmackhaft in jungem Zustand', 'Plantago lanceolata'],
      ['Wiesen-Bärenklau', 'Blätter wertvoll; Bröckelverluste bei Heubereitung; Stängel geringwertig', 'Heracleum sphondylium'], ['Wiesen-Knöterich', 'In Anteilen bis 10 % mittelwertig bis wertvoll; reich an Mg und Gerbstoffen', 'Polygonum bistorta'],
      ['Wiesen-Kümmel', 'Gehaltreich; ätherische Öle hemmen Blähungen', 'Carum carvi'], ['Wiesen-Löwenzahn', 'Gehaltreich und schmackhaft; hohe Anteile reduzieren den Futterertrag', 'Taraxacum officinale']],
    gk: [['Baumtropfen, Geissfuss', 'Wässeriges, ungern gefressenes, geringwertiges Futter', 'Aegopodium podagraria'], ['Berg-Kerbel', 'Wässriges, nährstoffarmes Futter; Bröckelverluste; lückige Bestände', 'Chaerophyllum hirsutum'],
      ['Breitwegerich', 'Ertragslose Platzräuber; wird ungern gefressen', 'Plantago major'], ['Gänseblümchen', 'Ertragsschwach', 'Bellis perennis'],
      ['Grosse Brennnessel', 'Hoher Nährwert; wird in frischem Zustand jedoch nicht gefressen', 'Urtica dioica'], ['Rote Lichtnelke', 'Wertlos ¹', 'Silene dioica'],
      ['Sauerampfer', 'Rohfaserreiche, grobe Stängel; reich an Kaliumoxalat und Gerbstoffen', 'Rumex acetosa'], ['Scharfer Hahnenfuss', 'Mässig giftig in frischem Zustand: für Weiden und Eingrasen = Unkraut', 'Ranunculus friesianus'],
      ['Wald-Storchschnabel', 'Geringer Nährwert, wird ungern gefressen; Bröckelverluste', 'Geranium sylvaticum'], ['Wallwurz', 'Schwach giftig', 'Symphytum officinale'],
      ['Wiesen-Kerbel', 'Blätter mittelwertig, wertlose, grobe Stängel; Bröckelverluste', 'Anthriscus sylvestris'], ['Wiesen-Pippau', 'Blätter mittelwertig; grobe Stängel geringwertig ¹', 'Crepis biennis']],
    uk: [['Acker-Kratzdistel', 'Vermehrung durch Samen und Seitenwurzeln; Bekämpfung aufwendig', 'Cirsium arvense'], ['Adlerfarn', 'Stark giftig', 'Pteridium aquilinum'],
      ['Alpen-Blacke', 'Kann sich stark vermehren; wertlos', 'Rumex alpinus'], ['Alpen-Kreuzkraut', 'Stark giftig', 'Senecio alpinus'], ['Binsen', 'Als Futter wertlos bis gesundheitsschädlich', 'Juncus sp.'],
      ['Fadenförmiger Ehrenpreis', 'Wertlos; kann sich stark vermehren', 'Veronica filiformis'], ['Feigwurz, Scharbockskraut', 'Leicht giftig; wird von Weidetieren verschmäht', 'Ranunculus ficaria'],
      ['Herbst-Zeitlose', 'Stark giftig ¹', 'Colchicum autumnale'], ['Jakobs-Kreuzkraut', 'Stark giftig', 'Senecio jacobaea'], ['Sumpf-Schachtelhalm', 'Stark giftig', 'Equisetum palustre'],
      ['Wasser-Kreuzkraut', 'Stark giftig', 'Senecio aquaticus'], ['Weisser Germer', 'Stark giftig', 'Veratrum album'], ['Wiesen-Blacke', 'Wertloser Platzräuber; kann sich stark vermehren', 'Rumex obtusifolius']],
  };
  const FUSS1 = '¹ Bewertung gilt nicht für extensiv und wenig intensiv bewirtschaftete Wiesen und Weiden.';
  // ---------- Tabelle 3 (zurückdrängen, Zeiger für) und Tabelle 4 (fördern, Zeiger für) ----------
  const T3 = {
    'Ausläufer-Straussgras': ['Bodenschonende, weniger intensive Nutzung; Umtriebs- statt Standweide', 'Verdichtung, Übernutzung'],
    'Gewöhnliches Rispengras': ['Übersaaten in Verbindung mit mechanischem Aufreissen des Filzes', 'Lücken'],
    'Hirse-Arten': ['Übersaaten im Frühling; weniger düngen und nutzen', 'Lücken'],
    'Quecke': ['Öfters Mähen, sofort nach dem Ährenschieben; weniger düngen', 'Nährstoffreich'],
    'Rohrschwingel': ['Bodenschonende, intensive Nutzung; regelmässige Weidepflege', 'Ungepflegte Dauerweide'],
    'Ruchgras': ['Intensivere Bewirtschaftung', 'Eher nährstoffarm'],
    'Weiche Trespe': ['Lücken vermeiden, Samenständer in grünem Zustand abführen', 'Lücken'],
    'Wolliges Honiggras': ['Beweiden im Frühling; Mähen vor dem Blühen; regelmässiges Düngen', 'Späte Nutzung'],
    'Baumtropfen, Geissfuss': ['Beweiden im Frühling; weniger düngen', 'Überdüngung'],
    'Berg-Kerbel': ['Weniger düngen; beweiden im Frühling in Verbindung mit Übersaaten', 'Überdüngung'],
    'Breitwegerich': ['Bodenschonende Bewirtschaftung in Kombination mit Mähweide', 'Bodenverdichtung'],
    'Gänseblümchen': ['Weniger nutzen; geregelte Umtriebsweide oder Mähweidenutzung', 'Übernutzung'],
    'Grosse Brennnessel': ['Weidepflege; Ansammlung von Ausscheidungen vermeiden', 'Nährstoffreich'],
    'Rote Lichtnelke': ['Beweiden im Frühling; zurückhaltende Düngung', 'Nährstoffreich, Lücken'],
    'Sauerampfer': ['Beweiden im Frühling; gelegentlich früh mähen', 'Späte Nutzung'],
    'Scharfer Hahnenfuss': ['Beweiden im Frühling; Weidereste mähen; weniger Gülle', 'Nährstoffreich'],
    'Wald-Storchschnabel': ['Weniger düngen; beweiden im Frühling', 'Überdüngung'],
    'Wallwurz': ['Ausstechen', 'Nährstoffreich'],
    'Wiesen-Bärenklau': ['Weniger düngen; beweiden im Frühling in Verbindung mit Übersaaten', 'Überdüngung'],
    'Wiesen-Kerbel': ['Weniger düngen; beweiden im Frühling in Verbindung mit Übersaaten', 'Überdüngung'],
    'Wiesen-Pippau': ['Beweiden im Frühling; häufigere Nutzung', 'Späte Nutzung'],
    'Acker-Kratzdistel': ['Dichte Grasnarbe fördern; einmal etabliert direkte Bekämpfung nötig', 'Lücken, nährstoffreich'],
    'Adlerfarn': ['2-maliges Mähen: erstmals bei 30–40 cm Höhe und nochmals im Sommer', 'Eher nährstoffarm'],
    'Alpen-Blacke': ['Ansammlung von Ausscheidungen vermeiden; ausgraben, Übersaaten', 'Überdüngung'],
    'Alpen-Kreuzkraut': ['Ansammlung von Ausscheidungen vermeiden; Ausstechen', 'Überdüngung'],
    'Binsen': ['Nasse Stellen als Streue nutzen; Umtriebsweide und Weideputzen', 'Feuchtigkeit'],
    'Fadenförmiger Ehrenpreis': ['Weniger häufig nutzen; geregelte Umtriebsweide oder Mähweidenutzung', 'Lücken, Übernutzung'],
    'Feigwurz, Scharbockskraut': ['Weniger düngen; Übersaaten', 'Lücken, nährstoffreich'],
    'Herbst-Zeitlose': ['Kurze Frühlingsweide (2–3 Tage) mit Kühen, Weideputzen; Intensivieren', 'Späte Nutzung'],
    'Jakobs-Kreuzkraut': ['Dichte Grasnarbe fördern; Weidepflege oder regelmässiger Schnitt', 'Lücken, eher nährstoffarm'],
    'Sumpf-Schachtelhalm': ['Regelmässiges Weideputzen; nasse Stellen als Streue nutzen', 'Feuchtigkeit'],
    'Weisser Germer': ['Während 2–3 Jahren 1–2 Mal mähen bei 30 cm Höhe der Pflanzen', 'Nährstoffreich'],
    'Wiesen-Blacke': ['Dichte Grasnarbe fördern; Bildung von Samen verhindern', 'Lücken, nährstoffreich'],
  };
  const T4 = {
    'Englisches Raigras': ['Beweiden im Frühling, häufige Nutzung und starke Düngung', 'Nährstoffreich'],
    'Fromental': ['Wenig intensive Schnittnutzung kombiniert mit leichter Düngung', 'Späte Nutzung'],
    'Goldhafer': ['Wenig intensive Schnittnutzung kombiniert mit leichter Düngung', 'Späte Nutzung'],
    'Italienisches Raigras': ['Schnittnutzung von höchstens 5 Schnitten jährlich; gelegentliche Versamung', 'Nährstoffreich'],
    'Kammgras': ['Gelegentliche Versamung; Beweiden', 'Mittlere Verhältnisse'],
    'Knaulgras': ['Gelegentliche Versamung; mittelintensive Nutzung mit starker Düngung', 'Nährstoffreich'],
    'Rotschwingel': ['Mässige Nutzungshäufigkeit und Düngung; nicht zu tiefer Schnitt', 'Eher nährstoffarm'],
    'Timothe': ['Mässige Nutzungshäufigkeit und Düngung; gelegentliche Versamung', 'Frisch bis feucht'],
    'Wiesenfuchsschwanz': ['Starke Düngung; häufige Nutzung mit gelegentlicher Versamung', 'Frisch-feucht, Nährstoffe'],
    'Wiesenrispengras': ['Beweiden im Frühling, häufige Nutzung und starke Düngung', 'Nährstoffreich'],
    'Wiesenschwingel': ['Mässige Nutzungshäufigkeit und Düngung', 'Frisch bis feucht'],
    'Luzerne': ['3 oder 4 Schnitte pro Jahr; nie zu tief mähen; geringe N-Düngung', 'Trocken, Boden kalkhaltig'],
    'Rotklee': ['Mittelspäte, mässig häufige, nicht zu tiefe Nutzung; geringe N-Düngung', 'Mittlere Verhältnisse'],
    'Weissklee': ['Frühzeitiges, häufiges und tiefes Beweiden und Mähen', 'Übernutzung'],
  };
  // Namen aus «Pflanzen bestimmen», die in Tabelle 1 anders heissen
  const ALIAS = { 'Gemeines Rispengras': 'Gewöhnliches Rispengras', 'Wiesenrispe': 'Wiesenrispengras', 'Löwenzahn': 'Wiesen-Löwenzahn', 'Schafgarbe': 'Gewöhnliche Schafgarbe', 'Wiesenbärenklau': 'Wiesen-Bärenklau',
    'Wiesenkerbel': 'Wiesen-Kerbel', 'Blacke': 'Wiesen-Blacke', 'Stumpfblättriger Ampfer': 'Wiesen-Blacke', 'Grosse Brennessel': 'Grosse Brennnessel', 'Herbstzeitlose': 'Herbst-Zeitlose', 'Jakobskreuzkraut': 'Jakobs-Kreuzkraut',
    'Sumpfschachtelhalm': 'Sumpf-Schachtelhalm', 'Weisses Straussgras': 'Ausläufer-Straussgras' };
  const katVon = (n) => { for (const k of Object.keys(T1)) if (T1[k].some((x) => x[0] === n)) return k; return null; };
  const t1Info = (n) => { for (const k of Object.keys(T1)) { const x = T1[k].find((y) => y[0] === n); if (x) return x; } return null; };

  // ---------- Auswahlfelder des Arbeitsblatts ----------
  const W = {
    typ: [['G', 'G/GR'], ['A', 'A/AR'], ['L', 'L'], ['K', 'KF/KG']],
    stufe4: ['keine', 'gering', 'mittel', 'stark'],
    note4: ['sehr gut', 'gut', 'mässig', 'schlecht'],
    wasser: ['trocken', 'frisch (mittel)', 'feucht', 'nass'],
    boden: ['leicht, sandig', 'mittelschwer, lehmig', 'mittelschwer, schluffig', 'schwer, tonig'],
    gruendig: ['flachgründig', 'mässig tiefgründig', 'tiefgründig'],
    naehrstoff: ['mager', 'etwas mager', 'in Ordnung', 'übertrieben'],
    neigung: ['sehr steil', 'steil', 'leicht geneigt', 'flach'],
    exposition: ['Süd', 'Ost', 'Nord', 'West'],
    raigras: ['schlecht', 'mässig', 'gut', 'sehr gut'],
    potenzial: ['tief', 'mässig', 'gut', 'sehr gut'],
    intensitaet: ['extensiv', 'wenig intensiv', 'mittelintensiv', 'intensiv'],
    duengung: ['keine', 'wenig', 'mittel', 'intensiv'],
    nutzung: ['Schnitt', 'v. a. Schnitt', 'v. a. Weide', 'Weide'],
    verwertung: ['v. a. Eingrasen', 'v. a. Silage', 'v. a. Heu'],
  };
  const STADIEN = ['Bestockung', 'Schossen', 'Beginn Rispenschieben', 'Volles Rispenschieben', 'Ende Rispenschieben', 'Blüte', 'Samenreife'];

  // ---------- Speicher ----------
  function laden() { try { const z = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(z) ? z.map(clean).filter(Boolean) : []; } catch (e) { return []; } }
  function speichern(L) { try { localStorage.setItem(KEY, JSON.stringify(L)); if (global.Konto) global.Konto.geaendert('wiese'); return true; } catch (e) { app().toast('Speichern im Browser nicht möglich.'); return false; } }
  const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, n) : undefined);
  const pz = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : undefined);
  const zahl = (v, a, b) => (typeof v === 'number' && isFinite(v) && v >= a && v <= b ? v : undefined);
  const wahl = (v, liste) => (typeof v === 'string' && liste.some((x) => (Array.isArray(x) ? x[0] : x) === v) ? v : undefined);
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  /** Prüft eine Aufnahme (auch aus Sicherungen): nur bekannte Felder, begrenzte Längen. */
  function clean(a) {
    if (!a || typeof a !== 'object' || !ID_RE.test(a.id || '')) return null;
    const k = obj(a.kopf); const b = obj(a.beurteilung); const s = obj(a.standort); const bi = obj(a.bisher); const z = obj(a.ziel); const m = obj(a.massnahmen);
    const kreis = (x) => { x = obj(x); return { g: pz(x.g), k: pz(x.k), kr: pz(x.kr) }; };
    return {
      id: a.id, createdAt: str(a.createdAt, 40) || new Date().toISOString(), updatedAt: str(a.updatedAt, 40) || new Date().toISOString(),
      kopf: { ort: str(k.ort, 120) || '', parzelle: str(k.parzelle, 120) || '', hoehe: zahl(k.hoehe, 0, 4000), datum: str(k.datum, 10) || '', stadium: str(k.stadium, 80) || '', aufwuchs: zahl(k.aufwuchs, 1, 8),
        lat: zahl(k.lat, -90, 90), lon: zahl(k.lon, -180, 180), fotopunkt: typeof k.fotopunkt === 'string' && ID_RE.test(k.fotopunkt) ? k.fotopunkt : undefined },
      kreise: [kreis((a.kreise || [])[0]), kreis((a.kreise || [])[1])], luecken: pz(a.luecken),
      rasterKf: zahl(a.rasterKf, 0, 1), rasterKg: zahl(a.rasterKg, 0, 1),
      arten: (Array.isArray(a.arten) ? a.arten : []).slice(0, 80).map((x) => ({ n: str(obj(x).n, 80), kat: wahl(obj(x).kat, KAT.map((c) => c.id)), p: pz(obj(x).p) || 0 })).filter((x) => x.n && x.kat),
      beurteilung: { typ: wahl(b.typ, W.typ), verunkrautung: wahl(b.verunkrautung, W.stufe4), verfilzung: wahl(b.verfilzung, W.stufe4), silage: wahl(b.silage, W.note4), duerr: wahl(b.duerr, W.note4), weide: wahl(b.weide, W.note4),
        ertrag: zahl(b.ertrag, 0, 400), bemerkung: str(b.bemerkung, 2000) || '', zeigerNotiz: str(b.zeigerNotiz, 2000) || '' },
      standort: { wasser: wahl(s.wasser, W.wasser), boden: wahl(s.boden, W.boden), gruendig: wahl(s.gruendig, W.gruendig), naehrstoff: wahl(s.naehrstoff, W.naehrstoff), neigung: wahl(s.neigung, W.neigung),
        exposition: wahl(s.exposition, W.exposition), raigras: wahl(s.raigras, W.raigras), potenzial: wahl(s.potenzial, W.potenzial), bemerkung: str(s.bemerkung, 2000) || '' },
      bisher: { intensitaet: wahl(bi.intensitaet, W.intensitaet), duengung: wahl(bi.duengung, W.duengung), nutzung: wahl(bi.nutzung, W.nutzung), verwertung: wahl(bi.verwertung, W.verwertung), pflege: str(bi.pflege, 1000) || '' },
      ziel: { intensitaet: wahl(z.intensitaet, W.intensitaet), nutzung: wahl(z.nutzung, W.nutzung), verwertung: wahl(z.verwertung, W.verwertung), wiesentyp: str(z.wiesentyp, 200) || '',
        leitgraeser: (Array.isArray(z.leitgraeser) ? z.leitgraeser : []).filter((n) => T1.fg.some((x) => x[0] === n)).slice(0, 11),
        foerdern: (Array.isArray(z.foerdern) ? z.foerdern : []).filter((n) => T4[n]).slice(0, 20), zurueck: (Array.isArray(z.zurueck) ? z.zurueck : []).filter((n) => typeof n === 'string' && n.length <= 80).slice(0, 40),
        foerderText: str(z.foerderText, 2000) || '', zurueckText: str(z.zurueckText, 2000) || '' },
      massnahmen: { kurz: str(m.kurz, 4000) || '', lang: str(m.lang, 4000) || '' },
    };
  }
  let L = laden();
  const byId = (id) => L.find((a) => a.id === id);
  function sichern(a) { a.updatedAt = new Date().toISOString(); speichern(L); }

  // ---------- Auswertung ----------
  const mittel = (a, f) => { const v = a.kreise.map((k) => k[f]).filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length / 5) * 5 : null; };
  function auswerten(a) {
    const sum = (kat) => a.arten.filter((x) => x.kat === kat).reduce((s, x) => s + x.p, 0);
    const kat = Object.fromEntries(KAT.map((k) => [k.id, sum(k.id)]));
    const g = mittel(a, 'g'); const kl = mittel(a, 'k'); const kr = mittel(a, 'kr');
    const artenSumme = KAT.reduce((s, k) => s + kat[k.id], 0);
    // Futtergräser: aus der Artenliste, sonst unbekannt
    const fg = artenSumme ? kat.fg : null;
    const fgKlasse = fg == null ? null : fg > 50 ? '> 50%' : fg >= 30 ? '30–50%' : fg >= 15 ? '15–30%' : '< 15%';
    const lkl = a.luecken == null ? null : a.luecken < 5 ? '< 5%' : a.luecken < 25 ? '< 25%' : a.luecken <= 50 ? '25–50%' : '> 50%';
    // Botanischer Typ (MB 3): Gräser > 70 % → G/GR, 50–70 % → A/AR, sonst die Gruppe über 50 %
    const gr = g != null ? g : (artenSumme ? kat.fg + kat.gg : null); const kle = kl != null ? kl : (artenSumme ? kat.kl : null); const kra = kr != null ? kr : (artenSumme ? kat.fk + kat.gk + kat.uk : null);
    let typ = null; let typText = '';
    if (gr != null && kle != null && kra != null && gr + kle + kra > 0) {
      const tot = gr + kle + kra; const G = gr / tot * 100;
      const rg = a.arten.filter((x) => /Raigras$/.test(x.n)).reduce((s, x) => s + x.p, 0); const grArten = kat.fg + kat.gg;
      const rgAnteil = grArten ? rg / grArten : null;
      if (G > 70) { typ = 'G'; typText = rgAnteil != null ? (rgAnteil > 0.5 ? 'GR (Raigras über die Hälfte der Gräser)' : 'G') : 'G oder GR'; }
      else if (G >= 50) { typ = 'A'; typText = rgAnteil != null ? (rgAnteil > 0.5 ? 'AR (Raigras über die Hälfte der Gräser)' : 'A') : 'A oder AR'; }
      else if (kle / tot > 0.5 || (kra / tot <= 0.5 && kle >= kra)) { typ = 'L'; typText = 'L'; }
      else { typ = 'K'; const fein = artenSumme ? kat.fk : (a.rasterKf != null ? a.rasterKf : null); const grob = artenSumme ? kat.gk + kat.uk : (a.rasterKg != null ? a.rasterKg : null); typText = fein != null && grob != null && fein + grob > 0 ? (fein >= grob ? 'KF' : 'KG') : 'KF oder KG'; }
      if (G < 50 && kle / tot <= 0.5 && kra / tot <= 0.5) typText += ' (keine Gruppe über 50 % – nächstliegender Typ)';
    }
    return { kat, artenSumme, g, kl, kr, fg, fgKlasse, lkl, typ, typText, unkraut: artenSumme ? kat.uk : null, wertvoll: artenSumme ? kat.fg + kat.kl + kat.fk : null };
  }
  /** Raigrasfähigkeit (MB 8, Abschnitt 2): Höhenlage und weitere Bedingungen */
  function raigrasHinweis(a) {
    const h = a.kopf.hoehe; const s = a.standort; const t = [];
    let v = null;
    if (h != null) {
      if (h <= 700) { v = 'gut'; t.push('Höhe ' + h + ' m: auch in rauen Lagen raigrasfähig (bis 700 m).'); }
      else if (h <= 900) { v = 'mässig'; t.push('Höhe ' + h + ' m: nur in milden Lagen raigrasfähig (bis 900 m), rauhe Lagen nur bis 700 m.'); }
      else if (h <= 1000) { v = 'mässig'; t.push('Höhe ' + h + ' m: nur Englisches Raigras und nur in milden Lagen (bis 1000 m).'); }
      else { v = 'schlecht'; t.push('Höhe ' + h + ' m: über 1000 m nicht raigrasfähig.'); }
    }
    if (s.wasser === 'trocken' || s.wasser === 'nass') { t.push('Wasserhaushalt «' + s.wasser + '»: raigrasfähig sind normal durchlässige Böden bei 900–1200 mm Niederschlag.'); if (v) v = v === 'gut' ? 'mässig' : 'schlecht'; }
    if (s.boden === 'leicht, sandig' || s.boden === 'schwer, tonig') t.push('Raigras braucht mittelschwere Böden mit krümeligem Oberboden, ohne Verdichtungen.');
    if (s.naehrstoff === 'mager') t.push('Raigras braucht P und K «mässig» bis «genügend» und regelmässige leichte N-Gaben.');
    if (s.exposition === 'Nord') t.push('Raigrasfähige Lagen sind mild, sonnig und früh schneefrei.');
    return { v, t };
  }

  // ---------- Darstellung ----------
  const seg = (pfad, liste, wert) => '<div class="seg au-seg">' + liste.map((x) => { const v = Array.isArray(x) ? x[0] : x; const t = Array.isArray(x) ? x[1] : x; return '<button type="button" data-au="setze" data-pfad="' + pfad + '" data-val="' + esc(v) + '" aria-pressed="' + (wert === v) + '">' + esc(t) + '</button>'; }).join('') + '</div>';
  const zeile = (titel, inhalt, hint) => '<div class="au-zeile"><div class="au-z-t">' + titel + (hint ? '<span class="small muted">' + hint + '</span>' : '') + '</div><div class="au-z-i">' + inhalt + '</div></div>';
  const feld = (pfad, wert, opts) => '<input class="input" data-auf="' + pfad + '" value="' + esc(wert == null ? '' : wert) + '"' + (opts || '') + '>';
  const text = (pfad, wert, ph) => '<textarea class="input" data-auf="' + pfad + '" rows="2" placeholder="' + esc(ph || '') + '">' + esc(wert || '') + '</textarea>';
  const stepper = (pfad, wert, label) => '<span class="au-step"><button type="button" class="btn sm" data-au="plus" data-pfad="' + pfad + '" data-d="-5" aria-label="' + label + ' minus 5">−</button><b>' + (wert == null ? '–' : wert + ' %') + '</b><button type="button" class="btn sm" data-au="plus" data-pfad="' + pfad + '" data-d="5" aria-label="' + label + ' plus 5">+</button></span>';
  const datum = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
  const titelVon = (a) => a.kopf.parzelle || a.kopf.ort || 'Wiesenaufnahme';

  function renderListe(r) {
    L = laden();
    const s = L.slice().sort((x, y) => ((y.kopf.datum || y.createdAt) > (x.kopf.datum || x.createdAt) ? 1 : -1));
    return '<div class="bar"><h2>Wiesenaufnahmen<span class="sub">' + (L.length ? L.length + ' Aufnahmen' : 'noch keine') + '</span></h2><button class="icon-btn" data-au="neu" aria-label="Neue Wiesenaufnahme">' + app().I.plus + '</button></div>' +
      '<ul class="list" style="padding:8px">' + (s.length ? s.map((a) => { const e = auswerten(a); return '<li><a class="item" href="#/aufnahmen/' + a.id + '" aria-current="' + (r && r.id === a.id) + '"><span class="avatar" style="background:var(--surface-2);color:var(--ink-2)">' + (e.typ ? esc(e.typ) : '🌾') + '</span><span style="min-width:0"><span class="t">' + esc(titelVon(a)) + '</span><span class="s">' + esc([datum(a.kopf.datum), a.kopf.ort && a.kopf.parzelle ? a.kopf.ort : '', e.g != null ? 'G ' + e.g + ' · K ' + e.kl + ' · Kr ' + e.kr + ' %' : ''].filter(Boolean).join(' · ')) + '</span></span></a></li>'; }).join('')
        : '<li class="empty small">Wiesenbestand nach AGFF-Merkblatt 8 aufnehmen, beurteilen und Massnahmen ableiten.</li>') + '</ul>';
  }

  function render(id) {
    L = laden();
    const a = id && byId(id);
    if (!a) return uebersicht();
    const e = auswerten(a); const k = a.kopf;
    const nav = [['au-1', '1 Bestand'], ['au-2', '2 Standort'], ['au-3', '3 Ziel'], ['au-4', '4 Massnahmen']].map(([h, t]) => '<a class="btn sm ghost" href="#/aufnahmen/' + a.id + '" data-au="springe" data-ziel="' + h + '">' + t + '</a>').join('');
    const frueher = L.filter((x) => x.id !== a.id && a.kopf.parzelle && x.kopf.parzelle.trim().toLowerCase() === a.kopf.parzelle.trim().toLowerCase()).sort((x, y) => ((x.kopf.datum || '') < (y.kopf.datum || '') ? -1 : 1));
    const fp = global.Wiese && global.Wiese.fotopunkte ? global.Wiese.fotopunkte() : [];
    return '<div class="bar"><a class="icon-btn" href="#/aufnahmen" aria-label="Zurück">' + app().I.back + '</a><h2>' + esc(titelVon(a)) + '<span class="sub">Wiesenaufnahme · AGFF-Merkblatt 8' + (k.datum ? ' · ' + datum(k.datum) : '') + '</span></h2>' +
      '<button class="icon-btn" data-au="pdf" data-id="' + a.id + '" aria-label="Arbeitsblatt als PDF">' + app().I.pdf + '</button></div><div class="pad aufnahme" data-aufnahme="' + a.id + '">' +
      '<div class="au-nav">' + nav + '</div>' +
      // Kopf
      '<section class="q"><h3>Angaben</h3><div class="grid2">' +
      '<label class="field"><span>Ort</span>' + feld('kopf.ort', k.ort, ' maxlength="120" placeholder="z. B. Hof Moos, Bärau"') + '</label>' +
      '<label class="field"><span>Parzelle</span>' + feld('kopf.parzelle', k.parzelle, ' maxlength="120" placeholder="z. B. Hausmatte"') + '</label>' +
      '<label class="field"><span>Höhe ü. M. (m)</span>' + feld('kopf.hoehe', k.hoehe, ' type="number" min="0" max="4000" inputmode="numeric"') + '</label>' +
      '<label class="field"><span>Datum</span>' + feld('kopf.datum', k.datum, ' type="date"') + '</label>' +
      '<label class="field"><span>Entwicklungsstadium</span>' + feld('kopf.stadium', k.stadium, ' list="auStadien" maxlength="80"') + '<datalist id="auStadien">' + STADIEN.map((s) => '<option value="' + s + '">').join('') + '</datalist></label>' +
      '<label class="field"><span>Aufwuchs-Nr.</span>' + feld('kopf.aufwuchs', k.aufwuchs, ' type="number" min="1" max="8" inputmode="numeric"') + '</label></div>' +
      '<div class="row" style="margin-top:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-au="gps">' + (k.lat != null ? '📍 Standort ' + k.lat.toFixed(4) + ', ' + k.lon.toFixed(4) + ' (neu setzen)' : '📍 Standort (GPS) speichern') + '</button>' +
      '<button type="button" class="btn sm" data-wi="stadium">Stadium mit Kamera</button>' +
      (fp.length ? '<label class="field" style="min-width:180px;flex:1"><span class="small">Fotopunkt verknüpfen</span><select class="input" data-auf="kopf.fotopunkt"><option value="">–</option>' + fp.map((p) => '<option value="' + p.id + '"' + (k.fotopunkt === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' : '<a class="btn sm ghost" href="#/fotopunkte">Fotopunkt anlegen</a>') +
      (k.fotopunkt && fp.some((p) => p.id === k.fotopunkt) ? '<a class="btn sm ghost" href="#/fotopunkte/' + k.fotopunkt + '">Zum Fotopunkt</a>' : '') + '</div>' +
      '<p class="hint">Fläche von ca. einer Are wählen, die dem Grossteil der Parzelle entspricht (gleich bewirtschaftet, gleichmässige Eigenschaften).</p></section>' +
      (frueher.length ? '<section class="q"><h3>Frühere Aufnahmen dieser Parzelle</h3><table class="wi-tab au-vergleich"><tr><th>Datum</th><th>Gräser</th><th>Klee</th><th>Kräuter</th><th>Futtergr.</th><th>Lücken</th><th>Typ</th></tr>' +
        frueher.concat([a]).map((x) => { const v = auswerten(x); const f = (n) => (n == null ? '–' : n + ' %'); return '<tr' + (x.id === a.id ? ' class="au-jetzt"' : '') + '><td>' + (x.id === a.id ? 'jetzt' : '<a href="#/aufnahmen/' + x.id + '">' + esc(datum(x.kopf.datum) || '?') + '</a>') + '</td><td>' + f(v.g) + '</td><td>' + f(v.kl) + '</td><td>' + f(v.kr) + '</td><td>' + f(v.fg) + '</td><td>' + f(x.luecken) + '</td><td>' + esc(v.typ ? v.typText.split(' ')[0] : '–') + '</td></tr>'; }).join('') + '</table></section>' : '') +
      teil1(a, e) + teil2(a) + teil3(a, e) + teil4(a, e) +
      '<div class="row" style="margin-top:14px"><button class="btn grow" data-au="pdf" data-id="' + a.id + '">' + app().I.pdf + ' Arbeitsblatt als PDF</button><button class="btn grow" data-au="kopie" data-id="' + a.id + '">Folgeaufnahme (Kopie)</button><button class="btn danger" data-au="loeschen" data-id="' + a.id + '">Löschen</button></div>' +
      '<p class="hint">Nach AGFF-Merkblatt 8 «Beurteilung von Wiesenbeständen» (2012) mit Arbeitsblatt; Botanischer Typ nach Merkblatt 3. Gespeichert nur auf diesem Gerät (Sicherung unter «Daten»).</p></div>';
  }

  function uebersicht() {
    const n = L.length;
    return '<div class="bar"><a class="icon-btn" href="#/wiese" aria-label="Zurück">' + app().I.back + '</a><h2>Wiesenaufnahme<span class="sub">Nach AGFF-Merkblatt 8</span></h2></div><div class="pad aufnahme">' +
      '<button class="btn primary block" data-au="neu">' + app().I.plus + ' Neue Wiesenaufnahme</button>' +
      '<ol class="au-weg"><li><b>Pflanzenbestand aufnehmen und beurteilen</b><span>Gräser, Klee, Kräuter schätzen (5-m-Kreis, zweimal), Arten und Ertragsanteile, Lücken; Zeigerpflanzen.</span></li>' +
      '<li><b>Standort und bisherige Bewirtschaftung</b><span>Wasserhaushalt, Boden, Nährstoffe, Lage – mit Hilfe zur Raigrasfähigkeit.</span></li>' +
      '<li><b>Angestrebte Bewirtschaftung und Zielbestand</b><span>Meistens 50–70 % Futtergräser, 10–30 % Klee, 10–30 % Futterkräuter; Leitgräser, fördern, zurückdrängen.</span></li>' +
      '<li><b>Bestandeslenkende Massnahmen</b><span>Kurzfristig (Sanierung, Übersaat) und langfristig (Nutzung, Düngung, Pflege) – mit Vorschlägen aus den Tabellen des Merkblatts.</span></li></ol>' +
      (n ? '<p class="small muted">' + n + ' gespeicherte Aufnahme' + (n === 1 ? '' : 'n') + ' – in der Liste wählen.</p>' : '') +
      '<p class="hint">Hilfsmittel: Punktraster (Kamera) für Gräser/Klee/Kräuter und Lücken, «Pflanzen bestimmen» für die Arten, Fotopunkte für den Vergleich über die Jahre, Messkarte (Rückseite: 5-m-Kreis, Bestimmungsschablonen).</p></div>';
  }

  function teil1(a, e) {
    const kr = (i) => { const x = a.kreise[i]; return '<div class="au-kreis"><b>Kreis ' + (i + 1) + '</b>' + zeile('Gräser', stepper('kreise.' + i + '.g', x.g, 'Gräser Kreis ' + (i + 1))) + zeile('Klee', stepper('kreise.' + i + '.k', x.k, 'Klee Kreis ' + (i + 1))) + zeile('Kräuter', stepper('kreise.' + i + '.kr', x.kr, 'Kräuter Kreis ' + (i + 1))) +
      '<div class="small ' + (x.g != null && x.k != null && x.kr != null && x.g + x.k + x.kr !== 100 ? 'au-warn' : 'muted') + '">Summe ' + ((x.g || 0) + (x.k || 0) + (x.kr || 0)) + ' %</div><button type="button" class="btn sm ghost" data-au="raster" data-kreis="' + i + '">' + app().I.camera + ' Punktraster</button></div>'; };
    const artenKat = (c) => {
      const liste = a.arten.map((x, i) => Object.assign({ i }, x)).filter((x) => x.kat === c.id);
      const sum = e.kat[c.id];
      return '<div class="au-kat"><div class="au-kat-kopf"><b>' + c.t + '</b><span class="muted small">Total ' + sum + ' %</span></div>' +
        liste.map((x) => { const t3 = T3[x.n]; const t4 = T4[x.n]; const info = t1Info(x.n); return '<div class="au-art"><span class="au-art-n" title="' + esc(info ? info[1] : '') + '">' + esc(x.n) + (t3 || t4 ? ' <span class="chip au-zeiger" title="Zeiger für: ' + esc((t3 || t4)[1]) + '">Zeiger</span>' : '') + '</span>' + stepper('arten.' + x.i + '.p', x.p, x.n) + '<button type="button" class="icon-btn au-weg-btn" data-au="art-weg" data-i="' + x.i + '" aria-label="' + esc(x.n) + ' entfernen">×</button></div>'; }).join('') +
        '<button type="button" class="btn sm ghost" data-au="art-neu" data-kat="' + c.id + '">' + app().I.plus + ' Art</button></div>';
    };
    const gesamt = e.artenSumme;
    const vgl = (n, soll) => (soll == null || !gesamt ? '' : Math.abs(n - soll) > 5 ? ' <span class="au-warn">(Kreise: ' + soll + ' %)</span>' : ' <span class="muted">✓</span>');
    const zeiger = a.arten.filter((x) => x.p >= 5 && (T3[x.n] || T4[x.n]));
    const b = a.beurteilung;
    return '<section class="q" id="au-1"><h3>1.1 Aufnahme des Pflanzenbestandes</h3>' +
      '<p class="qhint">Erst Gräser, Klee und Kräuter schätzen, dann die Arten, zuletzt den Ertragsanteil der Einzelarten (% TS, 5-%-Schritte). Kreis von ca. 5 m Durchmesser abtreten, gedanklich vierteln und halbieren; an einer zweiten Stelle wiederholen.</p>' +
      '<div class="au-kreise">' + kr(0) + kr(1) + '<div class="au-kreis au-mittel"><b>Mittel</b>' + zeile('Gräser', '<b>' + (e.g == null ? '–' : e.g + ' %') + '</b>') + zeile('Klee', '<b>' + (e.kl == null ? '–' : e.kl + ' %') + '</b>') + zeile('Kräuter', '<b>' + (e.kr == null ? '–' : e.kr + ' %') + '</b>') + '</div></div>' +
      zeile('Lücken (Flächenanteil)', stepper('luecken', a.luecken, 'Lücken')) +
      '<h4 class="au-h4">Arten und Ertragsanteile</h4><div class="row" style="margin-bottom:8px"><button type="button" class="btn sm" data-au="bestimmen">🌿 Pflanze bestimmen und übernehmen</button></div>' +
      '<div class="au-kats">' + KAT.map(artenKat).join('') + '</div>' +
      (gesamt ? '<table class="wi-tab au-summen"><tr><td>Gräser (Futter- + geringwertige)</td><td>' + (e.kat.fg + e.kat.gg) + ' %' + vgl(e.kat.fg + e.kat.gg, e.g) + '</td></tr><tr><td>Klee</td><td>' + e.kat.kl + ' %' + vgl(e.kat.kl, e.kl) + '</td></tr>' +
        '<tr><td>Kräuter (alle)</td><td>' + (e.kat.fk + e.kat.gk + e.kat.uk) + ' %' + vgl(e.kat.fk + e.kat.gk + e.kat.uk, e.kr) + '</td></tr><tr><td><b>Total</b></td><td><b class="' + (gesamt !== 100 ? 'au-warn' : '') + '">' + gesamt + ' %</b>' + (gesamt !== 100 ? ' (soll 100 %)' : '') + '</td></tr>' +
        '<tr><td>Total Futterpflanzen</td><td>' + e.wertvoll + ' %</td></tr><tr><td>Total geringwertige Arten/Unkräuter</td><td>' + (e.kat.gg + e.kat.gk + e.kat.uk) + ' %</td></tr></table>' : '') +
      '<p class="hint">' + FUSS1 + ' Ertragsanteile blühender Pflanzen und gut sichtbarer Blätter (z. B. Weissklee) werden gern überschätzt.</p></section>' +
      '<section class="q"><h3>1.2 Beurteilung des vorhandenen Bestandes</h3>' +
      zeile('Botanischer Typ', seg('beurteilung.typ', W.typ, b.typ), e.typ ? 'Vorschlag: ' + esc(e.typText) + (b.typ !== e.typ ? ' <button type="button" class="btn sm ghost" data-au="setze" data-pfad="beurteilung.typ" data-val="' + e.typ + '">übernehmen</button>' : '') : 'nach Merkblatt 3') +
      zeile('Futtergräser', '<span class="au-wert">' + (e.fgKlasse || '–') + '</span>', e.fg != null ? 'aus der Artenliste: ' + e.fg + ' %' : 'aus der Artenliste') +
      zeile('Verunkrautung', seg('beurteilung.verunkrautung', W.stufe4, b.verunkrautung), e.unkraut != null ? 'Unkräuter/Giftpflanzen: ' + e.unkraut + ' %' : '') +
      zeile('Verfilzung', seg('beurteilung.verfilzung', W.stufe4, b.verfilzung)) +
      zeile('Lücken/Lückenfüller', '<span class="au-wert">' + (e.lkl || '–') + '</span>', a.luecken != null ? a.luecken + ' % Lücken' : 'Lücken oben schätzen') +
      zeile('Konservierbarkeit Silage', seg('beurteilung.silage', W.note4, b.silage)) +
      zeile('Konservierbarkeit Dürrfutter', seg('beurteilung.duerr', W.note4, b.duerr)) +
      zeile('Eignung für Weide', seg('beurteilung.weide', W.note4, b.weide)) +
      zeile('Ertrag (Schätzung)', feld('beurteilung.ertrag', b.ertrag, ' type="number" min="0" max="400" inputmode="decimal" style="max-width:110px"') + ' <span class="small">dt TS/Jahr</span> <button type="button" class="btn sm ghost" data-wi="hoehe">Höhe &amp; Ertrag (je Schnitt)</button>') +
      '<label class="field"><span>Wiesentyp, Bemerkungen</span>' + text('beurteilung.bemerkung', b.bemerkung) + '</label>' +
      '<h4 class="au-h4">Wichtige Zeigerarten</h4>' +
      (zeiger.length ? '<table class="wi-tab au-zeigertab"><tr><th>Art</th><th>%</th><th>Worauf weist sie hin?</th></tr>' + zeiger.map((x) => '<tr><td>' + esc(x.n) + '</td><td>' + x.p + '</td><td>' + esc((T3[x.n] || T4[x.n])[1]) + '</td></tr>').join('') + '</table>'
        : '<p class="small muted">Erscheinen automatisch, sobald Arten aus den Tabellen 3 und 4 des Merkblatts mit mindestens 5 % erfasst sind.</p>') +
      '<label class="field"><span>Mögliche Ursache (eigene Einschätzung)</span>' + text('beurteilung.zeigerNotiz', b.zeigerNotiz, 'z. B. Verdichtung bei der Einfahrt, späte Nutzung im Vorjahr') + '</label></section>';
  }

  function teil2(a) {
    const s = a.standort; const bi = a.bisher; const r = raigrasHinweis(a);
    return '<section class="q" id="au-2"><h3>2. Standort</h3>' +
      zeile('Wasserhaushalt', seg('standort.wasser', W.wasser, s.wasser)) + zeile('Bodenart', seg('standort.boden', W.boden, s.boden)) + zeile('Gründigkeit', seg('standort.gruendig', W.gruendig, s.gruendig)) +
      zeile('Nährstoffversorgung', seg('standort.naehrstoff', W.naehrstoff, s.naehrstoff)) + zeile('Neigung', seg('standort.neigung', W.neigung, s.neigung)) + zeile('Exposition', seg('standort.exposition', W.exposition, s.exposition)) +
      zeile('Raigrasfähigkeit', seg('standort.raigras', W.raigras, s.raigras), r.v ? 'Hinweis: eher «' + r.v + '»' + (s.raigras !== r.v ? ' <button type="button" class="btn sm ghost" data-au="setze" data-pfad="standort.raigras" data-val="' + r.v + '">übernehmen</button>' : '') : 'Höhe eingeben für einen Hinweis') +
      (r.t.length ? '<ul class="small au-hinweise">' + r.t.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      '<details class="small"><summary>Raigrasfähige Lagen (Merkblatt 8)</summary><p>Mildes Klima mit hoher Luftfeuchtigkeit, sonnig, früh schneefrei; mittlere Jahrestemperatur 6,5–9 °C (Englisches Raigras) bzw. 8–9 °C (Italienisches Raigras). Milde Lagen bis 900 m ü. M. (Englisches Raigras bis 1000 m), rauhe Lagen bis 700 m. Normal durchlässige Böden bei 900–1200 mm Niederschlag pro Jahr (maximal 1500); Braunerde, mittelschwer, krümeliger Oberboden, keine Verdichtungen; P und K «mässig» bis «genügend», regelmässige leichte N-Gaben. Englisches Raigras: Weide, Mähweide oder Mähwiese mit Frühlingsweide, zwischen 700 und 1000 m auch Mähwiese. Italienisches Raigras: Mähwiese, höchstens fünf Schnitte, gelegentlich versamen lassen.</p></details>' +
      zeile('Ertragspotenzial', seg('standort.potenzial', W.potenzial, s.potenzial)) +
      '<label class="field"><span>Allgemeiner Eindruck, Bemerkungen</span>' + text('standort.bemerkung', s.bemerkung) + '</label>' +
      '<h3 style="margin-top:18px">Bisherige Bewirtschaftung</h3>' +
      zeile('Bewirtschaftungsintensität', seg('bisher.intensitaet', W.intensitaet, bi.intensitaet)) + zeile('Düngung', seg('bisher.duengung', W.duengung, bi.duengung)) +
      zeile('Nutzungsart', seg('bisher.nutzung', W.nutzung, bi.nutzung)) + zeile('Verwertungsart', seg('bisher.verwertung', W.verwertung, bi.verwertung)) +
      '<label class="field"><span>Pflege</span>' + text('bisher.pflege', bi.pflege, 'z. B. Walzen, Striegeln, Weidepflege, Übersaat 2024') + '</label></section>';
  }

  function teil3(a, e) {
    const z = a.ziel;
    const bar = (t, ist, von, bis) => { const ok = ist != null && ist >= von && ist <= bis; return '<div class="au-ziel"><span>' + t + '</span><div class="au-ziel-bar"><i class="au-ziel-soll" style="left:' + von + '%;width:' + (bis - von) + '%"></i>' + (ist != null ? '<i class="au-ziel-ist' + (ok ? ' ok' : '') + '" style="left:calc(' + Math.min(100, ist) + '% - 2px)"></i>' : '') + '</div><span class="small">' + (ist == null ? '–' : ist + ' %') + ' <span class="muted">(Ziel ' + von + '–' + bis + ')</span></span></div>'; };
    const vorhanden = new Set(a.arten.map((x) => x.n));
    const vorschlZurueck = a.arten.filter((x) => (x.kat === 'gg' || x.kat === 'gk' || x.kat === 'uk') && x.p >= 5).map((x) => x.n);
    const chip = (pfad, n, an) => '<button type="button" class="chip au-chip" data-au="toggle" data-pfad="' + pfad + '" data-val="' + esc(n) + '" aria-pressed="' + an + '">' + esc(n) + (vorhanden.has(n) ? ' ·' : '') + '</button>';
    const zurueckKandidaten = [...new Set(vorschlZurueck.concat(z.zurueck))].concat(Object.keys(T3).filter((n) => !vorschlZurueck.includes(n) && !z.zurueck.includes(n)));
    const massn = (liste, T) => liste.filter((n) => T[n]).map((n) => '<li><b>' + esc(n) + ':</b> ' + esc(T[n][0]) + '</li>').join('');
    return '<section class="q" id="au-3"><h3>3. Angestrebte Bewirtschaftung</h3>' +
      zeile('Bewirtschaftungsintensität', seg('ziel.intensitaet', W.intensitaet, z.intensitaet)) + zeile('Nutzungsart', seg('ziel.nutzung', W.nutzung, z.nutzung)) + zeile('Verwertungsart', seg('ziel.verwertung', W.verwertung, z.verwertung)) +
      '<h3 style="margin-top:18px">Zielbestand</h3><p class="qhint">Ziel: ausgewogene oder allenfalls grasreiche Bestände mit wertvollen Gräsern, Kleearten und feinblättrigen Futterkräutern, angepasst an Standort und Bewirtschaftung. In höheren Lagen muss ein grösserer Kräuteranteil geduldet werden.</p>' +
      bar('Futtergräser', e.fg, 50, 70) + bar('Kleearten', e.artenSumme ? e.kat.kl : e.kl, 10, 30) + bar('Futterkräuter', e.artenSumme ? e.kat.fk : null, 10, 30) +
      '<label class="field" style="margin-top:10px"><span>Wiesentyp (Zielbestand)</span>' + feld('ziel.wiesentyp', z.wiesentyp, ' maxlength="200" placeholder="z. B. ausgewogene Mähweide AR"') + '</label>' +
      '<div class="au-chips-titel">Leitgras (Leitgräser)</div><div class="au-chips">' + T1.fg.map((x) => chip('ziel.leitgraeser', x[0], z.leitgraeser.includes(x[0]))).join('') + '</div>' +
      '<div class="au-chips-titel">Fördern folgender Pflanzen <span class="muted small">(· = im Bestand)</span></div><div class="au-chips">' + Object.keys(T4).map((n) => chip('ziel.foerdern', n, z.foerdern.includes(n))).join('') + '</div>' +
      (z.foerdern.length ? '<ul class="small au-massn">' + massn(z.foerdern, T4) + '</ul>' : '') +
      '<label class="field"><span>Weitere Massnahmen zum Fördern</span>' + text('ziel.foerderText', z.foerderText) + '</label>' +
      '<div class="au-chips-titel">Zurückdrängen folgender Pflanzen</div><div class="au-chips">' + zurueckKandidaten.slice(0, Math.max(12, vorschlZurueck.length + z.zurueck.length)).map((n) => chip('ziel.zurueck', n, z.zurueck.includes(n))).join('') +
      (zurueckKandidaten.length > 12 ? '<button type="button" class="chip au-chip" data-au="alle-zurueck">alle …</button>' : '') + '</div>' +
      (z.zurueck.length ? '<ul class="small au-massn">' + massn(z.zurueck, T3) + '</ul>' : '') +
      '<label class="field"><span>Weitere Massnahmen zum Zurückdrängen</span>' + text('ziel.zurueckText', z.zurueckText) + '</label>' +
      '<p class="hint">Durch die Förderung der angepassten, wertvollen Futtergräser können geringwertige Arten in der Regel zurückgedrängt werden (Merkblatt 8, Tabellen 3 und 4). Prüfen, ob fehlende Arten durch Übersaaten etabliert werden könnten.</p></section>';
  }

  function vorschlaege(a, e) {
    const kurz = []; const lang = [];
    if (a.luecken != null && a.luecken >= 25) kurz.push('Lücken ' + a.luecken + ' %: Übersaat bzw. Neuansaat prüfen (AGFF-Merkblätter 4, 5, 7, 12).');
    else if (a.luecken != null && a.luecken >= 5) kurz.push('Lücken ' + a.luecken + ' %: Lücken schliessen, z. B. durch Übersaat (AGFF-Merkblatt 5).');
    if (e.fg != null && e.fg < 30) kurz.push('Futtergräser nur ' + e.fg + ' %: Bestand mit standortangepassten Futtergräsern verbessern (Übersaat, AGFF-Merkblatt 5).');
    const uk = a.arten.filter((x) => x.kat === 'uk' && x.p > 0);
    if (uk.length) kurz.push('Unkräuter/Giftpflanzen (' + uk.map((x) => x.n).join(', ') + '): Regulierung nach AGFF-Merkblatt 4.');
    a.ziel.zurueck.filter((n) => T3[n]).forEach((n) => lang.push(n + ' zurückdrängen: ' + T3[n][0] + '.'));
    a.ziel.foerdern.filter((n) => T4[n]).forEach((n) => lang.push(n + ' fördern: ' + T4[n][0] + '.'));
    if (a.ziel.intensitaet && a.bisher.intensitaet && a.ziel.intensitaet !== a.bisher.intensitaet) lang.push('Bewirtschaftung von «' + a.bisher.intensitaet + '» auf «' + a.ziel.intensitaet + '» anpassen (Nutzung, Düngung, Pflege; AGFF-Merkblätter 1, 10, 11).');
    return { kurz, lang };
  }
  function teil4(a, e) {
    const v = vorschlaege(a, e); const m = a.massnahmen;
    return '<section class="q" id="au-4"><h3>4. Verbesserungsmassnahmen</h3>' +
      '<label class="field"><span>Kurzfristige Massnahmen <span class="muted small">(Sanierung, Übersaat bzw. Neuansaat; AGFF-Merkblätter 4, 5, 7, 12)</span></span>' + text('massnahmen.kurz', m.kurz) + '</label>' +
      (v.kurz.length ? '<div class="au-vorschlag"><ul class="small">' + v.kurz.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul><button type="button" class="btn sm" data-au="vorschlag" data-teil="kurz">Vorschläge einfügen</button></div>' : '') +
      '<label class="field"><span>Langfristige Massnahmen <span class="muted small">(angepasste Nutzung, Düngung und Pflege; AGFF-Merkblätter 1, 10, 11)</span></span>' + text('massnahmen.lang', m.lang) + '</label>' +
      (v.lang.length ? '<div class="au-vorschlag"><ul class="small">' + v.lang.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul><button type="button" class="btn sm" data-au="vorschlag" data-teil="lang">Vorschläge einfügen</button></div>' : '') +
      '<p class="hint">Vorschläge stammen aus den Tabellen 3 und 4 sowie Abschnitt 4 des Merkblatts 8 – immer auf Standort und Wiesentyp abstimmen. Die genannten AGFF-Merkblätter finden Sie unter «Hilfe & Merkblätter» bzw. auf agff.ch.</p></section>';
  }

  // ---------- Werte setzen ----------
  function setzePfad(a, pfad, wert) {
    const teile = pfad.split('.'); let o = a;
    for (let i = 0; i < teile.length - 1; i++) { o = o[/^\d+$/.test(teile[i]) ? Number(teile[i]) : teile[i]]; if (o == null) return; }
    o[teile[teile.length - 1]] = wert;
  }
  function holePfad(a, pfad) { return pfad.split('.').reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), a); }
  const aktuell = () => { const r = app().route(); return r.name === 'aufnahmen' && r.id ? byId(r.id) : null; };
  function neuZeichnen(scroll) {
    const y = global.scrollY; const m = document.getElementById('main'); const st = m ? m.scrollTop : 0;
    app().render();
    if (scroll !== false) { global.scrollTo(0, y); const m2 = document.getElementById('main'); if (m2) m2.scrollTop = st; }
  }
  function nachEingabe(el) {
    const a = aktuell(); if (!a) return;
    const pfad = el.dataset.auf; let v = el.value;
    if (el.type === 'number') v = v === '' ? undefined : Number(v);
    if (pfad === 'kopf.fotopunkt' && !v) v = undefined;
    setzePfad(a, pfad, v);
    const c = clean(a); if (c) Object.assign(a, c);
    sichern(a);
  }
  // Neu zeichnen erst, wenn der Fokus nicht mehr in einem Eingabefeld der Aufnahme ist (sonst springt der Fokus weg)
  let ausstehend = false;
  function spaeterZeichnen() {
    setTimeout(() => { const ae = document.activeElement; if (ae && ae.closest && ae.closest('[data-auf]')) ausstehend = true; else neuZeichnen(); }, 0);
  }
  document.addEventListener('focusout', (e) => {
    if (!ausstehend || !(e.target.closest && e.target.closest('[data-auf]'))) return;
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-auf]')) return;
    ausstehend = false; setTimeout(neuZeichnen, 0);
  });
  document.addEventListener('input', (e) => { const el = e.target.closest && e.target.closest('[data-auf]'); if (el && el.tagName !== 'SELECT') nachEingabe(el); });
  document.addEventListener('change', (e) => {
    const el = e.target.closest && e.target.closest('[data-auf]'); if (!el) return;
    nachEingabe(el);
    // Höhe beeinflusst die Raigras-Hilfe, Parzelle den Vergleich, Fotopunkt den Link
    if (/^kopf\.(hoehe|parzelle|fotopunkt)$/.test(el.dataset.auf)) spaeterZeichnen();
    app().refreshChrome && document.getElementById('r-list') && (document.getElementById('r-list').innerHTML = renderListe(app().route()));
  });

  function neu(vorlage) {
    const now = new Date().toISOString();
    const a = clean(Object.assign({ id: app().uid(), createdAt: now, updatedAt: now }, vorlage || { kopf: { datum: now.slice(0, 10) } }));
    L.push(a); speichern(L); app().go('#/aufnahmen/' + a.id);
    return a;
  }
  function artWaehlen(a, kat) {
    const c = KATI[kat]; const da = new Set(a.arten.map((x) => x.n));
    app().sheet('<h2>' + c.t + '</h2><p class="small muted" style="margin-top:0">Nach Tabelle 1 des Merkblatts 8. Antippen zum Hinzufügen (Start 5 %).</p><div class="au-wahl">' +
      T1[kat].map((x) => '<button type="button" class="au-wahl-art" data-au="art-dazu" data-kat="' + kat + '" data-n="' + esc(x[0]) + '"' + (da.has(x[0]) ? ' disabled' : '') + '><b>' + esc(x[0]) + '</b><span class="small muted"><i>' + esc(x[2]) + '</i> – ' + esc(x[1]) + '</span></button>').join('') + '</div>' +
      '<form id="auFrei" class="row" style="margin-top:10px"><input class="input grow" name="n" maxlength="80" placeholder="Andere Art (Name)"><button class="btn">Hinzufügen</button></form>' +
      (kat !== 'fg' && kat !== 'kl' ? '<p class="hint">' + FUSS1 + '</p>' : '') + '<button class="btn ghost block" data-close style="margin-top:8px">Schliessen</button>', (el) => {
      el.querySelector('#auFrei').addEventListener('submit', (ev) => { ev.preventDefault(); const n = String(new FormData(ev.target).get('n') || '').trim().slice(0, 80); if (!n) return; artDazu(a, n, kat); app().closeSheet(); });
    });
  }
  function artDazu(a, n, kat) {
    const t = ALIAS[n] || n; const k = katVon(t) || kat;
    const da = a.arten.find((x) => x.n === t);
    if (da) { app().toast(t + ' ist schon erfasst (' + KATI[da.kat].t + ').'); return; }
    a.arten.push({ n: t, kat: k, p: 5 }); sichern(a); neuZeichnen();
    if (k !== kat) app().toast(t + ' gehört nach Merkblatt 8 zu «' + KATI[k].t + '».');
  }
  // Raster-Klassen der Pflanzenbestimmung → Kategorie, falls die Art nicht in Tabelle 1 steht
  const AUS_RASTER = { rg: 'fg', gr: 'fg', kl: 'kl', kf: 'fk', kg: 'gk' };

  async function pdf(a) {
    const IO = global.FutterIO; await IO.loadScript('assets/vendor/jspdf.umd.min.js');
    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4' }); const T = (s) => IO.pdfText(String(s == null ? '' : s));
    const e = auswerten(a); let y = 16; const Lx = 14; const R = 196;
    const neueSeite = (h) => { if (y + h > 285) { doc.addPage(); y = 16; } };
    const h2 = (t) => { neueSeite(12); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20); doc.text(T(t), Lx, y); y += 2; doc.setDrawColor(31, 138, 76); doc.setLineWidth(0.4); doc.line(Lx, y, R, y); y += 5; doc.setFont('helvetica', 'normal'); };
    const kv = (k, v) => { if (v == null || v === '') v = '–'; const z = doc.splitTextToSize(T(String(v)), R - Lx - 62); neueSeite(z.length * 3.8 + 1); doc.setFontSize(8.5); doc.setTextColor(90); doc.text(T(k), Lx, y); doc.setTextColor(10); doc.text(z, Lx + 62, y); y += z.length * 3.8 + 0.8; };
    const absatz = (t) => { if (!t) return; const z = doc.splitTextToSize(T(t), R - Lx); neueSeite(z.length * 3.8 + 2); doc.setFontSize(8.5); doc.setTextColor(10); doc.text(z, Lx, y); y += z.length * 3.8 + 2; };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(T('Wiesenaufnahme – ' + titelVon(a)), Lx, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90); doc.text(T('Nach AGFF-Merkblatt 8 «Beurteilung von Wiesenbeständen» mit Arbeitsblatt · erstellt mit der AGFF Futterbeurteilung v2'), Lx, y); y += 7;
    const k = a.kopf;
    kv('Ort / Parzelle', [k.ort, k.parzelle].filter(Boolean).join(' / ')); kv('Höhe ü. M.', k.hoehe != null ? k.hoehe + ' m' : ''); kv('Datum', datum(k.datum)); kv('Entwicklungsstadium / Aufwuchs-Nr.', [k.stadium, k.aufwuchs ? k.aufwuchs + '. Aufwuchs' : ''].filter(Boolean).join(' / '));
    if (k.lat != null) kv('Standort (GPS)', k.lat.toFixed(5) + ', ' + k.lon.toFixed(5));
    y += 2; h2('1.1 Aufnahme des vorhandenen Pflanzenbestandes (Ertragsanteil in % TS)');
    kv('Kreis 1 / Kreis 2 / Mittel', ['Gräser', 'Klee', 'Kräuter'].map((t, i) => { const f = ['g', 'k', 'kr'][i]; return t + ' ' + [a.kreise[0][f], a.kreise[1][f]].map((x) => (x == null ? '–' : x)).join(' / ') + ' / ' + (mittel(a, f) == null ? '–' : mittel(a, f)) + ' %'; }).join('  ·  '));
    kv('Lücken', a.luecken != null ? a.luecken + ' %' : '');
    KAT.forEach((c) => { const l = a.arten.filter((x) => x.kat === c.id); if (l.length) kv(c.t + ' (Total ' + e.kat[c.id] + ' %)', l.map((x) => x.n + ' ' + x.p + ' %').join(', ')); });
    if (e.artenSumme) kv('Total Futterpflanzen / geringwertige Arten, Unkräuter', e.wertvoll + ' % / ' + (e.kat.gg + e.kat.gk + e.kat.uk) + ' %  (Summe ' + e.artenSumme + ' %)');
    h2('1.2 Beurteilung des vorhandenen Bestandes'); const b = a.beurteilung;
    kv('Botanischer Typ', (W.typ.find((x) => x[0] === b.typ) || [, ''])[1] + (e.typ ? '  (Vorschlag: ' + e.typText + ')' : ''));
    kv('Futtergräser', e.fgKlasse ? e.fgKlasse + ' (' + e.fg + ' %)' : ''); kv('Verunkrautung', b.verunkrautung); kv('Verfilzung', b.verfilzung); kv('Lücken/Lückenfüller', e.lkl);
    kv('Konservierbarkeit Silage / Dürrfutter', [b.silage || '–', b.duerr || '–'].join(' / ')); kv('Eignung für Weide', b.weide); kv('Schätzung aktueller Ertrag', b.ertrag != null ? b.ertrag + ' dt TS/Jahr' : ''); kv('Wiesentyp, Bemerkungen', b.bemerkung);
    const zeiger = a.arten.filter((x) => x.p >= 5 && (T3[x.n] || T4[x.n]));
    if (zeiger.length) kv('Wichtige Zeigerarten', zeiger.map((x) => x.n + ' (' + x.p + ' %): ' + (T3[x.n] || T4[x.n])[1]).join('; '));
    if (b.zeigerNotiz) kv('Mögliche Ursache', b.zeigerNotiz);
    h2('2. Standort und bisherige Bewirtschaftung'); const s = a.standort;
    [['Wasserhaushalt', s.wasser], ['Bodenart', s.boden], ['Gründigkeit', s.gruendig], ['Nährstoffversorgung', s.naehrstoff], ['Neigung', s.neigung], ['Exposition', s.exposition], ['Raigrasfähigkeit', s.raigras], ['Ertragspotenzial', s.potenzial], ['Allgemeiner Eindruck', s.bemerkung]].forEach(([x, v]) => kv(x, v));
    const bi = a.bisher; kv('Bisher: Intensität / Düngung', [bi.intensitaet || '–', bi.duengung || '–'].join(' / ')); kv('Bisher: Nutzungsart / Verwertung', [bi.nutzung || '–', bi.verwertung || '–'].join(' / ')); kv('Pflege', bi.pflege);
    h2('3. Angestrebte Bewirtschaftung und Zielbestand'); const z = a.ziel;
    kv('Intensität / Nutzungsart / Verwertung', [z.intensitaet || '–', z.nutzung || '–', z.verwertung || '–'].join(' / ')); kv('Wiesentyp (Zielbestand)', z.wiesentyp); kv('Leitgräser', z.leitgraeser.join(', '));
    kv('Zielanteile (meistens)', '50–70 % Futtergräser, 10–30 % Kleearten, 10–30 % Futterkräuter');
    kv('Fördern', z.foerdern.map((n) => n + ': ' + T4[n][0]).join('; ') + (z.foerderText ? (z.foerdern.length ? '; ' : '') + z.foerderText : ''));
    kv('Zurückdrängen', z.zurueck.map((n) => n + (T3[n] ? ': ' + T3[n][0] : '')).join('; ') + (z.zurueckText ? (z.zurueck.length ? '; ' : '') + z.zurueckText : ''));
    h2('4. Verbesserungsmassnahmen'); kv('Kurzfristig', a.massnahmen.kurz); kv('Langfristig', a.massnahmen.lang);
    y += 4; doc.setFontSize(7); doc.setTextColor(120); absatz(FUSS1);
    const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(140); doc.text(T('Seite ' + i + ' / ' + n), R, 292, { align: 'right' }); }
    const blob = doc.output('blob'); const url = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = url;
    el.download = 'Wiesenaufnahme_' + titelVon(a).replace(/[^A-Za-z0-9ÄÖÜäöüéè_-]+/g, '_').slice(0, 40) + (k.datum ? '_' + k.datum : '') + '.pdf'; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function handle(ev) {
    const t = ev.target.closest('[data-au]'); if (!t) return false;
    const w = t.dataset.au; const A = app(); const a = aktuell();
    switch (w) {
      case 'neu': A.closeSheet(); neu(); break;
      case 'springe': ev.preventDefault(); { const z = document.getElementById(t.dataset.ziel); if (z) z.scrollIntoView({ behavior: 'smooth', block: 'start' }); } break;
      case 'setze': if (a) { const alt = holePfad(a, t.dataset.pfad); setzePfad(a, t.dataset.pfad, alt === t.dataset.val ? undefined : t.dataset.val); sichern(a); neuZeichnen(); } break;
      case 'plus': if (a) { const alt = holePfad(a, t.dataset.pfad); const v = Math.max(0, Math.min(100, (alt == null ? 0 : alt) + Number(t.dataset.d))); setzePfad(a, t.dataset.pfad, v); sichern(a); neuZeichnen(); } break;
      case 'toggle': if (a) { const l = holePfad(a, t.dataset.pfad) || []; const i = l.indexOf(t.dataset.val); if (i >= 0) l.splice(i, 1); else l.push(t.dataset.val); setzePfad(a, t.dataset.pfad, l); sichern(a); neuZeichnen(); } break;
      case 'alle-zurueck': if (a) { A.sheet('<h2>Zurückdrängen</h2><div class="au-chips">' + Object.keys(T3).map((n) => '<button type="button" class="chip au-chip" data-au="toggle" data-pfad="ziel.zurueck" data-val="' + esc(n) + '" aria-pressed="' + a.ziel.zurueck.includes(n) + '">' + esc(n) + '</button>').join('') + '</div><button class="btn block" data-close style="margin-top:10px">Fertig</button>'); } break;
      case 'art-neu': if (a) artWaehlen(a, t.dataset.kat); break;
      case 'art-dazu': if (a) { A.closeSheet(); artDazu(a, t.dataset.n, t.dataset.kat); } break;
      case 'art-weg': if (a) { a.arten.splice(Number(t.dataset.i), 1); sichern(a); neuZeichnen(); } break;
      case 'bestimmen': if (a && global.Pflanzen) { const id = a.id; global.Pflanzen.sheet((k, n) => { const b = byId(id); if (b && n) artDazu(b, n, AUS_RASTER[k] || 'fk'); }, 'In die Wiesenaufnahme übernehmen'); } break;
      case 'raster': if (a && global.Wiese) global.Wiese.rasterFuer({ id: a.id, kreis: Number(t.dataset.kreis) }); break;
      case 'vorschlag': if (a) { const v = vorschlaege(a, auswerten(a))[t.dataset.teil]; const alt = a.massnahmen[t.dataset.teil]; const neuT = v.filter((x) => !alt.includes(x)); a.massnahmen[t.dataset.teil] = (alt ? alt.replace(/\s+$/, '') + '\n' : '') + neuT.map((x) => '– ' + x).join('\n'); sichern(a); neuZeichnen(); } break;
      case 'gps': if (a) {
        if (!navigator.geolocation) { A.toast('Dieses Gerät liefert keinen Standort.'); break; }
        A.toast('Standort wird bestimmt …'); const id = a.id;
        navigator.geolocation.getCurrentPosition((p) => { const b = byId(id); if (!b) return; b.kopf.lat = p.coords.latitude; b.kopf.lon = p.coords.longitude; sichern(b); A.toast('Standort gespeichert (± ' + Math.round(p.coords.accuracy) + ' m).'); neuZeichnen(); },
          (er) => A.toast(er && er.code === 1 ? 'Kein Zugriff auf den Standort.' : 'Standort nicht verfügbar.'), { enableHighAccuracy: true, timeout: 20000 });
        break;
      }
      case 'pdf': { const b = byId(t.dataset.id); if (b) pdf(b).catch((er) => A.toast('PDF fehlgeschlagen: ' + er.message)); break; }
      case 'kopie': { const b = byId(t.dataset.id); if (!b) break; const c = JSON.parse(JSON.stringify(b)); delete c.id;
        // Folgeaufnahme: Kopf, Standort, Bewirtschaftung und Ziel übernehmen; Bestand neu schätzen
        neu({ kopf: Object.assign({}, c.kopf, { datum: new Date().toISOString().slice(0, 10), stadium: '', aufwuchs: undefined }), standort: c.standort, bisher: c.bisher, ziel: c.ziel });
        A.toast('Folgeaufnahme angelegt – Standort und Ziel übernommen, Bestand neu schätzen.'); break; }
      case 'loeschen': { const b = byId(t.dataset.id); if (b && confirm('Wiesenaufnahme «' + titelVon(b) + '» löschen?')) { L = L.filter((x) => x.id !== b.id); speichern(L); A.go('#/aufnahmen'); } break; }
      default: return false;
    }
    return true;
  }
  /** Ergebnis aus dem Punktraster (wiese.js) in einen Kreis übernehmen. */
  function rasterUebernehmen(ziel, v) {
    const a = byId(ziel.id); if (!a || !v) return;
    const r5 = (x) => Math.round(x * 20) * 5;
    const g = r5(v.gras); const k = r5(v.kl); a.kreise[ziel.kreis] = { g, k, kr: Math.max(0, 100 - g - k) };
    a.luecken = r5(v.luecken); a.rasterKf = v.kf; a.rasterKg = v.kg;
    sichern(a); app().go('#/aufnahmen/' + a.id); app().render();
    app().toast('Kreis ' + (ziel.kreis + 1) + ' aus dem Punktraster übernommen (Deckung, nicht Gewicht – bitte prüfen).');
  }

  function sicherung() { return laden(); }
  function wiederherstellen(liste) {
    if (!Array.isArray(liste)) return; const alt = laden();
    liste.map(clean).filter(Boolean).forEach((x) => { const i = alt.findIndex((y) => y.id === x.id); if (i < 0) alt.push(x); else if ((x.updatedAt || '') > (alt[i].updatedAt || '')) alt[i] = x; });
    speichern(alt); L = alt;
  }
  function allesLoeschen() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } L = []; }
  const anzahl = () => laden().length;

  global.Aufnahme = { render, renderListe, handle, rasterUebernehmen, sicherung, wiederherstellen, allesLoeschen, anzahl, _t: { auswerten, clean, raigrasHinweis, T1, T3, T4 } };
})(window);
