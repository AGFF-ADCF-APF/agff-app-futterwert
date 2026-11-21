/*
 * AGFF-Mediathek: eine gemeinsame Videoliste für futter (v2, auch /wiese), Heureka (/heureka, früher /drysim) und drywatch.
 *
 * Daten: mediathek.json im selben Ordner wie dieses Skript (wird nur hier in futter gepflegt).
 * Einbinden in einer anderen App (gleicher Host apps.graswachstum.ch, daher keine CSP-/CORS-Änderung nötig):
 *   <link rel="stylesheet" href="/futter/v2/assets/mediathek.css">
 *   <script src="/futter/v2/assets/mediathek.js" defer></script>
 *   <div data-agff-mediathek data-app="heureka" data-themen="anwelken,heu" data-filter></div>
 * Attribute: data-app (blendet Einträge mit anderer apps-Liste aus), data-themen (nur diese Themen, kommagetrennt),
 *   data-filter (Themen-Knöpfe zum Filtern), data-leer="text" (Text, wenn nichts passt; sonst bleibt das Element verborgen).
 *   Ein umgebendes Element mit data-agm-rahmen (z. B. mit Überschrift) wird mit ein- und ausgeblendet.
 * Für Seiten, die ihren Inhalt nachträglich schreiben: AGFFMediathek.einblenden(wurzel).
 *
 * Datenschutz: Es wird nichts eingebettet. Jede Karte ist ein gewöhnlicher Link, der das Video beim Anbieter
 * in einem neuen Tab öffnet (rel="noopener noreferrer"). Ohne Klick fliesst nichts an ARD, YouTube usw.
 */
