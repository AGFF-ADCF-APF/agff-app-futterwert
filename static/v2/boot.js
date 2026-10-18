/* Futter v2 – Start: Konfiguration lesen, Darstellung vor dem ersten Rendern setzen (kein Inline-Script wegen CSP). */
(function () {
  'use strict';
  try { window.AGFF_V2 = JSON.parse(document.getElementById('agff-config').textContent); } catch (e) { window.AGFF_V2 = {}; }
  try {
    var t = localStorage.getItem('agffV2Theme'); if (t) document.documentElement.dataset.theme = t;
    if (localStorage.getItem('agffV2Outdoor') === '1') document.documentElement.dataset.outdoor = '1';
  } catch (e) { /* Speicher nicht verfügbar */ }
})();

/* Text der Ecke «zurück zu v1» in der Sprache des Browsers */
document.addEventListener('DOMContentLoaded', function () {
  try {
    var l = ((navigator.languages && navigator.languages[0]) || navigator.language || 'de').slice(0, 2).toLowerCase();
    var t = { de: ['zurück zu v1', 'Zur bisherigen Version 1 wechseln – Ihre Daten in v2 bleiben im Browser.'],
      fr: ['retour à v1', 'Revenir à la version 1 – vos données de v2 restent dans le navigateur.'],
      it: ['torna a v1', 'Tornare alla versione 1 – i dati di v2 restano nel browser.'],
      en: ['Back to v1', 'Go back to version 1 – your v2 data stays in your browser.'] }[l] || ['Back to v1', 'Go back to version 1 – your v2 data stays in your browser.'];
    var a = document.querySelector('.v1-ecke a'); if (a) { a.textContent = t[0]; a.title = t[1]; a.lang = l; }
  } catch (e) { /* Standardtext bleibt */ }
});
