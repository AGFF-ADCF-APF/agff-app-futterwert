/* Futter v2 – Assistent «Traktor»: kurze Hilfe je Schritt und je Faktor im Rad (feste Texte, keine KI).
 *
 * - Meldet sich beim ersten Besuch eines Schritts/Faktors von selbst, danach nur auf Antippen.
 * - «Ruhe» schickt ihn schlafen (zZ); Antippen weckt ihn wieder. Auch in den Einstellungen schaltbar.
 * - Sprache umschaltbar: «einfach» (Alltagssprache) oder «fachlich» (Hintergründe, Zahlen).
 * Zustand nur auf diesem Gerät (localStorage, Bequemlichkeit – keine Daten zur Probe).
 */
(function (global) {
  'use strict';
  const KEY = 'agffV2Assistent';
  const app = () => global.__app;

  function zustand() {
    let z = null;
    try { z = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { z = null; }
    z = z && typeof z === 'object' ? z : {};
    return { ruhe: z.ruhe === true, stufe: z.stufe === 'fachlich' ? 'fachlich' : 'einfach', gesehen: Array.isArray(z.gesehen) ? z.gesehen.filter((x) => typeof x === 'string').slice(-200) : [] };
  }
  let Z = zustand();
  const merken = () => { try { localStorage.setItem(KEY, JSON.stringify(Z)); } catch (e) { /* privat: dann eben jedes Mal */ } };

  const B = (src, cap) => ({ src: 'assets/bilder/' + src, cap });

  // ---------- Texte ----------
  // Je Eintrag: titel, einfach, fachlich (HTML erlaubt, nur feste Texte), optional bilder.
  const T = {
    probe: {
      titel: 'Los geht’s!',
      einfach: 'Gib der Probe einen Namen, den du später wiedererkennst – z. B. «Silo Nord» oder «Rundballen 3». Wähle dann die Futterart: Heu/Emd, Grassilage oder Maissilage. Ich helfe dir bei jedem Schritt.',
      fachlich: 'Bezeichnung und Futterart legen das Merkblatt fest: K3a (Dürrfutter), K3b (Grassilage) oder K3c (Maissilage). Die Ausgangswerte stammen aus der Agroscope-Futterwerttabelle; Bestand, Stadium und Sensorik korrigieren sie.',
    },
    bestand: {
      titel: 'Welcher Bestand?',
      einfach: 'Schau, was in der Probe (oder auf der Wiese) wächst: Sind es vor allem <b>Gräser</b>, viel <b>Klee</b> oder viele <b>Kräuter</b> wie Löwenzahn? Schätze grob – auf 10 % genau reicht. Raigras erkennst du an den glänzenden Blattunterseiten.',
      fachlich: 'Massgebend ist der Gewichtsanteil im Bestand zum Schnittzeitpunkt. Gräserreich: > 70 % Gräser; ausgewogen: 50–70 %; kleereich: > 50 % Klee. «Raigras» (Gᵣ, Aᵣ), wenn mehr als die Hälfte der Gräser Raigräser sind – sie haben mehr Zucker und eine höhere Verdaulichkeit. Kräuterreich: feinblättrige (Löwenzahn, Wegerich) vs. grobstänglige Kräuter (Kerbel, Bärenklau) mit tieferem Futterwert.',
    },
    stadium: {
      titel: 'Wie alt war das Futter?',
      einfach: 'Je älter die Pflanzen beim Schnitt, desto mehr harte Stängel und desto weniger Energie. <b>1. Aufwuchs:</b> Schau bei den Gräsern, ob die Ähren schon sichtbar sind oder blühen. <b>Folgeaufwuchs:</b> Hier zählen die Wochen seit dem letzten Schnitt. Tipp: Bilder unten antippen.',
      fachlich: 'Im 1. Aufwuchs wird das Stadium an der Leitpflanze bestimmt (z. B. Knaulgras/Engl. Raigras): 1 Bestockung – 2 Schossen (10-cm-Punkt) – 3 Beginn Rispenschieben – 4 volles Rispenschieben – 5 Ende Rispenschieben – 6 Blüte – 7 Samenreife. Pro Stadium sinkt der NEL-Gehalt um rund 0,2–0,3 MJ/kg TS. In Folgeaufwüchsen bilden sich kaum Ähren; deshalb gilt das Alter in Wochen (über 600 m ü. M. und im Herbst langsamere Alterung).',
      bilder: [B('stadien-page-1.webp', 'Entwicklungsstadien der Gräser'), B('knaulgras.webp', 'Knaulgras: Stadien 3, 4, 6'), B('rotklee.webp', 'Rotklee: Stadien 3, 5, 6'), B('b2-stadien-1.webp', 'Beschreibung der Stadien (AGFF)')],
    },
    'ts.gras': {
      titel: 'Sauberkeit und Trockensubstanz',
      einfach: '<b>Sauberkeit:</b> Siehst du Erde, Sand oder Mist? Das senkt den Wert und ist ein Risiko für Fehlgärungen. <b>TS mit der Auswringprobe:</b> Nimm eine Handvoll Silage und winde sie wie einen Waschlappen aus. Tropft Saft? Bleiben die Hände nass, feucht oder trocken? Das zeigt dir, wie trocken das Futter ist.',
      fachlich: 'Erde und Mist erhöhen den Aschegehalt (> 10 % der TS gilt als verschmutzt) und bringen Clostridien-Sporen ein. Die Auswringprobe schätzt den TS-Gehalt auf ± 5 %: Saft bei leichtem Druck < 20 %, Saft zwischen den Fingern ~30 %, nur noch feuchte Hände ~35 %, Hände trocken > 45 %. Optimal sind 30–40 % TS: nasser drohen Sickersaft und Buttersäure, trockener Nacherwärmung (schlechte Verdichtung). Der TS-Gehalt bestimmt auch, welcher pH-Wert noch gut ist.',
      bilder: [B('wringprobe-1.webp', 'TS-Bestimmung mit der Wringprobe')],
    },
    'ts.mais': {
      titel: 'Trockensubstanz und Kolben',
      einfach: 'Drück eine Handvoll Maissilage zusammen, ohne fest zu pressen. Fliesst Saft, ist sie zu nass; spürst du gar keine Feuchte mehr, zu trocken. Ideal: etwas Feuchte zwischen den Fingern, aber es tropft nicht. Schätze dazu, wie viel Kolben (Körner, Spindel, Lieschen) in der Pflanze steckt.',
      fachlich: 'Optimal sind 32–36 % TS (Kornreife: Milchlinie bei ½ bis ⅔). Unter 30 % entsteht Gärsaft mit Nährstoffverlust; über 38 % lässt sich das Futter schlecht verdichten → Hefen, Nacherwärmung. Der Kolbenanteil bestimmt den Stärkegehalt: über 55 % gilt als Normalfall, darunter sinken NEL und Stärke deutlich, Rohfaser und NDF steigen.',
    },
    haecksel: {
      titel: 'Häcksel und Körner',
      einfach: 'Schau dir die Häcksellänge an: Gut sind kurze, sauber geschnittene Stücke (etwa 1 cm). Lange oder verfranste Stängel lassen sich schlecht verdichten. Wichtig: <b>Jedes Korn sollte angeschlagen sein</b> – ganze Körner gehen unverdaut durch die Kuh.',
      fachlich: 'Median der Partikellänge um 10 mm, höchstens 5 % > 20 mm (Schüttelbox). Verfranste Schnitte deuten auf stumpfe Messer oder falschen Gegenschneiden-Abstand hin. Körner: Auswaschmethode (Probe in Wasser, Körner absetzen lassen, ganze Körner zählen). Je trockener, desto härter die Körner – ab 36 % TS dürfen keine ganzen Körner mehr vorkommen; der Corncracker-Spalt (1–3 mm) entsprechend einstellen.',
    },
    sauber: {
      titel: 'Sauberes Grünfutter?',
      einfach: 'Schau, ob Erde, Sand oder Gülle am Futter klebt – besonders nach Regen, bei Maulwurfshaufen oder tief eingestelltem Mähwerk. Verschmutztes Gras hat weniger Energie, und die Tiere fressen es weniger gern.',
      fachlich: 'Für Grünfutter gelten die Tabellenwerte von Agroscope je Bestand, Aufwuchs und Stadium. Verschmutzung erhöht die Rohasche (über 100 g/kg TS) und senkt NEL, NEV und APD (Abzug wie K3b: −5 % leicht, −10 % stark). Hofdüngerreste bringen Keime ein; Gülle deshalb früh und verdünnt ausbringen.',
    },
    kultur: {
      titel: 'Ganzpflanzensilage',
      einfach: 'Wähle die Getreideart (oder die Mischung) und wie reif sie bei der Ernte war. Am besten wird GPS zwischen Milch- und früher Teigreife geerntet: Dann ist das Korn gefüllt, aber Halm und Blätter sind noch gut verdaulich.',
      fachlich: 'Die Werte stammen aus dem Richtwert-Modell von v1 (AGFF-Näherung, Referenzen für Getreide-GPS) und werden je Stadium und Leguminosenanteil angepasst. Früh: weniger Stärke, mehr Protein, weniger Faser; spät: mehr Stärke, aber verholzte Halme. Die Gärqualität beurteilst du mit dem Rad der Grassilage. Wegen grosser Schwankungen (Sorte, Jahr, Schnitthöhe) lohnt sich eine Laboranalyse.',
    },
    ergebnis: {
      titel: 'Dein Ergebnis',
      einfach: 'Oben siehst du die Qualitätsklasse und die geschätzten Werte: <b>NEL</b> ist die Energie für Milch, <b>APDE</b> das Eiweiss, das die Kuh nutzen kann. Vergleiche mit dem Zielwert – und wenn du eine Laboranalyse hast, mit dem Labor. Mit «PDF» speicherst du alles; die Daten stecken in der PDF und lassen sich wieder einlesen.',
      fachlich: 'Die Schätzung basiert auf den Tabellenwerten (Bestand, Stadium, Konservierung) und den Korrekturen aus dem Merkblatt (Sensorik, Feldbedingungen, Gärqualität). NEL/NEV in MJ je kg TS, APDE/APDN in g je kg TS – der kleinere APD-Wert begrenzt. Milch- und Mastpotenzial zeigen, welche Leistung das Futter allein erlaubt; sie sind Orientierungswerte, keine Rationsberechnung.',
    },

    // --- K3a Dürrfutter ---
    'rad.heu.geruch': {
      titel: 'Geruch des Heus',
      einfach: 'Gutes Heu riecht angenehm nach Gras oder Kräutern. Leicht nach Caramel oder Brot heisst: es hat sich im Stock etwas erwärmt – das ist noch okay. Stark verbrannt oder rauchig: zu heiss geworden. <b>Muffig</b> wie nasser Karton oder Keller heisst Schimmel.',
      fachlich: 'Leichte Erwärmung (Maillard-Reaktion, Caramel-/Malzgeruch) senkt die Proteinabbaubarkeit im Pansen → APDE leicht höher, Energie unverändert. Starke Erwärmung (> 50 °C) macht Protein unverdaulich und kostet Energie (−3 %). Muffiger Geruch zeigt Schimmelpilze; bei starkem Befall Gefahr von Mykotoxinen – nicht verfüttern, und beim Umgang Staubmaske tragen (Farmerlunge).',
    },
    'rad.heu.farbe': {
      titel: 'Farbe der Blätter',
      einfach: 'Grüne Blätter zeigen: schonend getrocknet. Verbleichte (weissliche) Blätter lagen lange in Sonne oder Regen. Braun heisst erwärmt. <b>Flecken in Weiss, Grau, Rosa oder Blau</b> sind Schimmel – dann nicht verfüttern.',
      fachlich: 'Die grüne Farbe (Chlorophyll, Carotin) bleibt bei kurzer Feldzeit und Belüftung erhalten. Ausbleichen entsteht durch UV und Auswaschung bei langer Bodentrocknung – Vitamin- und Energieverluste (bis −4 % NEL, −8 % APDE). Braun = Erwärmung im Stock. Mehrfarbiger Belag = Schimmelpilze → Mykotoxin-Risiko.',
    },
    'rad.heu.regen': {
      titel: 'Regen auf dem Feld',
      einfach: 'Hat es geregnet, während das Futter am Boden trocknete? Regen wäscht Zucker und Eiweiss aus, und die Blätter fallen leichter ab. Schon ein Regentag kostet spürbar Futterwert.',
      fachlich: 'Regen laugt lösliche Kohlenhydrate und Protein aus und verlängert die Atmungsverluste. Korrektur nach K3a: 1 Tag Regen −5 % NEL/NEV, −8 % APDE; 2 und mehr Tage −8 % NEL/NEV, −15 % APDE. Fragen helfen: Wie lange lag das Futter? Wurde nach dem Regen gezettet?',
    },
    'rad.heu.blaetter': {
      titel: 'Sind die Blätter noch da?',
      einfach: 'Die Blätter von Klee und Kräutern sind der wertvollste Teil. Siehst du nur noch Stängel, sind sie beim Zetten oder Schwaden abgebröckelt. Tipp für die Ernte: trockenes Futter am Morgen mit Tau bearbeiten.',
      fachlich: 'Bröckelverluste entstehen v. a. bei Leguminosen und Kräutern ab ca. 60 % TS, wenn das Futter mittags gewendet oder zu schnell gekreiselt wird. Fehlende Blätter trotz Stängeln: −4 % NEL, −3 % APDE/APDN. Belüftetes Heu zeigt typischerweise noch gut sichtbare Blätter.',
    },
    'rad.heu.mist': {
      titel: 'Mist- oder Güllereste',
      einfach: 'Kleben Reste von Mist oder Gülle an Blättern und Stängeln? Dann gehört das Futter nicht in den Futtertrog – es können Krankheitskeime drin sein.',
      fachlich: 'Hofdünger auf dem Futter bringt Clostridien, Listerien und E. coli ein und mindert die Schmackhaftigkeit. Vorbeugen: Gülle verdünnt und früh nach dem Schnitt ausbringen, nicht kurz vor der Ernte; Mist gut verteilen. Sichtbare Rückstände → nicht verfüttern.',
    },
    'rad.heu.erde': {
      titel: 'Erde oder Sand',
      einfach: 'Schüttle die Probe über einem Blatt Papier: Bleibt Erde oder Sand liegen, oder knirscht es zwischen den Zähnen? Erde kommt oft von zu tief eingestellten Maschinen oder Maulwurfshaufen.',
      fachlich: 'Erde erhöht die Rohasche und verdünnt die Energie (−4 % NEL), ausserdem bringt sie Sporen ein. Ursachen: Schnitthöhe unter 7 cm, Zetter/Schwader zu tief, Maulwurfshaufen, nasse Böden. Ziel: Rohasche unter 10 % der TS.',
    },
    'rad.heu.staub': {
      titel: 'Staubt es?',
      einfach: 'Schüttle eine Handvoll Heu. Gelber Blütenstaub (z. B. vom Löwenzahn) ist harmlos. Grauer oder weisser Staub kommt von Schimmel – dann nicht verfüttern und den Staub nicht einatmen.',
      fachlich: 'Schimmelstaub besteht aus Pilzsporen; er reizt die Atemwege von Tier und Mensch (besonders Pferde) und kann Mykotoxine enthalten. Ursachen: zu feucht eingelagert (> 15–18 % Wasser beim Lagern), ungenügende Belüftung, Erwärmung. Blütenstaub dagegen ist ohne Bedeutung.',
    },

    // --- K3b Grassilage ---
    'rad.gras.essig': {
      titel: 'Essigsäure',
      einfach: 'Riecht die Silage stechend nach Essig, sodass es in der Nase sticht? Dann ist sie zu langsam sauer geworden – oft, weil sie zu nass war oder zu wenig Zucker hatte. Die Kühe fressen solche Silage weniger gern.',
      fachlich: 'Essigsäure bilden heterofermentative Milchsäurebakterien und Enterobakterien, wenn die Ansäuerung langsam verläuft: wenig Zucker (kleereich, nass), hoher Pufferwert, schlechte Verdichtung. Etwas Essigsäure verbessert die aerobe Stabilität; über ca. 3 % der TS sinken Geschmack und Futteraufnahme.',
    },
    'rad.gras.alkohol': {
      titel: 'Alkohol und Hefen',
      einfach: 'Riecht es nach Most, gärig oder nach Alkohol? Das machen Hefen, wenn Luft in die Silage kommt. Hefen sind oft der Anfang davon, dass sich die Silage später erwärmt.',
      fachlich: 'Hefen vergären Zucker zu Ethanol (Energieverlust) und bauen bei Luftzutritt Milchsäure ab – der pH steigt, danach folgen Schimmelpilze. Ursachen: lockere Lagerung, undichte Folie, langsamer Vorschub. Fruchtige Ester (Ethylacetat) riechen nach Nagellack oder reifen Früchten.',
    },
    'rad.gras.erwaermung': {
      titel: 'Nacherwärmung',
      einfach: 'Riecht die Silage nach Caramel, Brot oder sogar verbrannt? Dann ist sie nach dem Öffnen warm geworden, weil Luft hineinkam. Dabei geht Energie verloren. Fühl mit der Hand in die Anschnittfläche: Ist sie warm?',
      fachlich: 'Nach dem Öffnen bauen Hefen und Schimmelpilze Milchsäure und Zucker ab; die Silage erwärmt sich (Maillard-Reaktion, Caramel-/Röstgeruch) und verliert Energie, das Protein wird schlechter verdaulich. Vorbeugen: gute Verdichtung, glatte Anschnittfläche, Vorschub mind. 1,5 m pro Woche im Winter und 2,5 m im Sommer.',
    },
    'rad.gras.butter': {
      titel: 'Buttersäure',
      einfach: 'Riecht es nach ranziger Butter, Erbrochenem oder Fäkalien, und bleibt der Geruch an den Händen kleben? Das ist Buttersäure. Sie entsteht durch Bakterien aus <b>Erde und Mist</b>, wenn die Silage zu nass ist. Die Sporen gelangen in die Milch und können <b>Käse verderben</b>.',
      fachlich: 'Clostridien (v. a. C. tyrobutyricum) gelangen mit Erde und Hofdünger ins Futter. In nassen, zuckerarmen Silagen mit zu langsamer pH-Absenkung bauen sie Milchsäure zu Buttersäure ab und Protein zu Ammoniak und Aminen. Ihre Sporen überstehen die Verdauung, gelangen über Kot in die Milch und verursachen die Spätblähung in Hart- und Halbhartkäse – deshalb gilt in der Käsereimilch-Produktion Silageverbot. Schon ab etwa 0,3 % der TS deutlich abgewertet.',
    },
    'rad.gras.schimmel': {
      titel: 'Schimmel',
      einfach: 'Riecht es muffig, nach Keller oder nassem Karton? Siehst du weisse, graue, grüne oder rote Stellen? Das ist Schimmel. Verschimmelte Teile grosszügig entfernen und nicht verfüttern.',
      fachlich: 'Schimmelpilze wachsen nur mit Sauerstoff: an Rändern, unter beschädigter Folie, in locker verdichteten Schichten, an der Anschnittfläche. Einige bilden Mykotoxine (z. B. Penicillium roqueforti, Aspergillus), die Fruchtbarkeit, Pansen und Immunsystem schädigen. Pilzsporen nicht einatmen.',
    },
    'rad.gras.farbe': {
      titel: 'Farbe der Silage',
      einfach: 'Gute Grassilage ist olivgrün bis gelbbraun. Dunkelbraun bis tabakfarben heisst: erwärmt. Schmutzig-grün und schmierig: Buttersäure. Die Farbe bestätigt, was du schon gerochen hast.',
      fachlich: 'Olivgrün bis bräunlich-gelb = normale Milchsäuregärung. Hellgrün, kaum verändert = wenig vergoren (z. B. sehr trocken). Braun bis schwarzbraun = Erwärmung (Maillard), Tabakgeruch. Olivgrau, schmierig = Buttersäuregärung/Proteolyse. Weisse, blaue oder rote Flecken = Schimmel.',
    },
    'rad.gras.ph': {
      titel: 'pH-Wert',
      einfach: 'Der pH-Wert zeigt, wie sauer die Silage ist. Sauer genug heisst haltbar. Je <b>nasser</b> die Silage, desto saurer muss sie sein. Messen: eine Handvoll Silage mit gleich viel destilliertem Wasser übergiessen, 10 Minuten warten und die Flüssigkeit mit Teststreifen oder pH-Meter messen.',
      fachlich: 'Der kritische pH hängt vom TS-Gehalt ab, weil Clostridien in trockenerem Futter gehemmt sind: unter 20 % TS unter 4,2; 25–30 % unter 4,4; 35–45 % unter 4,6; über 45 % unter 4,8 (Tabelle K3b; je 0,4 darüber ein Punkt mehr). Liegt der pH darüber, ist die Silage nicht stabil (Buttersäure, Nacherwärmung). Deshalb zuerst den TS-Gehalt im Schritt «Sauberkeit & TS» bestimmen.',
    },

    // --- K3c Maissilage ---
    'rad.mais.essig': {
      titel: 'Essig- und Propionsäure',
      einfach: 'Sticht es in der Nase nach Essig? Bei Maissilage kommt das oft von Siliermitteln, die Nacherwärmung verhindern sollen. Ein wenig ist gut, zu viel mögen die Kühe nicht.',
      fachlich: 'Propionsäure (Siliermittel) und Essigsäure aus heterofermentativen Milchsäurebakterien (z. B. L. buchneri) hemmen Hefen und verbessern die aerobe Stabilität. In hohen Mengen (> 3 % der TS) mindern sie die Schmackhaftigkeit und Futteraufnahme.',
    },
    'rad.mais.alkohol': {
      titel: 'Alkohol',
      einfach: 'Riecht die Silage nach saurem Most, Alkohol oder reifen Früchten? Hefen haben Zucker zu Alkohol vergoren. Maissilage ist dafür anfällig, weil sie viel Zucker und Stärke hat.',
      fachlich: 'Hefen vermehren sich bei Luftzutritt rasch (Maissilage: oft > 10⁵ KbE/g) und sind der Motor der Nacherwärmung. Ethanol bedeutet Energieverlust. Vorbeugen: TS nicht über 36 %, kurze Häcksellänge, Walzen in dünnen Schichten, rasch abdecken, ausreichender Vorschub.',
    },
    'rad.mais.erwaermung': {
      titel: 'Erwärmung',
      einfach: 'Riecht es nach Caramel, Grill oder Rauch, oder ist die Anschnittfläche warm? Dann ist Luft eingedrungen und die Silage hat sich erwärmt – sie verliert Energie und schimmelt leicht.',
      fachlich: 'Maissilage ist besonders anfällig für Nacherwärmung (viel Restzucker, Stärke, oft hohe TS). Messung: Thermometer 50 cm in die Anschnittfläche – mehr als 5 °C über Umgebungstemperatur = Nacherwärmung. Vorschub mind. 2 m pro Woche im Winter, 3,5 m im Sommer; Siliermittel der Wirkungsrichtung «aerobe Stabilität».',
    },
    'rad.mais.butter': {
      titel: 'Buttersäure',
      einfach: 'Ranziger, ekliger Geruch wie Erbrochenes? Das ist bei Maissilage selten und deutet auf Erde im Futter oder sehr nasse Silage. Die Sporen können die Milch für die Käserei unbrauchbar machen.',
      fachlich: 'Mais hat genug Zucker für eine rasche Ansäuerung; Buttersäure ist daher selten und meist Folge von Verschmutzung (Erde vom Feld oder vom Silorand), sehr tiefer TS oder Sickersaft. Clostridien-Sporen → Spätblähung im Käse.',
    },
    'rad.mais.schimmel': {
      titel: 'Schimmel',
      einfach: 'Muffig, nach Keller oder alten Socken? Weisse, blaue oder rote Stellen? Das ist Schimmel. Diese Teile wegwerfen und nicht verfüttern.',
      fachlich: 'Typische Maissilage-Schimmel (Penicillium, Aspergillus, Fusarium aus dem Feld) bilden Mykotoxine wie Deoxynivalenol, Zearalenon oder Aflatoxine. Schimmel folgt meist auf Hefen und Nacherwärmung; Randschichten und die Zone unter der Folie besonders kontrollieren.',
    },
    'rad.mais.farbe': {
      titel: 'Farbe der Silage',
      einfach: 'Gute Maissilage ist gelbgrün bis hell bräunlich-gelb. Dunkelbraun heisst erwärmt, Flecken heissen Schimmel.',
      fachlich: 'Gelblich-grün bis bräunlich-gelb = normale Gärung. Braun bis dunkelbraun = Erwärmung (Maillard). Grau oder schmierig = Fehlgärung. Weisse, blaue, rote Beläge = Schimmel.',
    },
    'rad.mais.ph': {
      titel: 'pH-Wert',
      einfach: 'Maissilage sollte sehr sauer sein – unter 4,1 ist ideal. Messen: Silage mit gleich viel destilliertem Wasser übergiessen, 10 Minuten warten, dann die Flüssigkeit messen.',
      fachlich: 'Dank viel vergärbarem Zucker erreicht Maissilage meist pH 3,7–4,0. Werte über 4,2 deuten auf gestörte Gärung oder beginnende Nacherwärmung (Milchsäureabbau durch Hefen). Punkte nach K3c: < 4,1 = 0; 4,1–4,2 = 2; 4,2–4,5 = 4; > 4,5 = 5.',
    },
  };

  // ---------- Praxis: «Erinnert an …» und «So gehst du vor» (beide Sprachstufen) ----------
  const P = {
    riechen: { vorgehen: [
      'Probe aus dem Inneren nehmen (Stock, Ballen, Anschnitt 20–30 cm tief) – nicht die Randschicht.',
      'Eine Handvoll locker in der hohlen Hand halten, leicht zusammendrücken und mit kurzen Zügen schnuppern – nicht tief einatmen.',
      'Von fein zu stark: zuerst Essig und Alkohol, dann Erwärmung, zuletzt Buttersäure und Schimmel – starke Gerüche überdecken feine.',
      'Nach 3–4 Proben die Nase lüften (an der Jacke oder frischer Luft riechen). Rauch, Parfum und Stallgeruch verfälschen.',
      'Bei schimmligem oder staubigem Futter nicht direkt einatmen – im Zweifel Staubmaske tragen.'] },
    'rad.heu.geruch': { wie: 'Gutes Heu: wie Kräutertee, frisch gemähte Wiese. Leicht erwärmt: Brotkruste, Zwieback, Malz, Karamell. Stark erwärmt: Tabak, Rauch, angebrannt. Muffig: nasser Karton, Kellerluft, alte Kartoffeln.',
      vorgehen: ['Handvoll aus dem Stockinneren aufschütteln und auseinanderziehen.', 'Erst aus etwa 20 cm, dann näher riechen.', 'Bei «muffig»: Probe vorsichtig auf Schimmelflecken und Staub prüfen.'] },
    'rad.heu.farbe': { wie: 'Grün wie getrocknete Küchenkräuter; verbleicht wie altes Stroh; braun wie Tabak; Schimmel als weisser, grauer oder rosa Belag.',
      vorgehen: ['Bei Tageslicht ansehen, nicht unter der Stalllampe.', 'Auf die Blätter achten, nicht auf die Stängel – Stängel sind oft heller.', 'Probe auseinanderziehen: Schimmel sitzt oft innen.'] },
    'rad.heu.regen': { vorgehen: ['Bewirtschafter fragen oder im Feldkalender nachsehen.', 'Hinweise am Futter: ausgebleichte Blätter, wenig Blattanteil, «strohiger» Eindruck.'] },
    'rad.heu.blaetter': { vorgehen: ['Ein paar Stängel von Klee oder Kräutern herausziehen: Hängen die Blätter noch dran?', 'Am Boden des Probensacks liegen viele Blattkrümel? Dann sind sie abgebröckelt.'] },
    'rad.heu.mist': { vorgehen: ['Probe auf einer hellen Unterlage ausbreiten.', 'Auf dunkle, verkrustete Stellen an Blättern und Stängeln achten – oft mit Stallgeruch.'] },
    'rad.heu.erde': { vorgehen: ['Probe über einem weissen Blatt Papier kräftig schütteln.', 'Bleiben Krümel oder glänzende Sandkörner liegen? Ein paar Halme kauen: Knirscht es?'] },
    'rad.heu.staub': { wie: 'Blütenstaub: gelblich, wie Pollen auf dem Auto. Schimmelstaub: grau-weiss, riecht muffig, reizt zum Husten.',
      vorgehen: ['Eine Handvoll vor dunklem Hintergrund (z. B. Jacke) schütteln – im Gegenlicht sieht man den Staub gut.', 'Nicht einatmen.'] },
    'rad.gras.essig': { wie: 'Wie ein offenes Essiggurkenglas oder Salatsauce – sticht kurz in der Nase.',
      vorgehen: ['Probe kurz an der Nase vorbeiführen, nicht hineinschnüffeln.', 'Sticht es sofort? Dann «deutlich». Nur bei genauem Hinriechen? Dann «schwach».'] },
    'rad.gras.alkohol': { wie: 'Wie vergorener Most, Apfelwein, überreife Früchte, manchmal Nagellackentferner (Ester).',
      vorgehen: ['Probe in der Hand leicht erwärmen (einige Sekunden halten), dann riechen – Alkohol verdunstet dann stärker.'] },
    'rad.gras.erwaermung': { wie: 'Leicht: Brotkruste, Karamell, Malz. Stark: Röstkaffee, Tabak, Rauch, Grill.',
      vorgehen: ['Hand flach in die Anschnittfläche legen: Fühlt sie sich warm an?', 'Probe aus 30 cm Tiefe mit einer Probe vom Rand vergleichen.'] },
    'rad.gras.butter': { wie: 'Wie ranzige Butter, alter Käse, Schweiss oder Erbrochenes – unangenehm und klebt an den Händen.',
      vorgehen: ['Fingerprobe: Silage kräftig zwischen den Handflächen reiben, die Hände 1 Minute weg vom Gesicht halten, dann an den Handflächen riechen.', 'Haftet der Geruch nach dem Händewaschen noch? Dann ist viel Buttersäure da.', 'Diese Prüfung zuletzt machen – der Geruch überdeckt alles andere.'] },
    'rad.gras.schimmel': { wie: 'Wie feuchter Keller, nasser Karton, alte Kartoffeln, Champignons.',
      vorgehen: ['Probe auseinanderziehen und auf weisse, grüne, blaue oder rote Stellen achten.', 'Verdächtige Stellen nicht direkt beriechen – Sporen nicht einatmen.'] },
    'rad.gras.farbe': { wie: 'Gut: olivgrün bis gelbbraun wie Tabakblätter. Erwärmt: dunkelbraun. Buttersäure: schmutzig grau-grün. Schimmel: Flecken.',
      vorgehen: ['Bei Tageslicht ansehen, frische Probe aus dem Inneren.', 'Farbe mit dem Geruch abgleichen: passt sie zu dem, was Sie gerochen haben?'] },
    'rad.gras.ph': { vorgehen: ['Eine Handvoll Silage in ein sauberes Glas, gleich viel destilliertes Wasser dazu.', '10 Minuten ziehen lassen, ab und zu umrühren.', 'Teststreifen in die Flüssigkeit halten oder mit pH-Meter messen (vorher kalibrieren).'] },
    'rad.mais.essig': { wie: 'Wie Essiggurkenglas; bei Propionsäure-Siliermitteln stechend-säuerlich, ähnlich wie Schweizer Käse.',
      vorgehen: ['Kurz an der Nase vorbeiführen, nicht hineinschnüffeln.'] },
    'rad.mais.alkohol': { wie: 'Wie saurer Most, Apfelwein, überreife Bananen oder Äpfel.',
      vorgehen: ['Probe kurz in der Hand erwärmen, dann riechen.'] },
    'rad.mais.erwaermung': { wie: 'Leicht: Popcorn, Brotkruste. Stark: Grill, Rauch, angebranntes Popcorn.',
      vorgehen: ['Hand in die Anschnittfläche legen oder Thermometer 50 cm tief stecken: mehr als 5 °C wärmer als die Luft = Nacherwärmung.'] },
    'rad.mais.butter': { wie: 'Ranzige Butter, Erbrochenes – bei Mais selten.',
      vorgehen: ['Fingerprobe: kräftig zwischen den Handflächen reiben, 1 Minute warten, an den Händen riechen.'] },
    'rad.mais.schimmel': { wie: 'Wie feuchter Keller, alte Socken, Pilze.',
      vorgehen: ['Besonders Randschichten und die Zone unter der Folie prüfen.', 'Verschimmelte Stellen grosszügig entfernen.'] },
    'rad.mais.farbe': { wie: 'Gut: gelbgrün bis hell bräunlich-gelb. Erwärmt: braun bis dunkelbraun. Schimmel: weisse, blaue, rote Flecken.',
      vorgehen: ['Bei Tageslicht ansehen, frische Probe aus dem Inneren.'] },
    'rad.mais.ph': { vorgehen: ['Silage mit gleich viel destilliertem Wasser übergiessen, 10 Minuten warten.', 'Flüssigkeit mit Teststreifen oder pH-Meter messen.'] },
    sauber: { vorgehen: ['Eine Handvoll Gras über einem hellen Blatt schütteln: Bleiben Erde oder Sand liegen?', 'Auf verkrustete Stellen an den Halmen achten, vor allem unten am Stängel.'] },
    kultur: { vorgehen: ['Ein paar Körner aus den Ähren zwischen den Fingern drücken: milchig = Milchreife, teigig = Teigreife, hart = überständig.', 'Leguminosenanteil grob schätzen: Wie viel des Gemenges sind Wicken, Erbsen oder Klee?'] },
    stadium: { vorgehen: ['Im 1. Aufwuchs 10–20 Halme der Leitpflanze (z. B. Knaulgras) anschauen und das häufigste Stadium wählen – nicht die weitesten.', 'Ähre/Rispe sichtbar? Dann mindestens Stadium 3. Staubbeutel sichtbar? Dann Blüte (6).', 'In Konserven: Rispen und Blütenstände im Futter suchen und mit den Bildern vergleichen.'] },
    bestand: { vorgehen: ['Probe auf dem Tisch ausbreiten und grob in Gräser, Klee und Kräuter sortieren.', 'Anteile nach Volumen schätzen – auf 10 % genau reicht.'] },
    'ts.gras': { vorgehen: ['Faustgrosse Probe nehmen, wie ein Waschlappen auswinden (zweimal kräftig).', 'Hände ansehen: Saft tropft? Hände nass, feucht oder trocken?', 'Sehr nasse Silage nur als Kugel drücken, nicht winden.'] },
    'ts.mais': { vorgehen: ['Eine Handvoll fest zusammendrücken und 30 Sekunden halten, nicht auswinden.', 'Hand öffnen: Fliesst Saft, bleibt eine feuchte Kugel oder fällt sie auseinander?'] },
    haecksel: { vorgehen: ['Auswaschmethode: 1 Liter Silage in einem Kessel mit Wasser umrühren; Körner setzen sich ab.', 'Ganze, unbeschädigte Körner zählen bzw. schätzen.', 'Häcksellänge: eine Handvoll ausbreiten und die Partikel mit einem Massstab abschätzen.'] },
  };

  // ---------- Darstellung ----------
  const TRAKTOR = '<svg viewBox="0 0 64 56" width="58" height="51" aria-hidden="true">' +
    '<rect x="4" y="22" width="34" height="16" rx="4" fill="#2f9e5f"/><rect x="30" y="8" width="20" height="24" rx="4" fill="#1f7a49"/>' +
    '<rect x="33" y="11" width="14" height="11" rx="2" fill="#dff3ff"/><circle class="aug" cx="37" cy="16.5" r="1.8" fill="#17221e"/><circle class="aug" cx="43" cy="16.5" r="1.8" fill="#17221e"/>' +
    '<path class="mund" d="M37 20 q3 2.4 6 0" stroke="#17221e" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
    '<rect x="9" y="12" width="3" height="11" rx="1" fill="#4b5a54"/><circle cx="46" cy="40" r="12" fill="#2b2f2d"/><circle cx="46" cy="40" r="5" fill="#f6c35b"/>' +
    '<circle cx="14" cy="44" r="8" fill="#2b2f2d"/><circle cx="14" cy="44" r="3.4" fill="#f6c35b"/><rect x="2" y="27" width="5" height="5" rx="1" fill="#f6c35b"/></svg>';

  let el = null; let offen = false; let aktKey = null;

  function kontext() {
    const A = app(); if (!A) return null;
    const r = A.route();
    if (!r || r.name !== 'probe') return null;
    const p = A.probeById(r.id); if (!p || !p.typ) return r.step === 'probe' || !r.step ? 'probe' : null;
    const step = r.step || 'probe';
    if (step === 'ts') return p.typ === 'mais' ? 'ts.mais' : 'ts.gras';
    if (step === 'rad') { const f = A.radFokus(p); return f ? 'rad.' + (p.typ === 'gps' ? 'gras' : p.typ) + '.' + f : null; }
    return T[step] ? step : null;
  }

  function baue() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'assist';
    el.innerHTML = '<div class="assist-bubble" role="dialog" aria-live="polite" hidden></div><button type="button" class="assist-btn" aria-label="Traktor-Assistent: Hilfe zu diesem Schritt">' + TRAKTOR + '<span class="zz" aria-hidden="true">zZ</span></button>';
    document.body.appendChild(el);
    el.addEventListener('click', klick);
    return el;
  }

  function bubbleHtml(key) {
    const t = T[key]; const A = app();
    const fach = Z.stufe === 'fachlich';
    return '<div class="assist-head"><b>' + A.esc(t.titel) + '</b><button type="button" class="assist-x" data-as="zu" aria-label="Schliessen">×</button></div>' +
      '<div class="assist-text">' + (fach ? t.fachlich : t.einfach) + '</div>' +
      (P[key] && P[key].wie ? '<div class="assist-praxis"><b>Erinnert an</b><p>' + A.esc(P[key].wie) + '</p></div>' : '') +
      (P[key] && P[key].vorgehen ? '<div class="assist-praxis"><b>So gehst du vor</b><ol>' + P[key].vorgehen.map((x) => '<li>' + A.esc(x) + '</li>').join('') + '</ol></div>' : '') +
      (key.startsWith('rad.') && !/\.(regen|blaetter|mist|erde|ph)$/.test(key) ? '<button type="button" class="btn sm block assist-riechen" data-as="riechen">👃 So riechst du richtig</button>' : '') +
      (t.bilder ? '<div class="assist-bilder">' + t.bilder.map((b, i) => '<button type="button" data-as="bild" data-i="' + i + '"><img alt="' + A.esc(b.cap) + '" src="' + b.src + '" loading="lazy"><span>' + A.esc(b.cap) + '</span></button>').join('') + '</div>' : '') +
      '<div class="assist-foot"><div class="seg sm" role="group" aria-label="Sprache"><button type="button" data-as="stufe" data-v="einfach" aria-pressed="' + !fach + '">Einfach</button><button type="button" data-as="stufe" data-v="fachlich" aria-pressed="' + fach + '">Fachlich</button></div>' +
      '<button type="button" class="btn ghost sm" data-as="ruhe">Ruhe, bitte</button></div>';
  }

  let teaserTimer = null;
  /** kurz = nur ein Angebot («Soll ich helfen?»), das beim Antippen aufgeht – verdeckt keine Antworten. */
  function zeigen(key, kurz) {
    baue(); aktKey = key; offen = true; clearTimeout(teaserTimer);
    const b = el.querySelector('.assist-bubble');
    b.innerHTML = kurz ? '<button type="button" class="assist-teaser" data-as="mehr"><b>' + app().esc(T[key].titel) + '</b><span>Soll ich dir helfen? Tipp mich an.</span></button>' : bubbleHtml(key);
    b.classList.toggle('kurz', !!kurz); b.hidden = false;
    el.classList.add('offen');
    if (!Z.gesehen.includes(key)) { Z.gesehen.push(key); merken(); }
    if (kurz) teaserTimer = setTimeout(() => { if (b.classList.contains('kurz')) schliessen(); }, 9000);
  }
  function schliessen() {
    offen = false; clearTimeout(teaserTimer); if (!el) return;
    el.querySelector('.assist-bubble').hidden = true; el.classList.remove('offen');
  }
  // Tippen ausserhalb schliesst die Blase (der Tipp wirkt trotzdem auf das Ziel)
  document.addEventListener('pointerdown', (e) => { if (offen && el && !el.contains(e.target) && !e.target.closest('#sheet-root')) schliessen(); }, true);

  function klick(e) {
    const t = e.target.closest('[data-as], .assist-btn'); if (!t) return;
    if (t.classList.contains('assist-btn')) {
      if (Z.ruhe) { Z.ruhe = false; merken(); el.classList.remove('schlaeft'); }
      if (offen && !el.querySelector('.assist-bubble').classList.contains('kurz')) schliessen(); else if (aktKey) zeigen(aktKey);
      return;
    }
    const a = t.dataset.as;
    if (a === 'zu') schliessen();
    if (a === 'mehr') zeigen(aktKey);
    if (a === 'stufe') { Z.stufe = t.dataset.v; merken(); zeigen(aktKey); }
    if (a === 'ruhe') { Z.ruhe = true; merken(); schliessen(); el.classList.add('schlaeft'); app().toast('Der Traktor schläft. Antippen weckt ihn wieder.'); }
    if (a === 'riechen') {
      app().sheet('<h2>So riechst du richtig</h2><ol class="assist-liste">' + P.riechen.vorgehen.map((x) => '<li>' + app().esc(x) + '</li>').join('') + '</ol><button class="btn primary block" data-close style="margin-top:12px">Verstanden</button>');
      return;
    }
    if (a === 'bild') {
      const b = T[aktKey].bilder[Number(t.dataset.i)];
      app().sheet('<h2>' + app().esc(b.cap) + '</h2><img class="foto-gross" alt="' + app().esc(b.cap) + '" src="' + b.src + '"><p class="small muted">Quelle: AGFF / AGRIDEA</p><button class="btn ghost block" data-close style="margin-top:10px">Schliessen</button>');
    }
  }

  /** Nach jedem Rendern aufrufen: Traktor ein-/ausblenden, beim ersten Besuch selbst melden. */
  function update() {
    const key = kontext();
    if (!key || !T[key]) { if (el) { el.hidden = true; schliessen(); } aktKey = null; return; }
    baue(); el.hidden = false; el.classList.toggle('schlaeft', Z.ruhe);
    const wechsel = key !== aktKey;
    aktKey = key;
    if (offen && wechsel) schliessen();
    if (wechsel && !Z.ruhe && !Z.gesehen.includes(key)) zeigen(key, true);
  }

  global.Assistent = {
    update, TEXTE: T,
    get ruhe() { return Z.ruhe; },
    set ruhe(v) { Z.ruhe = !!v; merken(); if (el) el.classList.toggle('schlaeft', Z.ruhe); if (Z.ruhe) schliessen(); },
    get stufe() { return Z.stufe; },
    set stufe(v) { Z.stufe = v === 'fachlich' ? 'fachlich' : 'einfach'; merken(); if (offen && aktKey) zeigen(aktKey); },
    zuruecksetzen() { Z.gesehen = []; merken(); },
  };
})(window);
