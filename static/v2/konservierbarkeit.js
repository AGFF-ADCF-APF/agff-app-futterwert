/* Futter v2 – Checkliste «Konservierbarkeit» für stehendes Futter (Grünfutter-Probe, v. a. in der App Wiese).
 * Beurteilt nicht den Konservierungserfolg, sondern ob Bestand, Feld, Maschinen und Planung eine gute Silage bzw.
 * ein gutes Heu zulassen. Nüchterne Liste mit Quelle je Punkt; bei «nein» die Massnahme. Feste Texte, keine KI.
 * Gespeichert in probe.antworten.konserv = { verfahren, items: { id: 'ja'|'nein'|'offen' } }.
 */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const esc = (s) => app().esc(s);

  const Q = {
    k4b: 'AGFF K4b (2024)', k279: 'ADCF/AGRIDEA 2.7.9 (2021)', k124: 'ADCF/AGRIDEA 12.4 (2025)', k3: 'AGFF K3a/K3b',
  };
  const VERFAHREN = [
    ['silo', 'Silage im Hoch- oder Fahrsilo'], ['ballen', 'Siloballen'], ['belueftung', 'Belüftungsheu'], ['bodenheu', 'Bodenheu (Ballen)'],
  ];
  const istSilage = (v) => v === 'silo' || v === 'ballen';

  /** Punkte zum Abhaken. nur: für welche Verfahren (leer = alle) */
  const PUNKTE = [
    { gruppe: 'Feld', id: 'haufen', t: 'Keine Maulwurfs- oder Wühlmaushaufen (bzw. im Frühling eingeebnet)', m: 'Wühlmäuse bekämpfen; Wiesen im Frühling walzen, bei vielen Haufen eggen.', q: [Q.k4b, Q.k279] },
    { gruppe: 'Feld', id: 'guelle', t: 'Keine Gülle- oder Mistreste am Futter', m: 'Gülle vor Regen ausbringen, damit sie eingewaschen wird; dicke Gülle verdünnen; Mist im Frühling eggen. Futter mit sichtbaren Resten nicht verfüttern.', q: [Q.k4b, Q.k3] },
    { gruppe: 'Feld', id: 'boden', t: 'Boden trägt; kein Tau, der Erde ankleben lässt', m: 'Nicht auf nassem Boden fahren; nachmittags oder abends mähen, bevor sich Tau bildet.', q: [Q.k279] },
    { gruppe: 'Maschinen', id: 'schnitt', t: 'Mähwerk auf 8–10 cm Schnitthöhe eingestellt', m: 'Schnitthöhe 8–10 cm einhalten (Bodenheu mindestens 8 cm, damit Luft unter das Futter kommt).', q: [Q.k4b, Q.k279] },
    { gruppe: 'Maschinen', id: 'zinken', t: 'Zetter, Schwader und Pick-up auf etwa 10 cm, Zinkenneigung geprüft', m: 'Mäh- und Heumaschinen auf 10 cm einstellen; Neigung der Zinken von Zetter, Schwader und Pick-up prüfen.', q: [Q.k279] },
    { gruppe: 'Maschinen', id: 'aufbereiter', t: 'Aufbereiter bzw. rasches Breitstreuen möglich; bei viel Leguminosen Walzenaufbereiter', m: 'Mit Aufbereiter mähen oder sofort breit streuen; bei viel Leguminosen einen Walzenaufbereiter verwenden.', q: [Q.k279] },
    { gruppe: 'Maschinen', id: 'haecksel', nur: ['silo', 'ballen'], t: 'Häcksellänge unter 5 cm möglich (scharfe Messer)', m: 'Gras und Ganzpflanzensilage unter 5 cm häckseln.', q: [Q.k4b] },
    { gruppe: 'Wetter und Planung', id: 'wetter', t: '', m: '', q: [] },  // Text je Verfahren (siehe WETTER)
    { gruppe: 'Wetter und Planung', id: 'hitze', nur: ['silo', 'ballen'], t: 'Nicht bei über 30 °C silieren (vor allem bei schwer silierbarem Futter)', m: 'Bei Hitze auf kühlere Tage oder Tageszeiten ausweichen; evtl. Siliermittel der Liste A.', q: [Q.k4b] },
    { gruppe: 'Wetter und Planung', id: 'lager', t: '', m: '', q: [] },  // Text je Verfahren (siehe LAGER)
  ];
  const WETTER = {
    silo: ['Wetter erlaubt Anwelken auf 30–35 % TS (höchstens 36 %)', 'Erst mähen, wenn das Anwelken auf das Ziel sicher möglich ist; TS mit der Auswringprobe prüfen.', [Q.k4b]],
    ballen: ['Wetter erlaubt Anwelken auf über 40 % TS (höchstens 55 %)', 'Erst mähen, wenn das Anwelken auf das Ziel sicher möglich ist; nicht über 55 % TS.', [Q.k4b]],
    belueftung: ['3 sichere Sonnentage; auf dem Feld etwa 60 % TS erreichbar', 'Nur mähen, wenn das Wetter 3 Sonnentage sicher bringt – auch wenn das Stadium noch etwas jung ist.', [Q.k279]],
    bodenheu: ['4–5 Tage sonnig mit tiefer Luftfeuchtigkeit', 'Nur mähen, wenn sonniges Wetter mit tiefer Luftfeuchtigkeit für 4–5 Tage gesichert ist.', [Q.k279]],
  };
  const LAGER = {
    silo: ['Silo bereit: dicht, Verdichtung über 220 kg TS/m³ möglich, Unterziehfolie und Sandsäcke vorhanden', 'Silo vorher reinigen und auf Löcher prüfen; dünne Schichten, mehrere Überfahrten; sofort luftdicht schliessen.', [Q.k4b]],
    ballen: ['Wickelfolie über 250 µm, 6–8 Lagen ohne Löcher möglich', 'Folienqualität und Wickelzahl prüfen; Ballen nach dem Wickeln vor Beschädigung schützen.', [Q.k4b]],
    belueftung: ['Belüftung bereit: Ventilator, Roste, Luftführung geprüft; höchstens 2 m Füllhöhe pro Tag einplanbar', 'Anlage vor der Ernte prüfen (Checkliste Heubelüftung); pro Tag höchstens 1–2 m einführen.', [Q.k124, Q.k279]],
    bodenheu: ['Platz, damit die Ballen 7–10 Tage draussen ausschwitzen können', 'Ballen nicht zu fest pressen und erst nach 7–10 Tagen definitiv stapeln.', [Q.k279]],
  };
  function punkteFuer(v) {
    return PUNKTE.filter((x) => !x.nur || x.nur.includes(v)).map((x) => {
      if (x.id === 'wetter') { const w = WETTER[v]; return Object.assign({}, x, { t: w[0], m: w[1], q: w[2] }); }
      if (x.id === 'lager') { const w = LAGER[v]; return Object.assign({}, x, { t: w[0], m: w[1], q: w[2] }); }
      return x;
    });
  }

  /** Was sich aus Bestand, Stadium und Sauberkeit der Probe bereits ableiten lässt */
  function abgeleitet(p, v) {
    const a = p.antworten || {}; const out = [];
    if (a.bestand) {
      const klee = a.bestand === 'L' || a.bestand === 'LUZ'; const kraut = a.bestand === 'KF' || a.bestand === 'KG'; const rg = /R|ITRG/.test(a.bestand);
      out.push(istSilage(v)
        ? { ok: klee || kraut ? 'mittel' : 'gut', t: 'Bestand: ' + (rg ? 'raigrasreich – gut silierbar' : klee ? 'kleereich – schwerer silierbar (wenig Zucker, viel Eiweiss)' : kraut ? 'kräuterreich – schwerer silierbar' : 'gräserreich bzw. ausgewogen'), m: klee || kraut ? 'Stärker anwelken, sauber arbeiten, evtl. Siliermittel; gut silierbare Bestände (Raigras) bevorzugen.' : '', q: [Q.k4b] }
        : { ok: klee ? 'mittel' : 'gut', t: 'Bestand: ' + (klee ? 'kleereich – Blätter bröckeln beim Trocknen leicht ab' : 'gräserreich bzw. ausgewogen'), m: klee ? 'Am ersten Tag intensiv bearbeiten, danach nur, solange die Blätter weich sind; Walzenaufbereiter.' : '', q: [Q.k279] });
    }
    if (a.aufwuchs === '1' && a.stadium) {
      const s = Number(a.stadium);
      out.push({ ok: s <= 3 ? 'gut' : s === 4 ? 'mittel' : 'schlecht', t: 'Stadium ' + s + (s <= 3 ? ': rechtzeitig (spätestens Beginn Ähren-/Rispenschieben)' : s === 4 ? ': volles Rispenschieben – bald mähen' : ': spät – mehr Fasern, weniger Energie, schlechter silierbar'),
        m: s > 3 ? 'Spätestens bei Beginn Ährenschieben der Hauptgräser mähen.' : '', q: [Q.k4b] });
    }
    if (a.sauberkeit) out.push({ ok: a.sauberkeit === 'sauber' ? 'gut' : 'schlecht', t: a.sauberkeit === 'sauber' ? 'Futter sauber' : 'Futter verschmutzt – Erde bringt Buttersäurebakterien ins Silo', m: a.sauberkeit === 'sauber' ? '' : 'Ursache suchen (Haufen, Schnitthöhe, Zinken, Gülle) – siehe Punkte unten.', q: [Q.k4b, Q.k3] });
    return out;
  }

  const k = (p) => (p.antworten && p.antworten.konserv) || {};
  function erledigt(p) { const kv = k(p); if (!kv.verfahren) return false; return punkteFuer(kv.verfahren).every((x) => (kv.items || {})[x.id]); }

  function zusammenfassung(p) {
    const kv = k(p); if (!kv.verfahren) return null;
    const P = punkteFuer(kv.verfahren); const it = kv.items || {};
    const nein = P.filter((x) => it[x.id] === 'nein'); const offen = P.filter((x) => !it[x.id] || it[x.id] === 'offen'); const ja = P.filter((x) => it[x.id] === 'ja');
    const abl = abgeleitet(p, kv.verfahren); const ablSchlecht = abl.filter((x) => x.ok === 'schlecht');
    const erde = ['haufen', 'guelle', 'schnitt', 'zinken', 'boden'].some((id) => it[id] === 'nein') || abl.some((x) => x.ok === 'schlecht' && /verschmutzt/.test(x.t));
    const urteil = erde ? { ton: 'schlecht', t: 'Verschmutzungsrisiko' } : nein.length || ablSchlecht.length ? { ton: 'mittel', t: 'Mit Vorbehalt' } : offen.length ? { ton: 'offen', t: 'Noch offen' } : { ton: 'gut', t: 'Gut vorbereitet' };
    return { urteil, ja: ja.length, total: P.length, nein, offen, abl, verfahren: (VERFAHREN.find((x) => x[0] === kv.verfahren) || [])[1] };
  }

  const STATUS = [['ja', 'ja'], ['nein', 'nein'], ['offen', 'unklar']];
  const quelle = (q) => (q && q.length ? '<span class="kb-q">' + esc(q.join(' · ')) + '</span>' : '');
  function step(p, nurLesen) {
    const kv = k(p); const v = kv.verfahren; const it = kv.items || {};
    const pid = p.id;
    let h = '<section class="q"><h3>Konservierbarkeit des Bestandes</h3><p class="qhint">Lässt sich dieser Bestand gut konservieren? Die Liste prüft Bestand, Feld, Maschinen und Planung – nicht das fertige Futter. Bei «nein» steht, was helfen würde.</p>' +
      '<div class="kb-verfahren" role="group" aria-label="Geplante Konservierung">' + VERFAHREN.map(([id, t]) => '<button type="button" class="chip-btn" data-kb="verfahren" data-val="' + id + '" data-p="' + pid + '" aria-pressed="' + (v === id) + '"' + (nurLesen ? ' disabled' : '') + '>' + esc(t) + '</button>').join('') + '</div></section>';
    if (!v) return h + '<p class="hint">Zuerst die geplante Konservierung wählen.</p>';
    const abl = abgeleitet(p, v);
    if (abl.length) h += '<section class="q"><h4 class="kb-h">Aus Ihren Angaben zur Probe</h4><ul class="kb-liste">' + abl.map((x) => '<li class="kb-abl ' + x.ok + '"><span class="kb-punkt ' + x.ok + '" aria-hidden="true"></span><div><div>' + esc(x.t) + '</div>' + (x.m ? '<div class="small kb-m">' + esc(x.m) + '</div>' : '') + quelle(x.q) + '</div></li>').join('') + '</ul></section>';
    const gruppen = [...new Set(punkteFuer(v).map((x) => x.gruppe))];
    gruppen.forEach((g) => {
      h += '<section class="q"><h4 class="kb-h">' + esc(g) + '</h4><ul class="kb-liste">' + punkteFuer(v).filter((x) => x.gruppe === g).map((x) => {
        const s = it[x.id];
        return '<li class="kb-item"><div class="kb-text"><div>' + esc(x.t) + '</div>' + (s === 'nein' ? '<div class="small kb-m"><b>Massnahme:</b> ' + esc(x.m) + '</div>' : '') + quelle(x.q) + '</div>' +
          '<div class="kb-wahl" role="group" aria-label="' + esc(x.t) + '">' + STATUS.map(([val, t]) => '<button type="button" class="kb-btn ' + val + '" data-kb="item" data-id="' + x.id + '" data-val="' + val + '" data-p="' + pid + '" aria-pressed="' + (s === val) + '"' + (nurLesen ? ' disabled' : '') + '>' + t + '</button>').join('') + '</div></li>';
      }).join('') + '</ul></section>';
    });
    return h + '<p class="hint">Grundlagen: AGFF-Informationsblatt K4b (Silierprozess), ADCF/AGRIDEA-Fiches 2.7.9 (Trocknung) und 12.4 (Heubelüftung), Schlüssel K3a/K3b. Die Zusammenhänge lassen sich im Lernspiel <a href="/drysim/" target="_blank" rel="noopener">drysim</a> ausprobieren.</p>';
  }

  /** Kurzfassung für das Ergebnis */
  function ergebnisKarte(p) {
    const z = zusammenfassung(p); if (!z) return '';
    return '<div class="section-title">Konservierbarkeit</div><div class="card kb-ergebnis ' + z.urteil.ton + '"><div class="row" style="justify-content:space-between;align-items:center"><b>' + esc(z.urteil.t) + '</b><span class="small muted">' + esc(z.verfahren) + ' · ' + z.ja + ' von ' + z.total + ' Punkten erfüllt</span></div>' +
      (z.abl.filter((x) => x.ok !== 'gut').length || z.nein.length ? '<ul class="small kb-offen">' + z.abl.filter((x) => x.ok !== 'gut').map((x) => '<li>' + esc(x.t) + (x.m ? ' – ' + esc(x.m) : '') + '</li>').join('') + z.nein.map((x) => '<li><b>' + esc(x.t) + ':</b> ' + esc(x.m) + '</li>').join('') + '</ul>' : '') +
      (z.offen.length ? '<p class="small muted" style="margin:6px 0 0">Noch offen: ' + z.offen.length + ' Punkt' + (z.offen.length === 1 ? '' : 'e') + '.</p>' : '') +
      '<a class="btn sm" href="#/p/' + p.id + '/konserv" style="margin-top:8px">Checkliste ansehen</a></div>';
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kb]'); if (!b || b.disabled) return;
    const A = app(); const p = A.probeById(b.dataset.p); if (!p) return;
    p.antworten.konserv = p.antworten.konserv || {}; const kv = p.antworten.konserv;
    if (b.dataset.kb === 'verfahren') kv.verfahren = b.dataset.val;
    if (b.dataset.kb === 'item') { kv.items = kv.items || {}; kv.items[b.dataset.id] = kv.items[b.dataset.id] === b.dataset.val ? undefined : b.dataset.val; if (!kv.items[b.dataset.id]) delete kv.items[b.dataset.id]; }
    A.touchProbe(p); A.rerenderDetail(true);
  });

  global.Konservierbarkeit = { step, erledigt, zusammenfassung, ergebnisKarte, VERFAHREN, punkteFuer };
})(window);
