/* Futter v2 – Beratung nach der Beurteilung (konserviertes Futter): häufige Fragen mit Ursachen und Massnahmen,
 * passend zur Probe sortiert; wenn die Antwort fehlt, die kantonale Fachstelle nach PLZ.
 *
 * Feste Texte aus AGFF K4b (Silage), ADCF/AGRIDEA 2.7.9 und 12.4 (Dürrfutter, übersetzt) und den Schlüsseln K3a–c – keine KI.
 * Die PLZ bleibt auf dem Gerät; die Zuordnung PLZ → Kanton läuft im Browser.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const LR = () => global.LaborRegeln;
  const esc = (s) => app().esc(s);
  const PLZ_KEY = 'agffV2BeratungPlz';
  /** Übersetzung (fr/it) der im Traktor gewählten Sprache, sonst null = Deutsch */
  const FR = () => { const s = global.Assistent && global.Assistent.sprache; return (s === 'fr' && global.AssistentFR) || (s === 'it' && global.AssistentIT) || null; };
  const LA = () => (FR() ? ' lang="' + global.Assistent.sprache + '"' : '');
  const UD = {
    passendProbe: 'Zu deiner Probe passen diese Fragen:', passendAufnahme: 'Zu deiner Aufnahme passen diese Fragen:', keineMaengel: 'Keine grösseren Mängel – trotzdem eine Frage?',
    weitere: 'Weitere Fragen', nichtGefunden: 'Antwort nicht gefunden? Fachstelle in deiner Region',
    ursachen: 'Häufige Ursachen', fuetterung: 'Für die Fütterung', inAufnahme: 'In deiner Aufnahme', tun: 'Was du tun kannst', quelle: 'Quelle', nochFragen: 'Noch Fragen? Fachstelle', danke: 'Danke',
    fsTitel: 'Fachstelle in deiner Region', plz: 'PLZ', suchen: 'Suchen', keinKanton: 'Zu dieser PLZ kenne ich keinen Kanton.',
    kanton: (kt) => 'Kanton ' + kt + ' – die kantonale landwirtschaftliche Beratung hilft bei Fragen zu Futterbau, Wiesenpflege und Futterkonservierung.',
    keineStelle: 'Für diesen Kanton ist noch keine Fachstelle hinterlegt.', plzEingeben: 'Gib deine PLZ ein, dann zeige ich die zuständige Fachstelle.',
    plzLokal: 'Die PLZ bleibt auf diesem Gerät.', stand: null, website: 'Website', offline: 'Die Liste der Fachstellen ist offline nicht verfügbar.', hinweise: {},
  };
  const U = () => (FR() ? FR().U : UD);
  /** Frage in der aktuellen Sprache (fehlende Teile auf Deutsch) */
  function frageText(k) {
    const f = F[k]; const fr = FR() && FR().F[k];
    const t = fr ? Object.assign({}, f, fr) : Object.assign({}, f);
    t.mass = f.mk ? ((FR() && FR().M[f.mk]) || LR().M[f.mk]) : (t.massnahmen || []);
    return t;
  }

  const QK4B = 'AGFF-Informationsblatt K4b «Interpretation der Silagebewertung» (2024)';
  const Q279 = 'ADCF/AGRIDEA-Fiche 2.7.9 «Verbesserung der Trocknungsprozesse» (2021), übersetzt';
  const Q124 = 'ADCF/AGRIDEA-Fiche 12.4 «Heubelüftung – Checkliste zur Kontrolle einer Anlage» (2025), übersetzt';
  const QK3 = 'AGFF-Schlüssel K3a–K3c zur Beurteilung von Dürrfutter, Grassilage und Maissilage';
  const QMB8 = 'AGFF-Merkblatt 8 «Beurteilung von Wiesenbeständen» (2012), Tabellen 3 und 4';
  const QMB3 = 'AGFF-Merkblatt 3 «Bewertung von Wiesenfutter» (botanischer Typ)';
  const AU = () => global.Aufnahme && global.Aufnahme._t;
  /** Massnahmen aus MB 8 Tabelle 3 für Arten der Aufnahme (ab 5 %), gefiltert */
  const t3Fuer = (au, filter) => (au ? au.arten.filter((x) => x.p >= 5 && AU().T3[x.n] && filter(x)).map((x) => { const fr = FR() && FR().T3[x.n];
    return fr ? fr[0] + ' (' + x.p + ' %) : ' + fr[1] : x.n + ' (' + x.p + ' %): ' + AU().T3[x.n][0]; }) : []);

  // ---------- Fragen ----------
  // art: 'silage' (Gras-, Mais-, Ganzpflanzensilage) oder 'heu'. massnahmen: Liste oder Funktion (dann aus LaborRegeln.M).
  const F = {
    butter: { art: 'silage', frage: 'Warum riecht meine Silage nach Buttersäure?',
      kurz: 'Buttersäurebakterien (Clostridien) kommen mit Erde, Mist und Gülle ins Futter. In nasser, zuckerarmer Silage, die zu langsam sauer wird (pH über 4,5), bauen sie Milchsäure zu Buttersäure ab.',
      ursachen: ['Erde, Mist oder Gülle im Futter (Maulwurfshaufen, tiefer Schnitt, schmutzige Reifen)', 'Zu nass siliert (unter 30 % TS), wenig Zucker (klee- und kräuterreich)', 'Silieren bei über 30 °C, schwer silierbares Futter'],
      ration: 'Nur begrenzt und sauber entnommen verfüttern. Sporen gelangen über Kot in die Milch – nicht für Käsereimilch.',
      mk: 'buttersaeure', quelle: [QK4B, QK3] },
    essig: { art: 'silage', frage: 'Warum riecht sie stechend nach Essig?',
      kurz: 'Die Silage ist zu langsam sauer geworden, oft weil Luft drin war. Etwas Essigsäure schützt vor Nacherwärmung, viel davon kostet Trockenmasse und Schmackhaftigkeit.',
      ursachen: ['Nass siliert oder schlecht verdichtet – faseriges Futter lässt sich schwer verdichten', 'Zu schnell eingeführt, dicke Schichten', 'Silo nicht sofort luftdicht verschlossen'],
      mk: 'essig', quelle: [QK4B, QK3] },
    alkohol: { art: 'silage', frage: 'Warum riecht sie nach Alkohol oder Most?',
      kurz: 'Hefen vergären Zucker zu Alkohol. Das passiert bei sehr zuckerreichem Futter (Mais, Raigras, Grünschnittroggen), wenn beim Schliessen noch Luft im Silo ist. Oft folgt beim Öffnen Nacherwärmung.',
      ursachen: ['Luft im Silo beim Schliessen (lockere Lagerung, Folie nicht sofort dicht)', 'Silomais zu trocken geerntet (über 36 % TS)', 'Zu wenig Vorschub bei der Entnahme'],
      massnahmen: ['Silomais bei 32–36 % TS silieren', 'Verdichtung über 220 kg TS/m³ (über 700 kg Frischmasse/m³)', 'Silo nach dem Füllen sofort luftdicht schliessen', 'Genügend Vorschub bei der Entnahme'], quelle: [QK4B] },
    erwaermung: { art: 'silage', frage: 'Warum wird die Silage warm (Nacherwärmung)?',
      kurz: 'Sobald Luft an die Silage kommt, bauen Hefen Zucker und Milchsäure ab und erzeugen Wärme. Energie geht verloren, danach folgt oft Schimmel.',
      ursachen: ['Silo zu früh geöffnet oder zu wenig Vorschub', 'Anschnittfläche locker oder ausgefranst', 'Trockenes, schlecht verdichtetes Futter; undichte Folie'],
      ration: 'Täglich frisch entnehmen, warme Stellen verwerfen, rasch verfüttern.',
      mk: 'nacherw', quelle: [QK4B, QK3] },
    schimmel: { art: 'silage', frage: 'Warum schimmelt die Silage?',
      kurz: 'Schimmelpilze wachsen nur mit Sauerstoff: an undichten Stellen, unter beschädigter Folie, in locker verdichteten Schichten und an der Anschnittfläche. Manche bilden Mykotoxine.',
      ursachen: ['Silo oder Ballen nicht luft- und wasserdicht', 'Zu trocken siliert (Hoch-/Fahrsilo über 36 % TS, Ballen über 55 % TS)', 'Silagetemperatur über 20 °C, pH über 4,5 (Gras) bzw. 4,0 (Mais)'],
      ration: 'Verschimmelte Teile grosszügig entfernen und nicht verfüttern. Sporen nicht einatmen.',
      massnahmen: ['Silo, Türen, Deckel, Siphon und Folien regelmässig auf Löcher prüfen', 'Ballenfolie über 250 µm, 6–8 Lagen; Folienqualität prüfen', 'Im Fahrsilo Unterziehfolie (40 µm), Randfolie an den Wänden und Sandsäcke', 'Gras und Mais über 36 % TS nicht in Hoch- oder Fahrsilos; Ballen höchstens 55 % TS', 'Verdichtung über 220 kg TS/m³; evtl. Siliermittel der Liste B'], quelle: [QK4B] },
    ph: { art: 'silage', frage: 'Warum ist der pH-Wert zu hoch?',
      kurz: 'Die Milchsäuregärung war zu schwach: zu wenig Zucker, zu viel Eiweiss, zu nass oder zu trocken, oder Luft im Silo. Je nasser die Silage, desto tiefer muss der pH sein.',
      ursachen: ['Zuckermangel, Eiweissüberschuss (klee- und kräuterreich)', 'Zu nass oder zu trocken (pH-Pufferung)', 'Ungenügend luftdicht; Buttersäuregärung oder Schimmel'],
      mk: 'ph', quelle: [QK4B, QK3] },
    anwelken: { art: 'silage', frage: 'Wie stark soll ich anwelken?',
      kurz: 'Ziel-TS je nach Lagerung: Grassilage im Hoch- und Fahrsilo 30–35 % (höchstens 36 %), Siloballen über 40 % (höchstens 55 %), Silomais 32–36 %, Ganzpflanzensilage 35–40 %.',
      ursachen: [], massnahmen: ['TS mit der Auswringprobe prüfen (Rückseite der Messkarte)', 'Raigrasschwache Bestände über 30 % TS anwelken', 'Spätestens bei Beginn Ährenschieben der Hauptgräser mähen'], quelle: [QK4B] },
    verdichten: { art: 'silage', frage: 'Wie gut muss ich verdichten?',
      kurz: 'Mindestens 220 kg TS/m³ (über 700 kg Frischmasse/m³). Je trockener und länger das Futter, desto schwieriger.',
      ursachen: [], massnahmen: ['Häcksellänge Gras und GPS unter 5 cm, Mais etwa 0,8 cm', 'Im Fahrsilo höchstens 30 cm pro Schicht; mindestens drei Überfahrten über die ganze Fläche vor dem nächsten Wagen', 'Silo sofort luftdicht schliessen; frühestens nach 4–6 Wochen öffnen', 'Vorschub: mindestens 2 m pro Woche im Sommer, 1 m im Winter'], quelle: [QK4B] },
    erdeSilage: { art: 'silage', frage: 'Wie halte ich Erde aus der Silage?',
      kurz: 'Erde erhöht die Rohasche (sauber: 80–100 g/kg TS), kostet Energie und bringt Buttersäurebakterien.',
      ursachen: ['Zu tiefer Schnitt, Zetter und Schwader zu tief', 'Maulwurfs- und Wühlmaushaufen', 'Schmutzige Reifen im Fahrsilo, nasser Boden'],
      massnahmen: ['Schnitthöhe 8–10 cm einhalten', 'Wühlmäuse bekämpfen, Wiesen im Frühling eggen oder walzen', 'Nur mit sauberen Reifen ins Fahrsilo fahren', 'Gülle vor Regen ausbringen bzw. verdünnen'], quelle: [QK4B] },

    heuBraun: { art: 'heu', frage: 'Warum ist das Heu braun oder riecht nach Karamell?',
      kurz: 'Das Heu hat sich auf dem Stock erwärmt, weil es zu langsam trocknete (4–15 Tage mit Erwärmung). Leicht erwärmt ist noch in Ordnung, stark erwärmt kostet Energie und Eiweiss.',
      ursachen: ['Zu feucht eingeführt (unter 60 % TS) oder zu hohe Füllung pro Tag', 'Gepresste Klumpen im Stock', 'Zu wenig oder zu feuchte Luft in der Belüftung'],
      mk: 'heuStock', quelle: [Q279, Q124] },
    heuSchimmel: { art: 'heu', frage: 'Warum staubt oder schimmelt das Heu?',
      kurz: 'Das Futter wurde erst nach mehreren Wochen trocken. Es ist grau, weisslich bis bläulich, staubig und riecht muffig. Nicht verfüttern – Mykotoxine und Staub schaden Tier und Mensch.',
      ursachen: ['Zu feucht gelagert, Trocknung zu langsam', 'Feuchtigkeit über Dach, Wände oder Boden; Kondenswasser', 'Ballen zu fest gepresst oder zu früh gestapelt'],
      ration: 'Nicht verfüttern. Beim Umgang Staubmaske tragen.',
      massnahmen: ['Nur mähen, wenn 3 Sonnentage sicher sind', 'Pro Tag höchstens 1 m einführen (erste Füllung 2 m), Klumpen auflösen', 'Fertig belüftet erst, wenn die Luft über dem Stock unter 50 % relative Feuchte hat', 'Gebäude gegen Feuchtigkeit schützen, Wände und Boden isolieren'], quelle: [Q279, Q124] },
    heuBleich: { art: 'heu', frage: 'Warum sind die Blätter ausgebleicht?',
      kurz: 'Das Futter lag lange in Sonne oder Regen. Das kostet Energie, Eiweiss und Vitamine. Je kürzer die Feldzeit, desto grüner das Heu.',
      ursachen: ['Lange Bodentrocknung, Regen auf dem Feld', 'Kein Aufbereiter, spät breit gestreut'],
      mk: 'heuFeld', quelle: [Q279, QK3] },
    heuBlaetter: { art: 'heu', frage: 'Warum fehlen die Blätter von Klee und Kräutern?',
      kurz: 'Bröckelverluste: Blätter von Klee und Kräutern brechen ab, wenn das trockene Futter zu oft oder zu heftig bearbeitet wird.',
      ursachen: ['Zetten und Schwaden bei trockenem Futter (ab etwa 60 % TS), mittags', 'Kreiselzetter bei viel Leguminosen'],
      massnahmen: ['Am ersten Tag intensiv zetten und schwaden, danach nur noch, solange die Blätter weich sind', 'Evtl. am letzten Tag das Schwad mit dem Tau umlegen (ohne Zetter)', 'Bei viel Leguminosen Walzenaufbereiter bevorzugen'], quelle: [Q279, QK3] },
    heuErde: { art: 'heu', frage: 'Wie halte ich Erde aus dem Heu?',
      kurz: 'Erde erhöht die Rohasche, verdünnt die Energie und bringt Keime und Sporen ins Futter.',
      ursachen: ['Maschinen zu tief eingestellt', 'Wühlmaus- und Maulwurfshaufen, Mistreste', 'Lückige Grasnarbe; Tau, der die Erde ankleben lässt'],
      mk: 'heuErde', quelle: [Q279] },
    heuStock: { art: 'heu', frage: 'Mein Heu trocknet auf dem Stock zu langsam – was prüfen?',
      kurz: 'Ziel: in höchstens 3 Tagen trocken. Die wichtigsten Richtwerte der Checkliste Heubelüftung:',
      ursachen: [],
      massnahmen: ['Luftmenge 0,11 m³ je m² Boxenfläche und Sekunde (0,07–0,14); Frequenzumformer hält sie konstant', 'Druck unter dem Stock 1–1,5 hPa je m Füllhöhe; er muss während der Trocknung sinken', 'Roste 50 cm hoch (unter 35 cm ungleichmässig), Lattenabstand höchstens 10 cm; Stockhöhe unter 5 m', 'Höchstens 2 m Füllhöhe pro Tag; 5–7 ha je 100 m² Box', 'Eingeblasene Luft unter 55 % relative Feuchte; Abluft nicht wieder ansaugen', 'Dachabsorber mindestens 5-mal so gross wie die Box; Heizung nie über 40 °C'], quelle: [Q124] },
    heuBallen: { art: 'heu', frage: 'Meine Heuballen werden warm – was tun?',
      kurz: 'Bodenheu muss auf dem Feld weit genug trocknen und die Ballen brauchen Luft, bis sie «ausgeschwitzt» haben.',
      ursachen: ['Zu früh gepresst, Ballenkern zu dicht', 'Ballen zu früh gestapelt oder eingelagert'],
      mk: 'heuBallen', quelle: [Q279] },
    // --- Wiese (MB 8) ---
    luecken: { art: 'wiese', frage: 'Meine Wiese hat Lücken – was tun?',
      kurz: 'Lücken füllen sich sonst mit geringwertigen Arten und Unkräutern (Gewöhnliches Rispengras, Hirsen, Weiche Trespe, Blacken, Disteln). Ab 5 % Lücken lohnt sich eine Übersaat, ab etwa 25 % ist auch eine Neuansaat zu prüfen.',
      ursachen: ['Übernutzung und Bodenverdichtung (Zeiger: Ausläufer-Straussgras, Breitwegerich, Gänseblümchen)', 'Lückenfüller und Unkräuter breiten sich aus und halten die Lücken offen'],
      massnahmen: ['Lücken bis etwa 25 %: Übersaat mit standortangepassten Futtergräsern (AGFF-Merkblatt 5)', 'Ab etwa 25 %: Übersaat oder Neuansaat prüfen (AGFF-Merkblätter 4, 5, 7, 12)', 'Ursache abstellen: bodenschonend und weniger intensiv nutzen (Tabelle 3)'],
      extra: (au) => t3Fuer(au, (x) => /Lücken/.test(AU().T3[x.n][1])), quelle: [QMB8] },
    unkraut: { art: 'wiese', frage: 'Unkräuter oder Giftpflanzen – wie zurückdrängen?',
      kurz: 'Die beste Vorbeugung ist eine dichte Grasnarbe mit wertvollen Futtergräsern. Giftpflanzen wie Kreuzkräuter, Herbst-Zeitlose oder Sumpf-Schachtelhalm gehören nicht ins Futter.',
      ursachen: ['Lücken (Samen keimen im offenen Boden)', 'Überdüngung oder Ansammlung von Ausscheidungen (Blacken, Brennnesseln)', 'Späte oder zu seltene Nutzung'],
      massnahmen: ['Dichte Grasnarbe fördern, Lücken übersäen', 'Samenbildung verhindern; Einzelpflanzen ausstechen oder ausgraben', 'Regulierung nach AGFF-Merkblatt 4'],
      extra: (au) => t3Fuer(au, (x) => x.kat === 'uk'), quelle: [QMB8] },
    kraeuter: { art: 'wiese', frage: 'Zu viele grobe Kräuter (Kerbel, Bärenklau, Hahnenfuss)?',
      kurz: 'Grobstänglige Kräuter liefern wässriges, nährstoffarmes Futter, verursachen Bröckelverluste und hinterlassen Lücken. Meist zeigen sie Überdüngung oder späte Nutzung an.',
      ursachen: ['Zu viel Gülle bzw. Stickstoff', 'Späte Nutzung, Versamung', 'Lückige Narbe'],
      massnahmen: ['Weniger düngen', 'Im Frühling beweiden, früher nutzen', 'In Verbindung mit Übersaaten Futtergräser fördern'],
      extra: (au) => t3Fuer(au, (x) => x.kat === 'gk'), quelle: [QMB8] },
    filz: { art: 'wiese', frage: 'Der Bestand ist verfilzt – was hilft?',
      kurz: 'Filzbildende Gräser wie Gewöhnliches Rispengras oder Ausläufer-Straussgras bringen Ertrag fast nur im ersten Aufwuchs und werden vom Vieh verschmäht.',
      ursachen: ['Lücken, die sich mit Lückenfüllern schliessen', 'Verdichtung, Übernutzung'],
      massnahmen: ['Filz mechanisch aufreissen (Striegel) und gleichzeitig übersäen', 'Bodenschonend und weniger intensiv nutzen; Umtriebs- statt Standweide'],
      extra: (au) => t3Fuer(au, (x) => x.kat === 'gg'), quelle: [QMB8] },
    futtergraeser: { art: 'wiese', frage: 'Zu wenig wertvolle Futtergräser – wie fördern?',
      kurz: 'Ziel sind meist 50–70 % Futtergräser, 10–30 % Klee und 10–30 % Futterkräuter. Durch die Förderung angepasster, wertvoller Gräser werden geringwertige Arten in der Regel zurückgedrängt.',
      ursachen: [],
      massnahmen: ['Leitgräser passend zu Standort und Nutzung wählen (Raigrasfähigkeit beachten)', 'Fehlende Arten durch Übersaat etablieren (AGFF-Merkblatt 5)', 'Nutzung und Düngung auf die gewünschten Gräser abstimmen (Tabelle 4)'],
      extra: (au) => (au ? au.ziel.foerdern.filter((n) => AU().T4[n]).map((n) => { const fr = FR() && FR().T4[n]; return fr ? fr[0] + ' : ' + fr[1] : n + ': ' + AU().T4[n][0]; }) : []), quelle: [QMB8, QMB3] },
    raigras: { art: 'wiese', frage: 'Passt Raigras zu meinem Standort?',
      kurz: 'Raigrasfähig sind milde, sonnige, früh schneefreie Lagen: rauhe Lagen bis 700 m, milde bis 900 m (Englisches Raigras bis 1000 m), mittelschwere durchlässige Böden bei 900–1200 mm Niederschlag, P und K mässig bis genügend.',
      ursachen: [],
      massnahmen: ['Englisches Raigras: Weide, Mähweide oder Mähwiese mit Frühlingsweide', 'Italienisches Raigras: Mähwiese, höchstens fünf Schnitte, gelegentlich versamen lassen', 'Nicht raigrasfähig: andere Leitgräser wählen, z. B. Wiesenfuchsschwanz (ertragreich auch in nicht raigrasfähigen Lagen)'],
      extra: (au) => (au ? (FR() ? FR().raigrasHinweis(au) : AU().raigrasHinweis(au).t) : []), quelle: [QMB8] },

    mist: { art: 'beide', frage: 'Es hat Mist- oder Güllereste im Futter – was nun?',
      kurz: 'Hofdünger bringt Keime (Clostridien, Listerien, E. coli) ins Futter und mindert die Schmackhaftigkeit. Futter mit sichtbaren Rückständen nicht verfüttern.',
      ursachen: ['Gülle kurz vor der Ernte oder zu dick ausgebracht', 'Mist schlecht verteilt'],
      massnahmen: ['Gülle vor Regen ausbringen, damit sie eingewaschen wird; dicke Gülle verdünnen oder einschlitzen', 'Gülle früh nach dem Schnitt ausbringen, nicht kurz vor der Ernte', 'Mistreste im Frühling eggen'], quelle: [QK4B, QK3] },
  };

  // ---------- Was passt zur Probe? ----------
  function relevantBeurteilung(p) {
    const A = app(); const r = A.auswertung(p) || {}; const s = r.auswahl || {}; const an = p.antworten || {}; const k = new Set();
    if (p.typ === 'heu') {
      if (s.geruch === 'erw_stark' || s.farbe === 'braun') k.add('heuBraun');
      if (/^muff_/.test(s.geruch) || s.farbe === 'mehrf' || s.staub === 'schimmel') k.add('heuSchimmel');
      if (s.farbe === 'leicht' || s.farbe === 'verbl' || /^tag/.test(s.regen)) k.add('heuBleich');
      if (s.blaetter === 'fehlen') k.add('heuBlaetter');
      if (s.erde === 'partikel') k.add('heuErde');
      if (s.mist === 'spuren') k.add('mist');
    } else {
      const pts = (id) => { const v = s[id]; const m = v && /^p(\d+)$/.exec(v); return m ? Number(m[1]) : 0; };
      ['essig', 'alkohol', 'erwaermung', 'butter', 'schimmel'].forEach((id) => { if (pts(id) > 0) k.add(id); });
      if (pts('ph') > 0) k.add('ph');
      if (pts('farbe') >= 4) k.add(pts('butter') ? 'butter' : 'erwaermung');
      if (an.sauberkeit && an.sauberkeit !== 'sauber') k.add('erdeSilage');
      if (an.ts === 'lt20' || an.ts === 'gt45') k.add('anwelken');
    }
    return [...k];
  }
  function relevantLabor(lp) {
    const a = LR().auswerten(lp); const k = new Set(); const heu = a.art === 'duerr';
    a.befunde.forEach((b) => {
      if (b.id === 'fehlgaerung') k.add(lp.werte.bs && lp.werte.bs.v > 3 ? 'butter' : 'ph');
      if (b.id === 'erde') k.add(heu ? 'heuErde' : 'erdeSilage');
      if (b.id === 'essig') k.add('essig');
      if (b.id === 'nacherw') k.add('erwaermung');
      if (b.id === 'trocken') { k.add('anwelken'); k.add('verdichten'); }
      if (b.id === 'eiweiss') k.add('anwelken');
      if (b.id === 'lager') { k.add(/unbel|boden/i.test(lp.meta.belueftung || '') ? 'heuBallen' : 'heuStock'); k.add('heuSchimmel'); }
    });
    return { art: heu ? 'heu' : a.art === 'silage' ? 'silage' : null, keys: [...k] };
  }
  function relevantAufnahme(au) {
    const e = AU().auswerten(au); const k = new Set(); const b = au.beurteilung;
    if (au.luecken != null && au.luecken >= 5) k.add('luecken');
    if ((e.unkraut || 0) > 0 || b.verunkrautung === 'mittel' || b.verunkrautung === 'stark') k.add('unkraut');
    if (au.arten.some((x) => x.kat === 'gk' && x.p >= 5)) k.add('kraeuter');
    if (b.verfilzung === 'mittel' || b.verfilzung === 'stark' || au.arten.some((x) => x.kat === 'gg' && x.p >= 10)) k.add('filz');
    if (e.fg != null && e.fg < 50) k.add('futtergraeser');
    if (au.standort.raigras || au.kopf.hoehe != null) k.add('raigras');
    return [...k];
  }
  function kontextDaten(ctx) {
    if (ctx.aufnahme) return { art: 'wiese', keys: relevantAufnahme(ctx.aufnahme).sort((x, y) => ORDNUNG.indexOf(x) - ORDNUNG.indexOf(y)), plz: null };
    const sort = (l) => l.sort((x, y) => ORDNUNG.indexOf(x) - ORDNUNG.indexOf(y));
    if (ctx.labor) { const r = relevantLabor(ctx.labor); return { art: r.art, keys: sort(r.keys), plz: null }; }
    const p = ctx.probe; return { art: p.typ === 'heu' ? 'heu' : 'silage', keys: sort(relevantBeurteilung(p)), plz: p.kopf && p.kopf.plz };
  }
  const passt = (art) => (f) => (f.art === 'beide' && art !== 'wiese') || f.art === art;
  const ORDNUNG = Object.keys(F);

  // ---------- Darstellung ----------
  /** Inhalt der Traktor-Blase nach der Analyse */
  function bubble(ctx) {
    const d = kontextDaten(ctx); if (!d.art) return '';
    const rest = Object.keys(F).filter((k) => passt(d.art)(F[k]) && !d.keys.includes(k));
    const u = U();
    const knopf = (k, hl) => '<li><button type="button" class="ber-frage' + (hl ? ' hl' : '') + '" data-as="frage" data-k="' + k + '">' + esc(frageText(k).frage) + '</button></li>';
    return '<div class="assist-text">' + (d.keys.length ? (ctx.aufnahme ? u.passendAufnahme : u.passendProbe) : u.keineMaengel) + '</div>' +
      (d.keys.length ? '<ul class="ber-liste">' + d.keys.map((k) => knopf(k, true)).join('') + '</ul>' : '') +
      (rest.length ? '<details class="ber-mehr"' + (d.keys.length ? '' : ' open') + '><summary>' + u.weitere + ' (' + rest.length + ')</summary><ul class="ber-liste">' + rest.map((k) => knopf(k, false)).join('') + '</ul></details>' : '') +
      '<button type="button" class="btn sm block" data-as="fachstelle" style="margin-top:8px">' + esc(u.nichtGefunden) + '</button>';
  }

  function frageSheet(k, ctx) {
    if (!F[k]) return;
    const f = frageText(k); const u = U(); const m = f.mass;
    const ex = f.extra && ctx && ctx.aufnahme ? f.extra(ctx.aufnahme) : [];
    app().sheet('<h2' + LA() + '>' + esc(f.frage) + '</h2><div' + LA() + '><p>' + esc(f.kurz) + '</p>' +
      (f.ursachen.length ? '<h3 class="ber-h">' + u.ursachen + '</h3><ul class="ber-punkte">' + f.ursachen.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      (f.ration ? '<h3 class="ber-h">' + u.fuetterung + '</h3><p class="small">' + esc(f.ration) + '</p>' : '') +
      (ex.length ? '<h3 class="ber-h">' + u.inAufnahme + '</h3><ul class="ber-punkte">' + ex.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      (m.length ? '<h3 class="ber-h">' + u.tun + '</h3><ul class="ber-punkte ber-mass">' + m.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      '<p class="small muted">' + u.quelle + (global.Assistent && global.Assistent.sprache === 'fr' ? ' : ' : ': ') + f.quelle.map(esc).join('; ') + '</p></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn grow" data-ber="fachstelle">' + esc(u.nochFragen) + '</button><button class="btn primary grow" data-close>' + u.danke + '</button></div>');
    const root = document.getElementById('sheet-root');
    const b = root && root.querySelector('[data-ber="fachstelle"]'); if (b) b.addEventListener('click', () => fachstelle(ctx));
  }

  // ---------- Fachstelle nach PLZ ----------
  let PLZ = null; let FS = null;
  async function daten() {
    if (!PLZ) PLZ = await fetch('assets/plz-kanton.json').then((r) => r.json());
    if (!FS) FS = await fetch('assets/fachstellen.json').then((r) => r.json());
  }
  function kanton(plz) {
    const n = Number(plz); if (!PLZ || !(n >= 1000 && n <= 9999)) return null;
    let best = null; let dist = Infinity;
    for (const [von, bis, k] of PLZ.bereiche) {
      const d = n < von ? von - n : n > bis ? n - bis : 0;
      if (d < dist) { dist = d; best = k; } if (d === 0) break;
    }
    return dist <= 20 ? best : null;
  }
  const merkePlz = (v) => { try { localStorage.setItem(PLZ_KEY, v); } catch (e) { /* egal */ } };
  const gemerktePlz = () => { try { return localStorage.getItem(PLZ_KEY) || ''; } catch (e) { return ''; } };

  async function fachstelle(ctx, plzEingabe) {
    const A = app();
    const u = U();
    try { await daten(); } catch (e) { A.toast(u.offline, { fehler: true }); return; }
    const d = ctx ? kontextDaten(ctx) : {}; const plz = plzEingabe || d.plz || gemerktePlz();
    const kt = plz ? kanton(plz) : null;
    const eintraege = kt ? FS.stellen.filter((s) => s.kantone.includes(kt)) : [];
    const karte = (s) => '<div class="card ber-stelle"><b>' + esc(s.name) + '</b>' + (s.hinweis ? '<p class="small muted">' + esc(u.hinweise[s.hinweis] || s.hinweis) + '</p>' : '') +
      '<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:6px">' + (s.telefon ? '<a class="btn sm" href="tel:' + esc(s.telefon.replace(/[^+\d]/g, '')) + '">☎ ' + esc(s.telefon) + '</a>' : '') +
      (s.email ? '<a class="btn sm" href="mailto:' + esc(s.email) + '">✉ ' + esc(s.email) + '</a>' : '') +
      '<a class="btn sm" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + u.website + ' ↗</a></div></div>';
    A.sheet('<h2>' + u.fsTitel + '</h2>' +
      '<form class="row ber-plz" data-ber="plz" style="gap:8px;align-items:flex-end"><label class="grow">' + u.plz + '<input name="plz" inputmode="numeric" pattern="\\d{4}" maxlength="4" value="' + esc(plz || '') + '" autocomplete="postal-code"></label><button class="btn">' + u.suchen + '</button></form>' +
      (plz && !kt ? '<p class="small">' + u.keinKanton + '</p>' : '') +
      (kt ? '<p class="small muted">' + esc(u.kanton(kt)) + '</p>' + (eintraege.length ? eintraege.map(karte).join('') : '<p>' + u.keineStelle + '</p>') : '') +
      (!plz ? '<p class="small">' + u.plzEingeben + '</p>' : '') +
      '<p class="small muted" style="margin-top:10px">' + u.plzLokal + ' ' + esc(u.stand || FS.stand || '') + '</p>' +
      '<button class="btn ghost block" data-close style="margin-top:6px">' + (FR() ? FR().U.schliessen : 'Schliessen') + '</button>');
    const f = document.querySelector('#sheet-root form[data-ber="plz"]');
    if (f) f.addEventListener('submit', (e) => { e.preventDefault(); const v = String(new FormData(f).get('plz') || '').trim(); if (/^\d{4}$/.test(v)) { merkePlz(v); fachstelle(ctx, v); } });
  }

  global.Beratung = { bubble, frageSheet, fachstelle, FRAGEN: F, _t: { kanton, daten, relevantBeurteilung, relevantLabor, relevantAufnahme } };
})(window);
