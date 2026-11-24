/*
 * AGFF-Mediathek: eine gemeinsame Videoliste für futter (v2, auch /wiese), Heureka (app.graswachstum.ch/heureka, früher /drysim) und drywatch.
 *
 * Daten: mediathek.json im selben Ordner wie dieses Skript (wird nur hier in futter gepflegt).
 * Heureka liegt seit 23.11.2026 auf einem anderen Host (all-inkl) und nutzt eine Kopie (agff-drysim/public/mediathek/,
 * nachgezogen von tools/seiten.mjs); neue Einträge kommen dort erst mit dem nächsten Heureka-Deploy an.
 * Einbinden in einer anderen App auf demselben Host (apps.graswachstum.ch, dann keine CSP-/CORS-Änderung nötig):
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
 * Standbilder: Bei YouTube-Videos gibt es «Bilder ansehen». Erst dieser Klick lädt die drei Standbilder, die YouTube
 * selbst zu jedem Video bereitstellt (i.ytimg.com/vi/<id>/hq1-3.jpg, ohne Referrer). Nichts davon liegt auf unserem Server.
 * Dafür braucht die CSP der einbindenden Seite img-src https://i.ytimg.com.
 */
(function (global) {
  'use strict';
  var skript = document.currentScript;
  var quelle = skript && skript.src ? new URL(skript.src, location.href) : new URL('assets/mediathek.js', location.href);
  var DATEN_URL = new URL('mediathek.json', quelle).href + (quelle.search || '');

  var TEXTE = {
    de: { min: 'Min.', bis: 'verfügbar bis', alle: 'Alle', leer: 'Keine Videos zu diesem Thema.', hinweis: 'Die Videos öffnen sich in einem neuen Tab beim Anbieter. Für deren Inhalte ist die AGFF nicht verantwortlich.', bilder: 'Bilder ansehen', zu: 'Bilder schliessen', vor: 'Nächstes Bild', zurueck: 'Vorheriges Bild', bild: 'Standbild', von: 'von', bildQuelle: 'Standbilder von YouTube, erst nach dem Klick geladen.', sprache: { de: 'Deutsch', fr: 'Französisch', it: 'Italienisch', en: 'Englisch' } },
    fr: { min: 'min', bis: 'disponible jusqu’au', alle: 'Tous', leer: 'Aucune vidéo sur ce thème.', hinweis: 'Les vidéos s’ouvrent dans un nouvel onglet chez le fournisseur. L’AGFF n’est pas responsable de leur contenu.', bilder: 'Voir les images', zu: 'Fermer les images', vor: 'Image suivante', zurueck: 'Image précédente', bild: 'Image', von: 'sur', bildQuelle: 'Images de YouTube, chargées seulement après le clic.', sprache: { de: 'allemand', fr: 'français', it: 'italien', en: 'anglais' } },
    it: { min: 'min', bis: 'disponibile fino al', alle: 'Tutti', leer: 'Nessun video su questo tema.', hinweis: 'I video si aprono in una nuova scheda presso il fornitore. L’AGFF non è responsabile del loro contenuto.', bilder: 'Vedere le immagini', zu: 'Chiudere le immagini', vor: 'Immagine successiva', zurueck: 'Immagine precedente', bild: 'Immagine', von: 'di', bildQuelle: 'Immagini da YouTube, caricate solo dopo il clic.', sprache: { de: 'tedesco', fr: 'francese', it: 'italiano', en: 'inglese' } },
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

  /** YouTube-ID aus watch-, youtu.be-, shorts- oder embed-Links (sonst ''). */
  function youtubeId(u) {
    var m = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/]|$)/.exec(u || '');
    return m ? m[1] : '';
  }
  var BILDER = ['hq1', 'hq2', 'hq3'];  // von YouTube automatisch gewählte Standbilder (etwa 25, 50, 75 % der Laufzeit)

  function karte(v, T) {
    var meta = [v.quelle, v.anbieter && v.anbieter !== v.quelle ? v.anbieter : '',
      v.dauer ? Math.round(Number(v.dauer)) + ' ' + T.min : '',
      v.datum && DATUM.test(v.datum) ? v.datum.slice(0, 4) : '',
      v.sprache && v.sprache !== sprache() ? (T.sprache[v.sprache] || v.sprache) : ''].filter(Boolean);
    var bis = v.verfuegbarBis && DATUM.test(v.verfuegbarBis) ? '<span class="agm-bis">' + esc(T.bis) + ' ' + esc(datumCH(v.verfuegbarBis)) + '</span>' : '';
    var yt = youtubeId(sichereUrl(v.url));
    return '<li class="agm-karte" data-themen="' + esc((v.themen || []).join(' ')) + '">' +
      '<a class="agm-link" href="' + esc(sichereUrl(v.url)) + '" target="_blank" rel="noopener noreferrer"' + (v.sprache ? ' hreflang="' + esc(v.sprache) + '"' : '') + '>' +
      '<span class="agm-play">' + PLAY + '</span>' +
      '<span class="agm-text"><span class="agm-titel">' + esc(v.titel) + ' <span class="agm-extern" aria-hidden="true">↗</span></span>' +
      (meta.length ? '<span class="agm-meta">' + esc(meta.join(' · ')) + '</span>' : '') +
      (v.beschreibung ? '<span class="agm-besch">' + esc(v.beschreibung) + '</span>' : '') + bis +
      '</span></a>' + (yt && v.bilder !== false ? '<div class="agm-bilder" data-agm-yt="' + esc(yt) + '" data-agm-titel="' + esc(v.titel) + '">' +
      '<button type="button" class="agm-chip agm-bilder-knopf" aria-expanded="false">' + esc(T.bilder) + ' (' + BILDER.length + ')</button></div>' : '') + '</li>';
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

  /** Galerie mit den YouTube-Standbildern: wird erst beim ersten Klick gebaut (lädt dann die Bilder). */
  function galerie(box, i) {
    var T = TEXTE[sprache()]; var id = box.getAttribute('data-agm-yt'); var titel = box.getAttribute('data-agm-titel');
    var n = BILDER.length; i = (i + n) % n; box.setAttribute('data-agm-i', String(i));
    var g = box.querySelector('.agm-galerie');
    if (!g) {
      g = document.createElement('div'); g.className = 'agm-galerie'; g.setAttribute('role', 'group'); g.setAttribute('aria-roledescription', 'Bildfolge');
      g.setAttribute('aria-label', titel); g.tabIndex = -1;
      g.innerHTML = '<div class="agm-buehne"><img class="agm-bild" alt="" referrerpolicy="no-referrer" decoding="async" width="480" height="360">' +
        '<button type="button" class="agm-pfeil agm-pfeil-l" data-agm-schritt="-1" aria-label="' + esc(T.zurueck) + '">‹</button>' +
        '<button type="button" class="agm-pfeil agm-pfeil-r" data-agm-schritt="1" aria-label="' + esc(T.vor) + '">›</button></div>' +
        '<div class="agm-galerie-fuss"><span class="agm-zaehler" aria-live="polite"></span><span class="agm-bildquelle">' + esc(T.bildQuelle) + '</span></div>';
      box.appendChild(g);
      BILDER.forEach(function (b) { var x = new Image(); x.referrerPolicy = 'no-referrer'; x.src = 'https://i.ytimg.com/vi/' + id + '/' + b + '.jpg'; });  // vorladen fürs Blättern
    }
    var img = g.querySelector('.agm-bild');
    img.src = 'https://i.ytimg.com/vi/' + id + '/' + BILDER[i] + '.jpg';
    img.alt = T.bild + ' ' + (i + 1) + ' ' + T.von + ' ' + n + ': ' + titel;
    g.querySelector('.agm-zaehler').textContent = (i + 1) + ' / ' + n;
    return g;
  }
  function bilderKlick(e) {
    var k = e.target.closest && e.target.closest('.agm-bilder-knopf');
    var s = e.target.closest && e.target.closest('[data-agm-schritt]');
    if (k) {
      var box = k.closest('.agm-bilder'); var T = TEXTE[sprache()]; var auf = k.getAttribute('aria-expanded') !== 'true';
      k.setAttribute('aria-expanded', String(auf)); k.textContent = auf ? T.zu : T.bilder + ' (' + BILDER.length + ')';
      if (auf) galerie(box, Number(box.getAttribute('data-agm-i') || 0)).hidden = false;
      else { var g = box.querySelector('.agm-galerie'); if (g) g.hidden = true; }
      return true;
    }
    if (s) { var b2 = s.closest('.agm-bilder'); galerie(b2, Number(b2.getAttribute('data-agm-i') || 0) + Number(s.getAttribute('data-agm-schritt'))); return true; }
    return false;
  }
  document.addEventListener('keydown', function (e) {
    var g = e.target.closest && e.target.closest('.agm-galerie');
    if (!g || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    var box = g.closest('.agm-bilder'); e.preventDefault();
    galerie(box, Number(box.getAttribute('data-agm-i') || 0) + (e.key === 'ArrowRight' ? 1 : -1));
  });
  // Wischen auf dem Handy
  var wischX = null;
  document.addEventListener('touchstart', function (e) { wischX = e.target.closest && e.target.closest('.agm-buehne') ? e.touches[0].clientX : null; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (wischX == null) return; var dx = e.changedTouches[0].clientX - wischX; wischX = null;
    var box = e.target.closest && e.target.closest('.agm-bilder'); if (!box || Math.abs(dx) < 40) return;
    galerie(box, Number(box.getAttribute('data-agm-i') || 0) + (dx < 0 ? 1 : -1));
  }, { passive: true });

  function filtern(e) {
    if (bilderKlick(e)) return;
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
