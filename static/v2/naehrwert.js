/* Futter v2 – Nährwertberechnung aus Laborgehalten nach Agroscope, Grünes Buch, Kapitel 15
 * (Daccord, Arrigo, Chaubert: Formeln und Regressionsgleichungen).
 *
 * Raufutter: vOS je Konservierung und Pflanzenbestand aus RP und RF (oder ADF), korrigiert nach Aufwuchs/Stadium
 * (Tab. 15.1/15.2) → VOS, VP → BE, UE, q → NEL (kL), NEV (kEnV) → aRP, vASF, FOS → APDE, APDN.
 * Mais ganze Pflanze: vOS Formel 1 mit Agroscope-Korrektur 2012, UE = 0.0155 VOS, aRP/vASF/Stärke nach Tab. 15.3/15.4.
 * Alle Gehalte in g/kg TS, Energie in MJ/kg TS.
 */
(function (global) {
  'use strict';

  // vOS-Gleichungen: [a, bRP, bFaser, cRP², cFaser²] → vOS = a + bRP·RPOS + bF·FOS + cRP·RPOS² + cF·FOS² (Faser = RF oder ADF)
  // Konservierung: gruen | silage | heu | kuenstlich; Bestand: G GR A AR L KF KG Unb sowie Reinbestände ITRG (It. Raigras), LUZ (Luzerne)
  const VOS = {
    gruen: {
      G: { rf: [34.0, 0.1654, 0.1776, -0.000257, -0.000391], adf: [25.7, 0.1654, 0.2169, -0.000256, -0.000413] },
      GR: { rf: [21.9, 0.1209, 0.3580, -0.000186, -0.000794], adf: [13.3, 0.1209, 0.3823, -0.000186, -0.000746] },
      A: { rf: [40.6, 0.1599, 0.1431, -0.000248, -0.000351], adf: [32.3, 0.1599, 0.1866, -0.000248, -0.000382] },
      AR: { rf: [43.2, 0.0859, 0.2559, -0.000132, -0.000678], adf: [34.4, 0.0863, 0.2914, -0.000133, -0.000647] },
      L: { rf: [86.0, 0, 0, 0, -0.000231], adf: [87.4, 0, 0, 0, -0.000179] },
      KF: { rf: [58.9, 0.0792, 0.1320, -0.000121, -0.000428], adf: [48.6, 0.0779, 0.2008, -0.000118, -0.000487] },
      KG: { rf: [43.6, 0.1806, 0.1384, -0.000298, -0.000475], adf: [35.2, 0.1813, 0.1512, -0.000299, -0.000311] },
      Unb: { rf: [56.7, 0.1262, 0.0939, -0.000231, -0.000312], adf: [54.8, 0.1121, 0.1221, -0.000207, -0.000335] },
      ITRG: { rf: [101.7, 0, 0, 0, -0.000446], adf: [101.1, 0, 0, 0, -0.000339] },
      LUZ: { rf: [52.4, 0.0898, 0, 0, -0.000062], adf: [56.7, 0.0796, 0, 0, -0.000060] },
    },
    silage: {
      G: { rf: [26.3, 0.1653, 0.2041, -0.000241, -0.000419], adf: [10.8, 0.1652, 0.2793, -0.000240, -0.000484] },
      GR: { rf: [10.4, 0.1206, 0.4102, -0.000174, -0.000849], adf: [-9.4, 0.1206, 0.4916, -0.000174, -0.000872] },
      A: { rf: [34.1, 0.1596, 0.1653, -0.000233, -0.000376], adf: [19.4, 0.1596, 0.2424, -0.000232, -0.000447] },
      AR: { rf: [34.9, 0.0857, 0.2967, -0.000124, -0.000724], adf: [16.9, 0.0864, 0.3815, -0.000125, -0.000755] },
      L: { rf: [85.8, 0, 0, 0, -0.000229], adf: [88.3, 0, 0, 0, -0.000181] },
      KF: { rf: [54.0, 0.0780, 0.1557, -0.000111, -0.000457], adf: [36.1, 0.0759, 0.2680, -0.000107, -0.000572] },
      KG: { rf: [37.4, 0.1809, 0.1622, -0.000280, -0.000500], adf: [24.2, 0.1819, 0.1929, -0.000282, -0.000355] },
      Unb: { rf: [51.8, 0.1275, 0.1116, -0.000219, -0.000333], adf: [45.7, 0.1145, 0.1661, -0.000199, -0.000390] },
      ITRG: { rf: [103.8, 0, 0, 0, -0.000449], adf: [104.1, 0, 0, 0, -0.000341] },
      LUZ: { rf: [72.3, 0.0249, 0, 0, -0.000128], adf: [65.3, 0.0517, 0, 0, -0.000088] },
    },
    heu: {
      G: { rf: [28.5, 0.1769, 0.1730, -0.000313, -0.000351], adf: [20.4, 0.1769, 0.2090, -0.000312, -0.000371] },
      GR: { rf: [14.8, 0.1292, 0.3494, -0.000226, -0.000713], adf: [6.6, 0.1292, 0.3694, -0.000226, -0.000670] },
      A: { rf: [35.1, 0.1710, 0.1408, -0.000302, -0.000315], adf: [26.9, 0.1711, 0.1809, -0.000302, -0.000343] },
      AR: { rf: [35.8, 0.0920, 0.2539, -0.000162, -0.000609], adf: [27.3, 0.0924, 0.2846, -0.000162, -0.000581] },
      L: { rf: [80.4, 0, 0, 0, -0.000189], adf: [81.6, 0, 0, 0, -0.000149] },
      KF: { rf: [52.2, 0.0845, 0.1341, -0.000147, -0.000385], adf: [41.7, 0.0829, 0.1981, -0.000143, -0.000439] },
      KG: { rf: [37.6, 0.1940, 0.1411, -0.000363, -0.000425], adf: [29.9, 0.1947, 0.1464, -0.000365, -0.000278] },
      Unb: { rf: [50.6, 0.1360, 0.0952, -0.000282, -0.000280], adf: [48.5, 0.1210, 0.1214, -0.000254, -0.000300] },
      ITRG: { rf: [95.5, 0, 0, 0, -0.000370], adf: [93.9, 0, 0, 0, -0.000277] },
      LUZ: { rf: [76.8, 0, 0, 0, -0.000131], adf: [78.1, 0, 0, 0, -0.000107] },
    },
    kuenstlich: {
      G: { rf: [65.3, 0.0869, 0.0692, -0.000175, -0.000299], adf: [57.4, 0.1132, 0.1171, -0.000271, -0.000336] },
      GR: { rf: [63.8, 0, 0.1905, 0, -0.000602], adf: [41.4, 0, 0.3186, 0, -0.000707] },
      A: { rf: [80.8, 0, 0.0383, 0, -0.000285], adf: [66.4, 0, 0.1432, 0, -0.000404] },
      AR: { rf: [63.2, 0, 0.1888, 0, -0.000610], adf: [42.7, 0, 0.3090, 0, -0.000697] },
      L: { rf: [74.8, 0, 0.0693, 0, -0.000363], adf: [68.3, 0, 0.1159, 0, -0.000360] },
      KF: { rf: [70.2, 0, 0.1057, 0, -0.000414], adf: [50.21, 0, 0.2478, 0, -0.000582] },
      KG: { rf: [56.6, 0.1229, 0.1021, -0.000237, -0.000459], adf: [48.4, 0.2396, 0.0452, -0.000507, -0.000200] },
      Unb: { rf: [48.6, 0.1603, 0.0710, -0.000344, -0.000250], adf: [42.8, 0.1450, 0.1241, -0.000320, -0.000305] },
      LUZ: { rf: [78.7, 0, 0, 0, -0.000149], adf: [80.8, 0, 0, 0, -0.000118] },
    },
  };
  // Korrektureinheiten vOS (Tab. 15.1; Reinbestände Tab. 15.2: LM = It. Raigras, MS = Luzerne) – [1. Aufwuchs St. 1–5], [Folgeaufwüchse St. 1–5]
  const KORR = {
    G: [[5, 5, 4, 3, 0], [-2, -2, -2, -2, -3]], GR: [[6, 6, 5, 5, 3], [-1, -1, -2, -4, -4]], A: [[4, 4, 4, 3, 0], [-2, -2, -3, -3, -3]],
    AR: [[5, 5, 5, 5, 2], [-1, -1, -2, -3, -3]], L: [[3, 4, 5, 5, 3], [2, 1, 0, 0, -1]], KF: [[3, 3, 3, 3, 2], [-2, -2, -2, -2, -4]],
    KG: [[2, 2, 2, -1, -5], [1, -1, -4, -6, -11]], Unb: [[5, 5, 5, 4, 4], [-3, -3, -4, -3, -3]],
    ITRG: [[-3, -1, 3, 4, -2], [0, 3, 4, 2, -3]], LUZ: [[1, 1, 1, 1, 1], [-3, -2, -1, -2, -1]],
  };
  const BESTAND_NAMEN = { G: 'Gräserreich', GR: 'Gräserreich, Raigras', A: 'Ausgewogen', AR: 'Ausgewogen, Raigras', L: 'Kleereich', KF: 'Kräuterreich, feinblättrig', KG: 'Kräuterreich, grobstänglig', Unb: 'Unbekannt', ITRG: 'Italienisch Raigras', LUZ: 'Luzerne' };

  function korrektur(bestand, kons, aufwuchs, stadium) {
    const k = KORR[bestand]; if (!k) return 0;
    const reihe = aufwuchs === 'f' ? k[1] : k[0];
    const st = Number(stadium);
    if (st >= 1) return reihe[Math.min(5, st) - 1];
    // Stadium unbekannt: Mittel St. 2/3 (Grünfutter, Silage, künstlich getrocknet) bzw. 3/4 (Dürrfutter)
    return kons === 'heu' ? (reihe[2] + reihe[3]) / 2 : (reihe[1] + reihe[2]) / 2;
  }

  /**
   * @param {object} lab   {rp, rf?, adf?, ra?, rl?, ts? (%), ndf?}
   * @param {object} o     {kons: 'gruen'|'silage'|'heu'|'kuenstlich'|'mais', bestand, aufwuchs: '1'|'f', stadium}
   * @returns {object|null} {vos, nel, nev, apde, apdn, faser:'rf'|'adf', annahmen:[], ausserhalb:bool}
   */
  function berechnen(lab, o) {
    const annahmen = [];
    const rp = lab.rp; if (!(rp > 0)) return null;
    let ra = lab.ra; if (!(ra > 0)) { ra = o.kons === 'mais' ? 40 : 100; annahmen.push('Rohasche ' + ra + ' g/kg TS angenommen'); }
    const rl = lab.rl > 0 ? lab.rl : 35;
    const os = 1000 - ra; const rpos = rp / os * 1000;
    let vos; let faser; let ausserhalb = false;
    if (o.kons === 'mais') {
      if (!(lab.rf > 0)) return null;
      faser = 'rf';
      const v1 = 79.4 + 0.0652 * rpos - 0.0591 * (lab.rf / os * 1000);
      vos = 1.2812 * (v1 / 100 * os) - 180.35; // VOS korrigiert (Agroscope 2012), g/kg TS
    } else {
      const g = VOS[o.kons] && (VOS[o.kons][o.bestand] || VOS[o.kons].Unb);
      if (!g) return null;
      if (!VOS[o.kons][o.bestand]) annahmen.push('Gleichung «unbekannte Zusammensetzung»');
      faser = lab.rf > 0 ? 'rf' : lab.adf > 0 ? 'adf' : null; if (!faser) return null;
      const fos = lab[faser] / os * 1000; const c = g[faser];
      let v = c[0] + c[1] * rpos + c[2] * fos + c[3] * rpos * rpos + c[4] * fos * fos;
      v += korrektur(VOS[o.kons][o.bestand] ? o.bestand : 'Unb', o.kons, o.aufwuchs, o.stadium);
      if (rp < 50 || rp > 280 || (faser === 'rf' && (lab.rf < 130 || lab.rf > 400)) || (faser === 'adf' && (lab.adf < 170 || lab.adf > 420)) || v < 55 || v > 84) ausserhalb = true;
      vos = os * v / 100;
    }
    const heuArt = o.kons === 'heu' || o.kons === 'kuenstlich';
    const vp = rp * ((heuArt ? 0.29 : 0.33) + 0.0033 * rpos - (heuArt ? 0.0000064 : 0.0000061) * rpos * rpos);
    const be = o.kons === 'mais' ? 0.0196 * os : 0.0188 * os + 0.0078 * rp;
    const ue = o.kons === 'mais' ? 0.0155 * vos : (vos / vp < 7 ? 0.0142 * vos + 0.0059 * vp : 0.0151 * vos);
    const q = ue / be;
    const kL = 0.463 + 0.24 * q; const kEn = 0.554 + 0.287 * q; const kV = 0.006 + 0.78 * q; const kEnV = (1.5 * kEn * kV) / (0.5 * kEn + kV);
    const nel = kL * ue * 0.9752; const nev = kEnV * ue;
    // Protein
    const ts = lab.ts > 0 ? lab.ts : (o.kons === 'silage' ? 35 : o.kons === 'mais' ? 33 : o.kons === 'gruen' ? 18 : 88);
    let arp; let vasf; let st = 0; let ast = 0; let fp = 0;
    if (o.kons === 'gruen') { arp = 51.2 + 0.126 * rpos - 0.00014 * rpos * rpos; vasf = 65.0 + 0.132 * rpos - 0.00014 * rpos * rpos; }
    else if (o.kons === 'silage') {
      arp = (ts < 50 ? 59.5 : 54.5) + 0.153 * rpos - 0.00020 * rpos * rpos;
      vasf = ts < 50 ? 62.8 + 0.138 * rpos - 0.00016 * rpos * rpos : 60.5 + 0.127 * rpos - 0.00018 * rpos * rpos;
      fp = ts > 60 ? 0 : 205 - 3.0 * ts;
    } else if (o.kons === 'heu') { arp = 48.9 + 0.144 * rpos - 0.00020 * rpos * rpos; vasf = 58.5 + 0.127 * rpos - 0.00018 * rpos * rpos; }
    else if (o.kons === 'kuenstlich') { arp = 51.9 + 0.092 * rpos - 0.00015 * rpos * rpos; vasf = 56.4 + 0.141 * rpos - 0.00023 * rpos * rpos; }
    else { arp = 72; vasf = 72; st = lab.staerke > 0 ? lab.staerke : 315; ast = 70; fp = ts > 60 ? 0 : 150 - 2.5 * ts; if (!(lab.staerke > 0)) annahmen.push('Stärke 315 g/kg TS angenommen'); }
    if (fp && !(lab.fp > 0)) annahmen.push('Gärprodukte aus TS ' + Math.round(ts) + ' % geschätzt');
    if (lab.fp > 0) fp = lab.fp;
    const fosF = vos - rp * (1 - arp / 100) - rl - fp * 0.5 - st * (1 - ast / 100);
    const durch = rp * (1.11 * (1 - arp / 100)) * vasf / 100;
    const apde = 0.093 * fosF + durch;
    const apdn = rp * (arp / 100 - 0.10) * 0.64 + durch;
    if (!(lab.rl > 0)) annahmen.push('Rohfett 35 g/kg TS');
    return { vos: vos / os * 100, nel, nev, apde, apdn, q, faser, annahmen, ausserhalb };
  }

  /** Konservierung der App-Futterarten. */
  const KONS = { heu: 'heu', gras: 'silage', mais: 'mais' };

  global.Naehrwert = { berechnen, korrektur, KONS, BESTAND_NAMEN, BESTAENDE: ['G', 'GR', 'A', 'AR', 'L', 'KF', 'KG', 'ITRG', 'LUZ', 'Unb'] };
})(typeof window !== 'undefined' ? window : globalThis);
