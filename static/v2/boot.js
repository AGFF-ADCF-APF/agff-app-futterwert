/* Futter v2 – Start: Konfiguration lesen, Darstellung vor dem ersten Rendern setzen (kein Inline-Script wegen CSP). */
(function () {
  'use strict';
  try { window.AGFF_V2 = JSON.parse(document.getElementById('agff-config').textContent); } catch (e) { window.AGFF_V2 = {}; }
  // Modus «Wiese» (Adresse /wiese): gleiche App, Start und Umschalter angepasst
  try { if (window.AGFF_V2.modus === 'wiese') document.documentElement.dataset.modus = 'wiese'; } catch (e) { /* egal */ }
  // Wiese in eine eigene App ausgelagert (all-inkl: Pratum unter /pratum/, gleicher Ursprung, gleiche Daten im Browser): weiterleiten, #… bleibt
  try {
    var w = window.AGFF_V2.wieseUrl;
    if (window.AGFF_V2.modus === 'wiese' && w && w.charAt(0) === '/' && location.pathname.indexOf(w) !== 0 && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      location.replace(w + location.hash);
    }
  } catch (e) { /* egal */ }
  try {
    var t = localStorage.getItem('agffV2Theme'); if (t) document.documentElement.dataset.theme = t;
    if (localStorage.getItem('agffV2Outdoor') === '1') document.documentElement.dataset.outdoor = '1';
  } catch (e) { /* Speicher nicht verfügbar */ }
})();