(function (global) {
  'use strict';
  var skript = document.currentScript;
  var quelle = skript && skript.src ? new URL(skript.src, location.href) : new URL('assets/mediathek.js', location.href);
  var DATEN_URL = new URL('mediathek.json', quelle).href + (quelle.search || '');

  var TEXTE = {
    de: { min: 'Min.', bis: 'verfügbar bis', alle: 'Alle', leer: 'Keine Videos zu diesem Thema.', hinweis: 'Die Videos öffnen sich in einem neuen Tab beim Anbieter. Für deren Inhalte ist die AGFF nicht verantwortlich.', sprache: { de: 'Deutsch', fr: 'Französisch', it: 'Italienisch', en: 'Englisch' } },
    fr: { min: 'min', bis: 'disponible jusqu’au', alle: 'Tous', leer: 'Aucune vidéo sur ce thème.', hinweis: 'Les vidéos s’ouvrent dans un nouvel onglet chez le fournisseur. L’AGFF n’est pas responsable de leur contenu.', sprache: { de: 'allemand', fr: 'français', it: 'italien', en: 'anglais' } },
    it: { min: 'min', bis: 'disponibile fino al', alle: 'Tutti', leer: 'Nessun video su questo tema.', hinweis: 'I video si aprono in una nuova scheda presso il fornitore. L’AGFF non è responsabile del loro contenuto.', sprache: { de: 'tedesco', fr: 'francese', it: 'italiano', en: 'inglese' } },
  };
  function sprache() { var l = (document.documentElement.lang || 'de').slice(0, 2).toLowerCase(); return TEXTE[l] ? l : 'de'; }

  var ladung = null;
  /** Lädt die Liste einmal je Seite; bei Fehler (offline, andere Domain) null. */
  function laden() {
    if (!ladung) {
      ladung = fetch(DATEN_URL, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return j && Array.isArray(j.videos) ? j : null; })
        .catch(function () { return null; });
    }
    return ladung;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sichereUrl(u) { try { var x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch (e) { return ''; } }
  function heute() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var DATUM = /^\d{4}-\d{2}-\d{2}$/;
  function datumCH(iso) { var t = iso.split('-'); return Number(t[2]) + '.' + Number(t[1]) + '.' + t[0]; }

  /** Einträge, die zu App und Themen passen und nicht abgelaufen sind (Reihenfolge wie in der Datei). */
  function auswahl(daten, opt) {
    var h = heute();
    return daten.videos.filter(function (v) {
      if (!v || !sichereUrl(v.url) || !v.titel) return false;
      if (v.verfuegbarBis && DATUM.test(v.verfuegbarBis) && v.verfuegbarBis < h) return false;
      if (opt.app && Array.isArray(v.apps) && v.apps.length && v.apps.indexOf(opt.app) < 0) return false;
      if (opt.themen && opt.themen.length && !(v.themen || []).some(function (t) { return opt.themen.indexOf(t) >= 0; })) return false;
      return true;
    });
  }

  var PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';

  function karte(v, T) {
    var meta = [v.quelle, v.anbieter && v.anbieter !== v.quelle ? v.anbieter : '',
      v.dauer ? Math.round(Number(v.dauer)) + ' ' + T.min : '',
      v.datum && DATUM.test(v.datum) ? v.datum.slice(0, 4) : '',
      v.sprache && v.sprache !== sprache() ? (T.sprache[v.sprache] || v.sprache) : ''].filter(Boolean);
    var bis = v.verfuegbarBis && DATUM.test(v.verfuegbarBis) ? '<span class="agm-bis">' + esc(T.bis) + ' ' + esc(datumCH(v.verfuegbarBis)) + '</span>' : '';
    return '<li class="agm-karte" data-themen="' + esc((v.themen || []).join(' ')) + '">' +
      '<a class="agm-link" href="' + esc(sichereUrl(v.url)) + '" target="_blank" rel="noopener noreferrer"' + (v.sprache ? ' hreflang="' + esc(v.sprache) + '"' : '') + '>' +
      '<span class="agm-play">' + PLAY + '</span>' +
      '<span class="agm-text"><span class="agm-titel">' + esc(v.titel) + ' <span class="agm-extern" aria-hidden="true">↗</span></span>' +
      (meta.length ? '<span class="agm-meta">' + esc(meta.join(' · ')) + '</span>' : '') +
      (v.beschreibung ? '<span class="agm-besch">' + esc(v.beschreibung) + '</span>' : '') + bis +
      '</span></a></li>';
  }

  function zeigen(el, ja) { el.hidden = !ja; var r = el.closest('[data-agm-rahmen]'); if (r) r.hidden = !ja; }

  function zeichnen(el, daten) {
    var T = TEXTE[sprache()];
    var themen = (el.getAttribute('data-themen') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var liste = auswahl(daten, { app: el.getAttribute('data-app') || '', themen: themen });
    el.classList.add('agm');
    if (!liste.length) {
      var leer = el.getAttribute('data-leer');
      el.innerHTML = leer ? '<p class="agm-leer">' + esc(leer) + '</p>' : '';
      zeigen(el, !!leer);
      return;
    }
    var knoepfe = '';
    if (el.hasAttribute('data-filter')) {
      var vorhanden = [];
      liste.forEach(function (v) { (v.themen || []).forEach(function (t) { if ((!themen.length || themen.indexOf(t) >= 0) && vorhanden.indexOf(t) < 0) vorhanden.push(t); }); });
      var namen = daten.themenNamen || {};
      if (vorhanden.length > 1) {
        knoepfe = '<div class="agm-filter" role="group"><button type="button" class="agm-chip" data-agm-thema="" aria-pressed="true">' + esc(T.alle) + '</button>' +
          vorhanden.map(function (t) { return '<button type="button" class="agm-chip" data-agm-thema="' + esc(t) + '" aria-pressed="false">' + esc(namen[t] || t) + '</button>'; }).join('') + '</div>';
      }
    }
    el.innerHTML = knoepfe + '<ul class="agm-liste">' + liste.map(function (v) { return karte(v, T); }).join('') + '</ul>' +
      '<p class="agm-hinweis">' + esc(T.hinweis) + '</p>';
    zeigen(el, true);
  }

  function filtern(e) {
    var b = e.target.closest && e.target.closest('[data-agm-thema]');
    if (!b) return;
    var el = b.closest('.agm'); var t = b.getAttribute('data-agm-thema');
    el.querySelectorAll('[data-agm-thema]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    el.querySelectorAll('.agm-karte').forEach(function (k) { k.hidden = !!t && (' ' + k.getAttribute('data-themen') + ' ').indexOf(' ' + t + ' ') < 0; });
  }
  document.addEventListener('click', filtern);

  /** Füllt alle [data-agff-mediathek] unterhalb von wurzel (Standard: ganze Seite), die noch leer sind. */
  function einblenden(wurzel) {
    var els = Array.prototype.slice.call((wurzel || document).querySelectorAll('[data-agff-mediathek]:not([data-agm-fertig])'));
    if (!els.length) return Promise.resolve();
    els.forEach(function (el) { el.setAttribute('data-agm-fertig', ''); zeigen(el, false); });
    return laden().then(function (daten) {
      els.forEach(function (el) {
        if (!el.isConnected) return;
        if (daten) zeichnen(el, daten); else { el.innerHTML = ''; zeigen(el, false); }
      });
    });
  }

  global.AGFFMediathek = { laden: laden, einblenden: einblenden, datenUrl: DATEN_URL };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { einblenden(); });
  else einblenden();
})(window);
