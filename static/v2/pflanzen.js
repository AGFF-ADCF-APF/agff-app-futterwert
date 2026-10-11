/* Futter v2 – Pflanzen bestimmen nach den AGFF-Bestimmungsschlüsseln (edition lmz, 2016), ohne KI:
 * Gräser vegetativ, Gräser ab Beginn Rispenschieben, Leguminosen vegetativ, Kräuter vegetativ.
 * Vorgehen wie auf dem Schlüssel: Spalte (Hauptmerkmal) → quer geschriebene Kriterien → Art mit Detailbeschreibung.
 * Texte aus den Schlüsseln übernommen. Die Kategorie für das Punktraster (Raigras, Gras, Klee, Kraut fein/grob)
 * ist eine Zuordnung dieser App, nicht Teil der Schlüssel.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const esc = (s) => app().esc(s);

  const KAT = { rg: 'Raigras', gr: 'andere Gräser', kl: 'Klee', kf: 'Kraut fein', kg: 'Kraut grob' };
  const svg = (inner) => '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  const SYM = {
    v: { t: 'Jüngstes Blatt gefaltet', i: svg('<path d="M6 5 L12 19 L18 5"/>') },
    o: { t: 'Jüngstes Blatt gerollt', i: svg('<path d="M12 12 m-2.5 0 a2.5 2.5 0 1 0 5 0 a5 5 0 1 0 -10 0 a7.5 7.5 0 1 0 15 0"/>') },
  };

  // Art: n Name, d Detailbeschreibung (Schlüssel), s Symbol v/o, o Vorkommen, k Kategorie Raster, g giftig
  const A = (n, d, k, x) => Object.assign({ n, d, k }, x || {});

  const GRAS_V = {
    id: 'gv', titel: 'Gräser vegetativ', quelle: 'AGFF-Schlüssel zur Bestimmung der wichtigsten Wiesengräser im vegetativen Zustand',
    hinweis: 'Nur junge, gut entwickelte Exemplare mit 2 bis 4 Blättern lassen sich sicher bestimmen. Sobald als möglich den Blütenstand frei machen und mit dem Schlüssel ab Beginn Rispenschieben arbeiten.',
    reihenfolge: 'Immer von oben nach unten prüfen (auf dem Schlüssel: von links nach rechts) – die erste Spalte, die zutrifft, gilt.',
    lupe: 'Blattgrund, Blatthäutchen und Öhrchen: Blattspreite leicht vom Halm wegbiegen und gegen das Licht halten.',
    kinder: [
      { nr: '1a', t: 'Blätter borstenförmig', s: '< 2 mm breit', kinder: [
        { t: 'Blätter gelbgrün, schlaff, dünn, Unterseite glänzend', arten: [A('Gemeines Rispengras', 'Blätter leicht konisch, schlaff, gelbgrün. Doppelrille mit Lupe erkennbar. Im ersten Schnitt obere Blätter breiter.', 'gr', { s: 'v' })] },
        { t: 'Blätter borstenförmig, zäh, drahtig, dunkelgrün', arten: [
          A('Rotschwingel', 'Blätter zäh, deutlich gerillt. Pflänzchen lassen sich einzeln ausreissen. Verwandte Arten: z. B. Schafschwingel mit blaugrünen Blättern.', 'gr', { s: 'v' }),
          A('Borstgras', 'Blätter steif, sehr zäh, graugrün. Pflänzchen lassen sich nicht einzeln ausreissen. Ganze Horste sind stark im Boden verankert. Meist liegen dürre Horstteile vom Vorjahr umher.', 'gr')] },
      ] },
      { nr: '1b', t: 'Blätter mit Doppelrille', s: '«Skispur»', arten: [A('Einjähriges Rispengras', 'Pflanze blüht schon bei 5 bis 10 cm Höhe, d. h. fast immer. Blätter kurz, häufig querrunzelig. Blattunterseite nicht glänzend.', 'gr')], kinder: [
        { t: 'Blätter unbehaart', arten: [
          A('Wiesenrispengras', 'Blattränder parallel, Blatt lang, steif, dunkelgrün, mit Kahnspitze. Blatthäutchen kurz, gestutzt.', 'gr', { s: 'v' }),
          A('Gemeines Rispengras', 'Blätter leicht konisch, schlaff. Blatthäutchen zugespitzt. Im ersten Schnitt sehr formenreich.', 'gr', { s: 'v' })] },
        { t: 'Blätter behaart', arten: [A('Flaumhafer', 'Blattränder parallel, Blatt mit Kahnspitze. Blatt sehr lang (nur im vegetativen Zustand!).', 'gr', { s: 'v' })] },
      ] },
      { nr: '2', t: 'Blätter und/oder Blattscheiden oder Halmknoten behaart', kinder: [
        { t: 'mit Öhrchen', arten: [A('Quecke', 'Blattöhrchen schmal, Blätter zäh, steif, gedreht, breit und konisch. Mit Ausläufern.', 'gr', { s: 'o' })] },
        { t: 'ohne Blattöhrchen', kinder: [
          { t: 'Haare 0,5 mm', arten: [A('Wolliges Honiggras', 'Pflanze dicht, samtig behaart. Unterste Blattscheide mit violetten Nerven. Blatt hellgraugrün. Ohne Ausläufer.', 'gr', { s: 'o' })] },
          { t: 'längere Haare > 1 mm vorhanden', kinder: [
            { t: 'unregelmässig behaart', arten: [
              A('Weiches Honiggras', 'Knoten lang schräg abwärts behaart. Mit unterirdischen Ausläufern.', 'gr', { s: 'o' }),
              A('Ruchgras', 'Blattgrund mit auffälligen Haarbüscheln. Rest unbehaart.', 'gr', { s: 'o' }),
              A('Fromental', 'Blätter schwertförmig aufrecht, kaum gedreht, im Licht mit gelbgrünen Linien. Blatthäutchen kurz, weiss, gezähnt, oft zerschlitzt. Überragt Bestand.', 'gr', { s: 'o' }),
              A('Fiederzwenke', 'Hellgelbgrüne Blätter, in den Ansatz verschmälert. Pflanze bildet durch Ausläufer auffällig hellgelbe Flecken auf unternutzten Flächen.', 'gr', { s: 'o' })] },
            { t: 'regelmässig behaart', arten: [
              A('Aufrechte Trespe', 'Blattrand regelmässig bewimpert, Blätter lang, parallelrandig (nur im vegetativen Zustand).', 'gr', { s: 'v' }),
              A('Weiche Trespe', 'Blattscheide dicht behaart, Triebe dick. Violettbraune Flecken auf unterster Blattscheide. Stirbt nach dem ersten Schnitt.', 'gr', { s: 'o' }),
              A('Goldhafer', 'Triebe fein. Haare auf Blattscheide schräg abwärts gerichtet. Blatthäutchen kurz, weiss, gezähnt. Blatt links gedreht (von der Spitze aus gesehen).', 'gr', { s: 'o' })] },
          ] },
        ] },
      ] },
      { nr: '3', t: 'Blattunterseite deutlich von Blattoberseite verschieden', s: 'Blätter normalgrün (nicht graugrün). Blattoberseite stark gerillt, Blattunterseite meist glänzend.', kinder: [
        { t: 'Blätter 3 bis 4 mm breit (vor Rispenschieben breiter), Blattränder parallel', arten: [
          A('Englisches Raigras', 'Blattunterseite stark glänzend. Mittlere Riefen vertieft. Blattquerschnitt = «Krähe» (3 Linien!). Trieb zuunterst rot (totes Material abstreifen!). Blattkiel bis zur Spitze sichtbar. Blatt gefaltet → ovaler Trieb.', 'rg', { s: 'v' }),
          A('Rasenschmiele', 'Blätter mit weissen, durchsichtigen Linien und sehr scharfen Rillen. Grosse Horste.', 'gr', { s: 'v' }),
          A('Kammgras', 'Blattunterseite leicht glänzend. Trieb zuunterst gelbbraun. Blattränder an einer Stelle eingedrückt. Kleine, dichte Horste.', 'gr', { s: 'v' })] },
        { t: 'Blätter 5 bis 10 mm breit, Blattränder konisch', arten: [
          A('Italienisches Raigras', 'Blatthäutchen durchsichtig, etwa 2 mm lang, von der Seite sichtbar. Blattspitzen meist überhängend, überragt übrige Gräser. Blattunterseite stark glänzend.', 'rg', { s: 'o' }),
          A('Wiesenschwingel', 'Blatthäutchen kurz, max. 1 mm, grünlich, derb, von der Seite nicht sichtbar, Blätter schmutziggrün. Zweitoberstes Blatt stramm abstehend. Blattunterseite wenig glänzend.', 'gr', { s: 'o' }),
          A('Rohrschwingel', 'Wie Wiesenschwingel, aber: grobe, harte und raue Pflanze. Blattgrund fein bewimpert (Lupe). Grosse, grobe Horste, Sorten feiner.', 'gr', { s: 'o' }),
          A('Wiesenfuchsschwanz', 'Blattoberseite mit unregelmässigen, aber deutlichen Rillen. Sehr langes, konisches Blatt. Blatthäutchen 1 bis 3 mm, robust, grünlich. Blattunterseite nicht glänzend.', 'gr', { s: 'o' })] },
      ] },
      { nr: '4', t: 'Blattunterseite gleich oder ähnlich wie Blattoberseite', s: 'Blätter mattgrün bis graugrün. Blattoberseite glatt bis fein gerillt, Blattunterseite nicht gerillt, nicht glänzend.', kinder: [
        { t: 'Triebe flach', arten: [A('Knaulgras', 'Blätter ausgeprägt graugrün (sehr junge hellgrün). Triebe flachgedrückt. Blattunterseite mit Kiel.', 'gr', { s: 'v' })] },
        { t: 'Triebe rund', kinder: [
          { t: 'mit Öhrchen', arten: [A('Quecke', 'Blattöhrchen schmal, spitz. Blätter zäh, steif, gedreht, breit und ziemlich konisch. Mit Ausläufern.', 'gr', { s: 'o' })] },
          { t: 'ohne Blattöhrchen', kinder: [
            { t: 'Blattoberseite nicht oder kaum gerillt', arten: [
              A('Timothe', 'Blatt mit gewelltem Rand, bläulich graugrün, wachsig anzufühlen, Halmbasis verdickt. Überragt übrige Gräser nicht. Blatthäutchen weiss, oft mit seitlichen Zähnen.', 'gr', { s: 'o' }),
              A('Fromental', 'Blätter schwertförmig aufrecht, kaum gedreht, im Licht mit gelbgrünen Linien. Blatthäutchen kurz, weiss, gezähnt, oft zerschlitzt. Überragt übrigen Bestand.', 'gr', { s: 'o' })] },
            { t: 'Blattoberseite deutlich gerillt', arten: [
              A('Wiesenfuchsschwanz', 'Sehr langes, konisches Blatt. Blatthäutchen 1 bis 3 mm, robust, grünlich. Blattunterseite nicht glänzend.', 'gr', { s: 'o' })], kinder: [
              { t: 'Blatthäutchen nicht robust, Blätter relativ kurz, nicht oder nur wenig rau', kinder: [
                { t: 'Oberstes Blatthäutchen spitz und lang (1 bis 4 mm)', arten: [
                  A('Ausläufer-Straussgras', 'Mit niederliegenden Trieben und oberirdischen Ausläufern.', 'gr', { s: 'o' }),
                  A('Fioringras', 'Ohne niederliegende Triebe und oberirdische Ausläufer.', 'gr', { s: 'o' })] },
                { t: 'Blatthäutchen gestutzt (0,5 bis 1,5 mm), Blatt mattgrün', arten: [A('Rotes Straussgras', 'Blätter etwas rau, meist < 12 cm.', 'gr', { s: 'o' })] },
              ] },
            ] },
          ] },
        ] },
      ] },
    ],
  };

  const GRAS_G = {
    id: 'gg', titel: 'Gräser ab Rispenschieben', quelle: 'AGFF-Schlüssel zur Bestimmung der wichtigsten Wiesengräser ab Beginn Rispenschieben',
    hinweis: 'Zum Bestimmen immer mehrere gut entwickelte Exemplare nehmen! Ährchenlänge = mittlere Länge der Ährchen ohne Grannen; «ohne Grannen» heisst auch: mit Spitzchen von höchstens 1 mm.',
    reihenfolge: 'Zuerst: Ähre oder Rispe? Dann Ährchen mit oder ohne Grannen.',
    lupe: 'Ein Ährchen ablösen und in den Kreis halten – Grannen und Länge prüfen (Massstab der Messkarte hilft).',
    kinder: [
      { nr: '1', t: 'Ähren – Ährchen mit Grannen', kinder: [
        { t: 'mit 1 Granne pro Ährchen', arten: [A('Wiesenfuchsschwanz', 'Frühes Gras, das bereits anfangs Mai blüht. Nicht mit Timothe verwechseln, das im Juni schiebt. Eher feuchte Wiesen. (Ährchen 7 mm)', 'gr')] },
        { t: 'mit > 5 Grannen pro Ährchen', arten: [A('Italienisches Raigras', 'Bildet auch im Sommer Ähren. Gras der tiefen, feucht-warmen Lagen. (Ährchen 22 mm)', 'rg')] },
      ] },
      { nr: '2', t: 'Ähren – Ährchen ohne Grannen', kinder: [
        { t: 'Ährchen 4 bis 7 mm', arten: [
          A('Timothe', 'Spätes Gras (blüht im Juni). Nicht mit dem Wiesenfuchsschwanz verwechseln. (Ährchen 5 mm)', 'gr'),
          A('Kammgras', 'Gleicht einem Kamm. Gras der Bergweiden.', 'gr'),
          A('Ruchgras', 'Sehr frühes Gras. Zeigt mageren Boden an, falls stark verbreitet. Bei genauer Betrachtung ist das Ährchen eine Ährenspitze mit kurzen Ästen.', 'gr')] },
        { t: 'Ährchen 10 bis 18 mm', arten: [
          A('Quecke', 'Breitseite des Ährchens gegen Ährenachse. Nicht mit dem Englischen Raigras verwechseln! Spätreif: blüht erst im Juni. Mit unterirdischen Ausläufern.', 'gr'),
          A('Englisches Raigras', 'Auf flache Oberfläche gelegt sieht man alle Breitseiten der Ährchen. Nicht mit Quecke verwechseln! Hauptgras der intensiven Wiesen und Weiden.', 'rg')] },
        { t: 'Ährchen > 18 mm', arten: [A('Fiederzwenke', 'Helle, gelbgrüne Blätter, die an Ansatz und Spitze am schmälsten sind. Extensive, unternutzte oder nicht mehr genutzte Flächen.', 'gr')] },
      ] },
      { nr: 'S', t: 'Spezialfälle', arten: [
        A('Rasenschmiele', 'Sehr raues Gras, mit weissen, durchsichtigen Linien. Unkraut der eher feuchten, extensiven Wiesen und Weiden.', 'gr'),
        A('Borstgras', 'Ähre = halbe Feder. Mit trockenen Scheiden vom Vorjahr. Sehr zähe Pflanze der sauren und mageren Weiden.', 'gr'),
        A('Zittergras', 'Zähes Gras der mageren und trockenen Wiesen.', 'gr'),
        A('Knaulgras', 'Vor allem in mittel-intensiven Wiesen.', 'gr')] },
      { nr: '3', t: 'Rispen – Ährchen mit Grannen', kinder: [
        { t: 'mit 1 Granne pro Ährchen', arten: [
          A('Weiches Honiggras', 'Knoten auffällig behaart, Rest unregelmässig behaart. Waldränder usw.', 'gr'),
          A('Fromental', 'Auffällig hohes Gras. Im fortgeschrittenen Stadium häufig mit 2 Grannen. Gras der wenig intensiven Wiesen. (Ährchen 8 mm)', 'gr')] },
        { t: 'mit 2 bis 3 Grannen pro Ährchen', arten: [
          A('Flaumhafer', 'Behaart, Blütenstand teilweise violett. Blätter sehr kurz, mit Skispur. Wenig intensive, eher trockene Wiesen. (Ährchen 17 mm)', 'gr'),
          A('Goldhafer', 'Mit feinen Trieben, Blütenstand golden überlaufen. Blattscheiden stark behaart, Haare nach unten gerichtet. (Ährchen 6 mm)', 'gr')] },
        { t: 'mit > 5 Grannen pro Ährchen', arten: [
          A('Aufrechte Trespe', 'Blattrand bewimpert. Hartes Gras der wenig intensiven, trockenen Wiesen. (Ährchen 25 mm)', 'gr'),
          A('Weiche Trespe', 'Einjährige, stark behaarte Pflanze. Verschwindet nach dem ersten Schnitt. (Ährchen 18 mm)', 'gr'),
          A('Rotschwingel', 'Kurze Grannen (1–2 mm), Grundblätter borstenförmig, zäh. (Ährchen 8 mm)', 'gr')] },
      ] },
      { nr: '4', t: 'Rispen – Ährchen ohne Grannen', kinder: [
        { t: 'Samtig behaart', arten: [A('Wolliges Honiggras', 'Regelmässig behaart, sehr kurze, samtige Behaarung, Berührung sehr weich. In eher extensiven Wiesen. (Ährchen 5 mm)', 'gr')] },
        { t: 'Ährchen 10 mm', arten: [
          A('Wiesenschwingel', 'Keine Grannen. Kürzerer der untersten Rispenäste mit 1 (–2) Ährchen.', 'gr'),
          A('Rohrschwingel', 'Ährchen mit Spitzchen = sehr kurze Grannen. Kürzerer der untersten Rispenäste mit ≥ 3 Ährchen.', 'gr')] },
        { t: 'Ährchen 8 mm', arten: [A('Blaues Pfeifengras / Besenried', 'Hohes Gras ohne sichtbare Knoten. Pflanzen der feuchten Orte.', 'gr')] },
        { t: 'Ährchen 4 mm', arten: [
          A('Wiesenrispengras', 'Mit kurzem, gestutztem Blatthäutchen. Blätter dunkelgrün.', 'gr'),
          A('Gemeines Rispengras', 'Mit langem, zugespitztem Blatthäutchen. Blätter hellgrün.', 'gr'),
          A('Einjähriges Rispengras', 'Blühend 5–10 cm hoch. Kurze, oft etwas gedrehte Blätter.', 'gr')] },
        { t: 'Ährchen ca. 2,5 mm', arten: [A('Rotes Straussgras', 'Oberstes Blatthäutchen kurz und gestutzt. Wenig intensive Wiesen.', 'gr')], kinder: [
          { t: 'Oberstes Blatthäutchen lang und zugespitzt', arten: [
            A('Ausläufer-Straussgras', 'Mit nieder liegenden Trieben und oberirdischen Ausläufern. Feuchte Orte.', 'gr'),
            A('Fioringras', 'Ohne nieder liegende Triebe oder oberirdische Ausläufer.', 'gr')] },
        ] },
      ] },
    ],
  };

  const LEGUM = {
    id: 'lv', titel: 'Leguminosen', quelle: 'AGFF-Schlüssel zur Bestimmung der wichtigsten Leguminosen im vegetativen Zustand',
    hinweis: 'Zum Bestimmen nur Pflanzen im vegetativen Stadium verwenden – blühende Pflanzen haben häufig länglichere Teilblätter!',
    lupe: 'Ein ganzes Blatt mit Nebenblättern flach in den Kreis halten: Stiel des mittleren Teilblatts, Behaarung, Blattrand.',
    kinder: [
      { nr: '1', t: 'Blätter mit 3 Teilblättern', s: 'Nebenblätter nicht eingerechnet', kinder: [
        { t: 'Mittleres Teilblatt ohne Stiel (evtl. Stielchen bis 1 mm)', kinder: [
          { t: 'Nebenblätter anders als Teilblätter', kinder: [
            { t: 'Blatt nicht behaart', arten: [
              A('Weissklee', 'Teilblattspitze nicht gezähnt. Pflanze ohne Pfahlwurzel, aber mit Ausläufern.', 'kl', { o: 'Kunst- und Naturwiesen' }),
              A('Perserklee', 'Junge Exemplare haben runde Teilblätter; ältere Exemplare haben längliche, spitze Teilblätter. Blattrand fast überall gezähnt, mit Pfahlwurzel, ohne Ausläufer.', 'kl', { o: 'Kunstwiesen und Zwischenfutterbau' })] },
            { t: 'Blatt behaart', arten: [
              A('Rotklee', 'Teilblattlänge: 1- bis 2-mal Breite. Teilblätter mit Härchen an der Spitze, Blatt behaart, unterseits grau.', 'kl', { o: 'Kunst- und Naturwiesen' }),
              A('Alexandrinerklee', 'Teilblattlänge: 3- bis 6-mal Breite. Blatt beidseits behaart, Nebenblätter bewimpert, Pflanze gelbgrün.', 'kl', { o: 'Kunstwiesen und Zwischenfutterbau' })] },
          ] },
          { t: 'Nebenblätter wie Teilblätter', arten: [
            A('Schotenklee', 'Die Nebenblätter gleichen den Teilblättern.', 'kl', { o: 'Eher extensive Wiesen und Weiden, Alpweiden, Kunstwiesen auf sehr trockenem Boden' }),
            A('Inkarnatklee', 'Teilblattlänge: 1- bis 1,5-mal Breite. Pflanze und Nebenblätter stark behaart.', 'kl', { o: 'Zwischenfutterbau' })] },
        ] },
        { t: 'Mittleres Teilblatt mit Stiel', arten: [
          A('Luzerne', 'Längliche Teilblätter > 15 mm, junge Teilblätter oft runder.', 'kl', { o: 'Kunstwiesen' }),
          A('Hopfenklee (Gelbklee)', 'Teilblätter rund bis dreieckig < 15 mm.', 'kl', { o: 'Kunstwiesen und Zwischenfutterbau' })] },
      ] },
      { nr: '2', t: 'Unpaarig gefiedert', kinder: [
        { t: 'ohne Ranken', arten: [A('Esparsette', '', 'kl', { o: 'Trockene Naturwiesen, Alpweiden, Kunstwiesen auf sehr trockenem Boden' })] },
      ] },
      { nr: '3', t: 'Paarig gefiedert', kinder: [
        { t: 'mit Ranken', arten: [
          A('Sommersaatwicke', '5 bis 8 Teilblattpaare, Teilblattbreite bis 10 mm.', 'kl', { o: 'Zwischenfutterbau' }),
          A('Zaunwicke', '4 bis 8 behaarte Teilblattpaare, Teilblätter bis 12 mm breit.', 'kl', { o: 'Eher extensive Naturwiesen' }),
          A('Vogelwicke', '(5) 8 bis 12 Teilblattpaare, Teilblätter spitz und schmal, bis 12 mm breit.', 'kl', { o: 'Eher extensive Naturwiesen' })] },
      ] },
      { nr: '4', t: 'Nur 2 Teilblätter', kinder: [
        { t: 'mit Ranken', arten: [A('Wiesenplatterbse', 'Nebenblätter pfeilspitzenförmig.', 'kl', { o: 'Eher extensive Naturwiesen' })] },
      ] },
    ],
  };

  const KRAUT = {
    id: 'kv', titel: 'Kräuter', quelle: 'AGFF-Schlüssel zur Bestimmung der wichtigsten Kräuter im vegetativen Zustand',
    hinweis: 'Nur grundständige Blätter zum Bestimmen benutzen!',
    lupe: 'Ein grundständiges Blatt flach in den Kreis halten: Nerven, Blattgrund und Blattrand.',
    kinder: [
      { nr: '1', t: 'Binsen und Seggen', arten: [
        A('Binsen', 'Stängel = blätterlose Röhre.', 'gr', { x: 'Grasartig, futterbaulich geringwertig – im Raster bei «andere Gräser» zählen.' }),
        A('Seggen, Waldsimse', 'Halm schneidend, ohne Knoten, Querschnitt meist dreieckig. Waldsimse mit steifen, breiten Blättern.', 'gr', { x: 'Grasartig, futterbaulich geringwertig – im Raster bei «andere Gräser» zählen.' })] },
      { nr: '2', t: 'Quirlständige Blätter', arten: [
        A('Ackerschachtelhalm', 'Schachtelhalm «Katzenschwanz» – im Schlüssel als giftig bezeichnet.', 'kf', { x: 'Ackerschachtelhalm ist futterbaulich geringwertig. Nicht verwechseln mit dem hochgiftigen Sumpfschachtelhalm!' }),
        A('Sumpfschachtelhalm', 'Hochgiftig! Das innerste Teilstück der quirlständigen Seitentriebe ist kürzer als die benachbarte lange Scheide am Stängel (beim Ackerschachtelhalm länger).', 'kf', { g: 'hochgiftig', x: 'Feuchte bis nasse, magere Böden. Giftig frisch und getrocknet.' }),
        A('Wiesenlabkraut', '', 'kf')] },
      { nr: '3', t: 'Mehrere Teilblätter pro Blatt', arten: [
        A('Wiesenkerbel', '', 'kg'), A('Bärenklau', '', 'kg'), A('Bergkerbel / Kälberkropf', '', 'kg'),
        A('Kriechender Hahnenfuss', 'Teilblätter mit Stiel.', 'kf'), A('Baumtropfen / Geissfuss', '', 'kf'), A('Schafgarbe', '', 'kf'), A('Kümmel', '', 'kf')] },
      { nr: '4', t: 'Ungeteilte Blätter', s: 'evtl. stark eingeschnitten, aber nicht vollflächig geteilt', kinder: [
        { t: 'Blätter parallelnervig', arten: [
          A('Spitzwegerich', '', 'kf'),
          A('Mittlerer Wegerich', 'Bodennahe Rosette, Blatt breit, ohne Stiel.', 'kf'),
          A('Breitwegerich', 'Blatt breit, mit Stiel.', 'kf'),
          A('Herbstzeitlose', 'Sehr giftig, hellviolette Blüte im Herbst.', 'kf', { g: true })] },
        { t: 'Blätter nicht parallelnervig', kinder: [
          { t: 'Blatt in den Stiel verschmälert', arten: [
            A('Wiesenlöwenzahn', 'Blütenstiel hohl.', 'kf'),
            A('Rauer Löwenzahn', 'Blütenstiel dünn und nicht hohl.', 'kf'),
            A('Schlangenknöterich', 'Blätter wächsern anzufühlen.', 'kf'),
            A('Kohldistel', 'Blatt jung ungeteilt, alt tief eingeschnitten.', 'kg')] },
          { t: 'Blatt nicht in den Stiel verschmälert', arten: [
            A('Sauerampfer', '', 'kf'),
            A('Wiesenblacke / Grosser Ampfer', 'Wichtigstes Unkraut der Wiesen.', 'kg'),
            A('Wiesensalbei', 'Auf mageren, trockenen Böden.', 'kf'),
            A('Frauenmantel / Taumantel', '', 'kf')] },
          { t: 'Blätter stark eingeschnitten', arten: [
            A('Scharfer Hahnenfuss', '3 oder 5 Blattlappen, Giftpflanze.', 'kf', { g: true }),
            A('Waldstorchschnabel', '', 'kf')] },
        ] },
      ] },
    ],
  };

  const SCHLUESSEL = [GRAS_V, GRAS_G, LEGUM, KRAUT];
  let Z = { key: 'gv', pfad: [], az: false };
  // Zeichnungen (AGFF-Schlüssel, edition lmz) und Fotos/Kurzinfos (eAGFF, © AGFF/Agroscope) – bei Bedarf geladen
  let D = null; let ladend = false;
  function daten() {
    if (D || ladend) return D;
    ladend = true;
    fetch('assets/pflanzen.json?v=' + ((global.AGFF_V2 || {}).build || ''), { credentials: 'omit' }).then((r) => r.json()).then((j) => { D = j; neu(false); }).catch(() => { ladend = false; });
    return null;
  }
  const info = (n) => (D && D.arten[n]) || null;
  const ICON = { 'Mittleres Teilblatt ohne Stiel (evtl. Stielchen bis 1 mm)': 'k:ohneStiel', 'Mittleres Teilblatt mit Stiel': 'k:mitStiel', 'Blätter parallelnervig': 'k:parallel' };
  const icon = (kid, id) => { const f = D && D.icons[kid] && D.icons[kid][id]; return f ? '<img class="pf-ic" alt="" src="assets/pflanzen/' + f + '">' : ''; };
  let rueck = null; // Rückmeldung an das Punktraster

  const key = () => SCHLUESSEL.find((k) => k.id === Z.key);
  const knoten = (pfad) => pfad.reduce((n, i) => n.kinder[i], key());
  /** Alle Arten unterhalb eines Knotens, mit dem Weg der Kriterien. */
  function alleArten(n, weg) {
    const out = (n.arten || []).map((a) => ({ a, weg }));
    (n.kinder || []).forEach((k) => out.push(...alleArten(k, weg.concat(k.nr ? k.nr + ' ' + k.t : k.t))));
    return out;
  }

  function bilderHtml(a) {
    const i = info(a.n); if (!i) return '';
    const z = i.z.slice().sort((x, y) => (x.k === Z.key ? -1 : 0) - (y.k === Z.key ? -1 : 0));
    const alle = z.map((b) => ({ f: b.f, t: 'Zeichnung' })).concat(i.fotos.map((b) => ({ f: b.f, t: b.z ? 'Zeichnung' : 'Foto' })));
    if (!alle.length) return '';
    return '<div class="pf-bilder">' + alle.map((b, j) => '<button class="pf-bild' + (b.t === 'Zeichnung' ? ' zg' : '') + '" data-pf="bild" data-n="' + esc(a.n) + '" data-i="' + j + '" aria-label="' + b.t + ' vergrössern"><img alt="" loading="lazy" src="assets/pflanzen/' + b.f + '"></button>').join('') + '</div>';
  }
  function artKarte(a, weg) {
    const s = a.s && SYM[a.s]; const i = info(a.n);
    return '<div class="pf-art"><div class="pf-art-kopf"><b>' + esc(a.n) + '</b>' + (s ? '<span class="pf-sym" title="' + s.t + '">' + s.i + '</span>' : '') +
      (a.g ? '<span class="chip kritisch">' + (a.g === true ? 'giftig' : esc(a.g)) + '</span>' : '') + '<span class="chip">' + KAT[a.k] + '</span></div>' +
      (i && i.lat ? '<div class="small muted"><i>' + esc(i.lat) + '</i></div>' : '') + bilderHtml(a) +
      (a.d ? '<div class="small">' + esc(a.d) + '</div>' : '') + (a.o ? '<div class="small muted">Vorkommen: ' + esc(a.o) + '</div>' : '') +
      (a.x ? '<div class="small pf-x">' + esc(a.x) + '</div>' : '') +
      (i && (i.auff || i.wert) ? '<details class="pf-eagff"><summary>Mehr aus eAGFF</summary>' + (i.auff ? '<p class="small"><b>Auffällig:</b> ' + esc(i.auff) + '</p>' : '') + (i.wert ? '<p class="small"><b>Futterbaulicher Wert:</b> ' + esc(i.wert) + '</p>' : '') + (i.vork ? '<p class="small"><b>Vorkommen:</b> ' + esc(i.vork) + '</p>' : '') + '<a class="small" href="' + esc(i.url) + '" target="_blank" rel="noopener noreferrer">Porträt auf eagff.ch ↗</a></details>' : '') +
      (weg ? '<div class="small muted pf-weg">' + weg.map(esc).join(' › ') + '</div>' : '') +
      (rueck ? '<button class="btn sm" data-pf="nehmen" data-k="' + a.k + '">Im Raster als «' + KAT[a.k] + '» zählen</button>' : '') + '</div>';
  }

  function inhalt() {
    daten();
    const K = key(); const n = knoten(Z.pfad);
    const lupe = global.Wiese && !rueck ? '<button class="btn sm ghost" data-pf="lupe">Lupe</button>' : '';
    let h = '<div class="pf-tabs" role="tablist">' + SCHLUESSEL.map((k) => '<button data-pf="key" data-v="' + k.id + '" aria-pressed="' + (k.id === Z.key) + '">' + esc(k.titel) + '</button>').join('') + '</div>';
    // Brotkrumen: Spalte und gewählte Kriterien
    const krumen = []; let m = K;
    Z.pfad.forEach((i, j) => { m = m.kinder[i]; krumen.push('<button class="pf-krume" data-pf="hoch" data-v="' + (j + 1) + '">' + esc(m.nr ? m.nr + ' · ' + m.t : m.t) + '</button>'); });
    h += '<div class="pf-pfad"><button class="pf-krume start" data-pf="hoch" data-v="0">' + esc(K.titel) + '</button>' + krumen.join('') + lupe + '</div>';
    if (Z.az) {
      const liste = alleArten(K, []).sort((x, y) => x.a.n.localeCompare(y.a.n, 'de'));
      return h + '<div class="row" style="justify-content:space-between;align-items:center;margin:8px 0"><b>Alle Arten im Schlüssel (' + liste.length + ')</b><button class="btn sm ghost" data-pf="az">Zurück zum Schlüssel</button></div>' +
        '<p class="qhint">Unter jeder Art steht der Weg durch den Schlüssel – zum Üben oder Überprüfen.</p>' + liste.map((x) => artKarte(x.a, x.weg)).join('');
    }
    if (!Z.pfad.length) {
      h += '<p class="qhint">' + esc(K.hinweis) + '</p>' + (K.reihenfolge ? '<p class="pf-reihe">' + esc(K.reihenfolge) + '</p>' : '') +
        '<div class="pf-spalten">' + K.kinder.map((s, i) => '<button class="pf-spalte" data-pf="w" data-v="' + i + '"><span class="pf-nr">' + esc(s.nr) + '</span>' + icon(K.id, s.nr) + (K.id === 'gg' && /^Ähren/.test(s.t) ? icon('gg', 'Ähren') : K.id === 'gg' && /^Rispen/.test(s.t) ? icon('gg', 'Rispen') : '') + '<span><b>' + esc(s.t) + '</b>' + (s.s ? '<small>' + esc(s.s) + '</small>' : '') + '</span></button>').join('') + '</div>';
    } else {
      if (n.s) h += '<p class="qhint">' + esc(n.s) + '</p>';
      if (n.kinder && n.kinder.length) {
        h += '<div class="pf-frage">Was trifft zu?</div><div class="pf-krit">' + n.kinder.map((k, i) => { const z = alleArten(k, []).length; return '<button class="pf-opt" data-pf="w" data-v="' + i + '">' + (ICON[k.t] ? icon(K.id, ICON[k.t]) : '') + '<span>' + esc(k.t) + '</span><small>' + z + (z === 1 ? ' Art' : ' Arten') + '</small></button>'; }).join('') + '</div>';
      }
      if (n.arten && n.arten.length) h += (n.kinder && n.kinder.length ? '<div class="pf-frage">Trifft nichts davon zu:</div>' : '<div class="pf-frage">Arten – Detailbeschreibung vergleichen:</div>') + n.arten.map((a) => artKarte(a)).join('');
    }
    h += '<div class="row" style="margin-top:12px"><button class="btn sm ghost" data-pf="az">Alle Arten A–Z</button><button class="btn sm ghost" data-pf="export" data-v="csv">Tabelle (Excel)</button><button class="btn sm ghost" data-pf="export" data-v="pdf">Tabelle (PDF)</button>' + (Z.pfad.length ? '<button class="btn sm ghost" data-pf="hoch" data-v="' + (Z.pfad.length - 1) + '">← Schritt zurück</button>' : '') + '</div>' +
      '<p class="hint">Nach: ' + esc(K.quelle) + ' (AGFF, edition lmz 2016). Zeichnungen © edition lmz; Fotos und Kurzinfos aus <a href="https://www.eagff.ch" target="_blank" rel="noopener noreferrer">eAGFF</a> (© AGFF, Agroscope, e-pics ETH-Bibliothek – Nachweis beim Bild). Die Zuordnung zu den Raster-Klassen stammt von dieser App.</p>';
    return h;
  }

  function render() {
    rueck = null;
    return '<div class="bar"><a class="icon-btn" href="#/wiese" aria-label="Zurück">' + app().I.back + '</a><h2>Pflanzen bestimmen<span class="sub">AGFF-Bestimmungsschlüssel – ohne KI</span></h2></div><div class="pad pflanzen" id="pfBox">' + inhalt() + '</div>';
  }
  function sheet(cb) {
    rueck = cb || null;
    app().sheet('<h2>Pflanze bestimmen</h2><div class="pflanzen" id="pfBox">' + inhalt() + '</div><button class="btn ghost block" data-close style="margin-top:10px">Schliessen</button>');
  }
  function neu(scroll) { const b = document.getElementById('pfBox'); if (b) { b.innerHTML = inhalt(); if (scroll !== false) { const top = b.closest('.sheet') || document.getElementById('main'); if (top && top.scrollTo) top.scrollTo(0, 0); window.scrollTo(0, 0); } } }

  function handle(e) {
    const t = e.target.closest('[data-pf]'); if (!t) return false;
    const a = t.dataset.pf;
    if (a === 'zurueck') { sheet(rueckSheet); return true; }
    if (a === 'key') { Z = { key: t.dataset.v, pfad: [], az: false }; neu(); }
    if (a === 'w') { Z.pfad.push(Number(t.dataset.v)); Z.az = false; neu(); }
    if (a === 'hoch') { Z.pfad = Z.pfad.slice(0, Number(t.dataset.v)); Z.az = false; neu(); }
    if (a === 'az') { Z.az = !Z.az; neu(); }
    if (a === 'bild') { bildGross(t.dataset.n, Number(t.dataset.i)); return true; }
    if (a === 'export') { (t.dataset.v === 'pdf' ? exportPdf() : exportCsv()).catch((er) => app().toast(er.message)); return true; }
    if (a === 'nehmen' && rueck) { const cb = rueck; rueck = null; app().closeSheet(); cb(t.dataset.k); }
    if (a === 'lupe' && global.Wiese) {
      global.Wiese.kamera({ titel: 'Lupe · ' + key().titel, hilfe: esc(key().lupe) + ' Zoom-Regler und Licht nutzen; grosser Knopf = Standbild.', lupe: true,
        zeichnen: (ctx, w, h) => { const r = Math.min(w, h) * 0.2; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(w / 2, h * 0.42, r, 0, 7); ctx.stroke(); } });
    }
    return true;
  }

  function bildGross(n, j) {
    const i = info(n); if (!i) return;
    const z = i.z.slice().sort((x, y) => (x.k === Z.key ? -1 : 0) - (y.k === Z.key ? -1 : 0));
    const alle = z.map((b) => ({ f: b.f, cr: 'Zeichnung: AGFF-Bestimmungsschlüssel, © edition lmz' })).concat(i.fotos.map((b) => ({ f: b.f, cr: (b.cap ? b.cap + ' · ' : '') + '© ' + b.cr + ' · eAGFF' })));
    const b = alle[j]; if (!b) return;
    const imSheet = !!document.querySelector('#sheet-root .sheet #pfBox'); const cb = rueck;
    app().sheet('<h2>' + esc(n) + '</h2><img class="foto-gross pf-gross" alt="" src="assets/pflanzen/' + b.f + '"><p class="small muted">' + esc(b.cr) + '</p>' +
      '<div class="row">' + (alle.length > 1 ? '<button class="btn grow" data-pf="bild" data-n="' + esc(n) + '" data-i="' + ((j + alle.length - 1) % alle.length) + '">← Bild</button><button class="btn grow" data-pf="bild" data-n="' + esc(n) + '" data-i="' + ((j + 1) % alle.length) + '">Bild →</button>' : '') +
      (imSheet ? '<button class="btn ghost grow" data-pf="zurueck">Zurück</button>' : '<button class="btn ghost grow" data-close>Schliessen</button>') + '</div>');
    if (imSheet) rueckSheet = cb;
  }
  let rueckSheet = null;

  // ---------- Export: Tabelle der Arten ----------
  function zeilen() {
    const out = [];
    SCHLUESSEL.forEach((K) => {
      (function lauf(n, weg, spalte) {
        (n.arten || []).forEach((a) => { const i = info(a.n) || {}; out.push({ schl: K.titel, spalte, weg: weg.join(' › '), a, i }); });
        (n.kinder || []).forEach((k) => lauf(k, weg.concat(k.nr ? k.nr + ' ' + k.t : k.t), spalte || (k.nr ? k.nr + ' ' + k.t : '')));
      })(K, [], '');
    });
    return out;
  }
  const symText = (s) => (s === 'v' ? 'gefaltet' : s === 'o' ? 'gerollt' : '');
  async function exportCsv() {
    await (async () => { if (!D) { const r = await fetch('assets/pflanzen.json', { credentials: 'omit' }); D = await r.json(); } })();
    const kopf = ['Schlüssel', 'Weg im Schlüssel', 'Art', 'Lateinisch', 'Jüngstes Blatt', 'Raster-Klasse', 'Giftig', 'Merkmale (Schlüssel)', 'Vorkommen (Schlüssel)', 'Hinweis', 'Auffällig (eAGFF)', 'Futterbaulicher Wert (eAGFF)', 'Vorkommen (eAGFF)', 'eAGFF-Porträt'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = zeilen().map((z) => [z.schl, z.weg, z.a.n, z.i.lat, symText(z.a.s), KAT[z.a.k], z.a.g ? (z.a.g === true ? 'giftig' : z.a.g) : '', z.a.d, z.a.o, z.a.x, z.i.auff, z.i.wert, z.i.vork, z.i.url].map(q).join(';'));
    const blob = new Blob(['\ufeff' + [kopf.map(q).join(';')].concat(rows).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    laden(blob, 'AGFF_Pflanzen_Eigenschaften.csv');
  }
  async function exportPdf() {
    if (!D) { const r = await fetch('assets/pflanzen.json', { credentials: 'omit' }); D = await r.json(); }
    const IO = global.FutterIO; await IO.loadScript('assets/vendor/jspdf.umd.min.js');
    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' }); const T = (s) => IO.pdfText(String(s || ''));
    const W = [44, 62, 80, 74, 20]; const X = [10]; W.forEach((w, i) => X.push(X[i] + w));
    const kopf = ['Art', 'Weg im Schlüssel', 'Merkmale (Schlüssel)', 'Futterbaulicher Wert (eAGFF)', 'Raster'];
    let y = 0; let schl = '';
    const seite = (titel) => { doc.addPage(); y = 14; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(T(titel), 10, y); y += 6; doc.setFontSize(8); kopf.forEach((k, i) => doc.text(T(k), X[i], y)); y += 2; doc.setDrawColor(150); doc.line(10, y, 287, y); y += 4; doc.setFont('helvetica', 'normal'); };
    zeilen().forEach((z) => {
      if (z.schl !== schl) { schl = z.schl; seite('Wichtigste Eigenschaften – ' + schl); }
      const zellen = [z.a.n + (z.i.lat ? '\n' + z.i.lat : '') + (symText(z.a.s) ? '\nJüngstes Blatt ' + symText(z.a.s) : ''), z.weg, [z.a.d, z.a.o ? 'Vorkommen: ' + z.a.o : '', z.a.x].filter(Boolean).join(' '), z.i.wert || '', KAT[z.a.k] + (z.a.g ? '\n' + (z.a.g === true ? 'giftig' : z.a.g) : '')];
      doc.setFontSize(7.5);
      const L = zellen.map((c, i) => doc.splitTextToSize(T(c), W[i] - 3));
      const h = Math.max(...L.map((l) => l.length)) * 3.2 + 2;
      if (y + h > 200) seite('Wichtigste Eigenschaften – ' + schl + ' (Forts.)');
      L.forEach((l, i) => { if (i === 0) doc.setFont('helvetica', 'bold'); doc.text(l, X[i], y); doc.setFont('helvetica', 'normal'); });
      y += h; doc.setDrawColor(220); doc.line(10, y - 1.5, 287, y - 1.5);
    });
    doc.deletePage(1);
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(6.5); doc.setTextColor(120); doc.text(T('Quellen: AGFF-Bestimmungsschlüssel (edition lmz 2016); Futterbaulicher Wert aus eAGFF (www.eagff.ch). Raster-Klasse: Zuordnung der App. Futterbeurteilung v2 · Seite ' + i + '/' + n), 10, 205); doc.setTextColor(0); }
    laden(doc.output('blob'), 'AGFF_Pflanzen_Eigenschaften.pdf');
  }
  function laden(blob, name) { const url = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = url; el.download = name; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }

  global.Pflanzen = { render, sheet, handle, exportCsv, exportPdf, _daten: { SCHLUESSEL, alleArten, zeilen } };
})(window);
