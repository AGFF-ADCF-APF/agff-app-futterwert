/* Futter v2 – Prüfseite für Fachleute: alle Texte des Traktors (Hilfe, Praxis-Tipps, Beratung, Massnahmen,
 * Pflanzennamen nach MB 8, Fachstellen) neben dem deutschen Original. Route #/texte/fr bzw. #/texte/it. Nur Anzeige. */
(function (global) {
  'use strict';
  const app = () => global.__app;
  const esc = (s) => app().esc(s);
  const ohneHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  const SPR = { fr: ['Französisch', 'AssistentFR'], it: ['Italienisch', 'AssistentIT'] };
  let FS = null;

  function zeile(feld, de, tr) {
    return '<tr><td class="small muted">' + esc(feld) + '</td><td>' + esc(ohneHtml(de)) + '</td><td' + (tr ? '' : ' class="tp-fehlt"') + '>' + (tr ? esc(ohneHtml(tr)) : '– fehlt –') + '</td></tr>';
  }
  const liste = (l) => (l || []).map((x) => '• ' + x).join('\n');

  function render(r) {
    const sp = SPR[r.id] ? r.id : 'fr'; const X = global[SPR[sp][1]] || {}; const A = global.Assistent || {}; const LR = global.LaborRegeln || {};
    const kopf = '<tr><th style="width:14%">Feld</th><th style="width:43%">Deutsch (Original)</th><th>' + SPR[sp][0] + '</th></tr>';
    const tab = (rows) => '<div class="tbl-wrap"><table class="tbl tp-tab">' + kopf + rows + '</table></div>';
    const T = A.TEXTE || {}; const P = A.PRAXIS || {};
    const hilfe = Object.keys(T).map((k) => { const d = T[k]; const t = (X.T || {})[k] || {};
      return '<tr class="tp-gruppe"><td colspan="3"><b>' + esc(d.titel) + '</b> <span class="small muted">(' + esc(k) + ')</span></td></tr>' + zeile('Titel', d.titel, t.titel) + zeile('Einfach', d.einfach, t.einfach) + zeile('Fachlich', d.fachlich, t.fachlich) +
        (d.bilder ? d.bilder.map((b, i) => zeile('Bild ' + (i + 1), b.cap, t.bilder && t.bilder[i] && t.bilder[i].cap)).join('') : ''); }).join('');
    const praxis = Object.keys(P).map((k) => { const d = P[k]; const t = (X.P || {})[k] || {};
      return '<tr class="tp-gruppe"><td colspan="3"><b>' + esc(k) + '</b></td></tr>' + (d.wie ? zeile('Erinnert an', d.wie, t.wie) : '') + (d.vorgehen ? zeile('So gehst du vor', liste(d.vorgehen), t.vorgehen && liste(t.vorgehen)) : ''); }).join('');
    const F = (global.Beratung && global.Beratung.FRAGEN) || {};
    const fragen = Object.keys(F).map((k) => { const d = F[k]; const t = (X.F || {})[k] || {};
      const mDe = d.mk ? (LR.M || {})[d.mk] : d.massnahmen; const mTr = d.mk ? (X.M || {})[d.mk] : t.massnahmen;
      return '<tr class="tp-gruppe"><td colspan="3"><b>' + esc(d.frage) + '</b></td></tr>' + zeile('Frage', d.frage, t.frage) + zeile('Kurz', d.kurz, t.kurz) +
        (d.ursachen && d.ursachen.length ? zeile('Ursachen', liste(d.ursachen), t.ursachen && liste(t.ursachen)) : '') + (d.ration ? zeile('Fütterung', d.ration, t.ration) : '') +
        (mDe && mDe.length ? zeile('Massnahmen', liste(mDe), mTr && liste(mTr)) : '') + (t.voir ? zeile('Weiterführend', '–', liste(t.voir)) : ''); }).join('');
    const AU = (global.Aufnahme && global.Aufnahme._t) || {};
    const arten = (tabelle, trT) => Object.keys(tabelle || {}).map((n) => { const tr = (trT || {})[n]; return zeile(n, (tabelle[n] || [])[0], tr ? tr[0] + ' – ' + tr[1] : ''); }).join('');
    const nav = '<div class="row" style="flex-wrap:wrap;gap:6px;margin:8px 0">' + [['tp-hilfe', 'Hilfetexte'], ['tp-praxis', 'Praxis-Tipps'], ['tp-fragen', 'Beratung'], ['tp-arten', 'Pflanzen (MB 8)'], ['tp-fs', 'Fachstellen']].map(([id, t]) => '<button class="btn sm" data-tp="' + id + '">' + t + '</button>').join('') +
      '<a class="btn sm ghost" href="#/texte/' + (sp === 'fr' ? 'it' : 'fr') + '">→ ' + SPR[sp === 'fr' ? 'it' : 'fr'][0] + '</a></div>';
    setTimeout(fachstellen, 0, sp);
    return '<div class="bar"><a class="icon-btn" href="#/" aria-label="Zurück">' + app().I.back + '</a><h2>Textprüfung ' + SPR[sp][0] + '<span class="sub">Traktor-Assistent und Beratung – zum Gegenlesen</span></h2></div><div class="pad tp">' +
      '<p class="small">Links das deutsche Original, rechts die Übersetzung. Korrekturen bitte in der Pendenz melden (Feld und gewünschter Text). Merkblätter werden in ' + SPR[sp][0] + ' mit ihrer eigenen Nummer zitiert; deutsche AGFF-Merkblätter sind als deutsches Dokument gekennzeichnet.</p>' + nav +
      '<h3 id="tp-hilfe">Hilfetexte je Schritt</h3>' + tab(hilfe) +
      '<h3 id="tp-praxis">Praxis-Tipps</h3>' + tab(praxis) +
      '<h3 id="tp-fragen">Beratung: Fragen, Ursachen, Massnahmen</h3>' + tab(fragen) +
      '<h3 id="tp-arten">Pflanzen nach AGFF-Merkblatt 8: Name und Massnahme</h3><p class="small muted">Tabelle 3 (zurückdrängen)</p>' + tab(arten(AU.T3, X.T3)) + '<p class="small muted">Tabelle 4 (fördern)</p>' + tab(arten(AU.T4, X.T4)) +
      '<h3 id="tp-fs">Kantonale Fachstellen</h3><div id="tp-fs-inhalt" class="small muted">Wird geladen …</div></div>';
  }
  async function fachstellen(sp) {
    const el = document.getElementById('tp-fs-inhalt'); if (!el) return;
    try { if (!FS) FS = await (await fetch('assets/fachstellen.json')).json(); } catch (e) { el.textContent = 'Nicht verfügbar (offline).'; return; }
    const X = global[SPR[sp][1]] || {}; const h = (X.U && X.U.hinweise) || {};
    el.className = ''; el.innerHTML = '<div class="tbl-wrap"><table class="tbl tp-tab"><tr><th>Kantone</th><th>Fachstelle</th><th>Telefon / E-Mail</th><th>Hinweis (DE → ' + SPR[sp][0] + ')</th></tr>' +
      FS.stellen.map((s) => '<tr><td>' + esc(s.kantone.join(', ')) + '</td><td><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + ' ↗</a></td><td class="small">' + esc([s.telefon, s.email].filter(Boolean).join(' · ') || '–') + '</td><td class="small">' +
        (s.hinweis ? esc(s.hinweis) + '<br><i>' + esc(h[s.hinweis] || '– fehlt –') + '</i>' : '–') + '</td></tr>').join('') + '</table></div><p class="small muted">' + esc(FS.stand || '') + '</p>';
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-tp]'); if (!b) return; const z = document.getElementById(b.dataset.tp); if (z) z.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  global.Textpruefung = { render };
})(window);
