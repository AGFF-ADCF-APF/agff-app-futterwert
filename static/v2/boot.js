/* Futter v2 – Start: Konfiguration lesen, Darstellung vor dem ersten Rendern setzen (kein Inline-Script wegen CSP). */
(function () {
  'use strict';
  try { window.AGFF_V2 = JSON.parse(document.getElementById('agff-config').textContent); } catch (e) { window.AGFF_V2 = {}; }
  try {
    var t = localStorage.getItem('agffV2Theme'); if (t) document.documentElement.dataset.theme = t;
    if (localStorage.getItem('agffV2Outdoor') === '1') document.documentElement.dataset.outdoor = '1';
  } catch (e) { /* Speicher nicht verfügbar */ }
})();
