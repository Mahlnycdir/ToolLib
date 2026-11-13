// Kobras Gerüst (0.22.0): früher der <body> von kobra/index.html, jetzt eine Ansicht in Toollib (#/m/kobra).
// buildRoot() legt die Wurzel an (sie kommt in Toollibs Arbeitsfläche) und einmal die Ebene für Dialoge, Blätter,
// Meldungen und Fenster (sie liegt direkt im <body>, damit sie über allem steht). Das Gerüst ist fester Text aus
// dieser Datei, keine Inhalte aus Projekten oder dem Wissen.
import { t as tr } from '../../app/i18n/i18n.js';

// Texte aus strings.json (0.24.0), für HTML geschützt; das Gerüst entsteht erst beim Öffnen, wenn die Texte da sind
const x = (key) => String(tr(key)).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rootHtml = () => `
  <header class="topbar">
    <button id="btn-projects" class="icon-btn" type="button" aria-label="${x('kobra.projects')}" data-t-aria="kobra.projects"></button>
    <div class="title">
      <span id="py-status" class="py-status s-loading" role="status" aria-label="${x('kobra.status.loading')}"></span>
      <div class="title-text"><span id="proj-name">Kobra</span><span id="file-name"></span></div>
    </div>
    <button id="btn-blocks" class="icon-btn" type="button" aria-label="${x('kobra.blocks.fromCheatsheet')}" data-t-aria="kobra.blocks.fromCheatsheet" title="${x('kobra.blocks.fromCheatsheetKey')}" data-t-title="kobra.blocks.fromCheatsheetKey"></button>
    <button id="btn-run" class="run-btn" type="button" aria-label="${x('kobra.run.start')}" data-t-aria="kobra.run.start"></button>
    <button id="btn-more" class="icon-btn" type="button" aria-label="${x('kobra.more')}" data-t-aria="kobra.more"></button>
  </header>
  <main class="views">
    <section class="view v-files" data-view="files" aria-label="${x('kobra.nav.files')}" data-t-aria="kobra.nav.files">
      <div class="view-head"><h2 data-t="kobra.nav.files">${x('kobra.nav.files')}</h2><div id="files-toolbar" class="toolbar"></div></div>
      <div id="tree" class="tree" role="tree"></div>
    </section>
    <section class="view v-code" data-view="code" aria-label="Code">
      <div id="tabs" class="file-tabs" role="tablist"></div>
      <div class="editor-wrap">
        <div id="editor" class="editor-host"></div>
        <div id="editor-empty" class="editor-empty" hidden>
          <p data-t="kobra.editor.none">${x('kobra.editor.none')}</p>
          <p class="muted" data-t="kobra.editor.noneHint">${x('kobra.editor.noneHint')}</p>
        </div>
      </div>
      <div id="sig-bar" class="sig-bar" hidden></div>
      <div id="keybar" class="keybar" role="toolbar" aria-label="${x('kobra.keybar')}" data-t-aria="kobra.keybar"></div>
    </section>
    <section class="view v-console" data-view="console" aria-label="${x('kobra.nav.console')}" data-t-aria="kobra.nav.console">
      <div class="view-head"><h2 data-t="kobra.nav.console">${x('kobra.nav.console')}</h2><div id="console-toolbar" class="toolbar"></div></div>
      <div id="console-body" class="console"></div>
    </section>
    <section class="view v-packages" data-view="packages" aria-label="${x('kobra.nav.packages')}" data-t-aria="kobra.nav.packages">
      <div class="view-head"><h2 data-t="kobra.nav.packages">${x('kobra.nav.packages')}</h2></div>
      <div id="packages-body" class="scroll-body"></div>
    </section>
    <section class="view v-git" data-view="git" aria-label="${x('kobra.git.title')}" data-t-aria="kobra.git.title">
      <div class="view-head"><h2 data-t="kobra.git.title">${x('kobra.git.title')}</h2></div>
      <div id="git-body" class="scroll-body"></div>
    </section>
  </main>
  <nav id="nav" class="bottom-nav" aria-label="${x('kobra.areas')}" data-t-aria="kobra.areas"></nav>`;

const LAYER = `
  <div id="gui-layer" class="gui-layer" hidden></div>
  <button id="gui-pill" class="gui-pill" type="button" hidden></button>`;

export function buildRoot() {
  const root = document.createElement('div');
  root.id = 'kobra-app';
  root.className = 'kobra-root kobra-scope';
  root.dataset.view = 'code';
  root.dataset.side = 'files';
  root.dataset.embedded = '1';
  root.innerHTML = rootHtml();
  let layer = document.querySelector('.kobra-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'kobra-scope kobra-layer';
    layer.innerHTML = LAYER;
    document.body.append(layer);
  }
  return root;
}

// Nach einem Sprachwechsel (0.24.0): die festen Texte des Gerüsts neu setzen, ohne es neu zu bauen (Editor, Konsole
// und ein laufendes Programm bleiben).
export function relabelRoot(root) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = tr(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', tr(el.dataset.tAria));
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = tr(el.dataset.tTitle);
}

// Wohin Dialoge, Blätter und Meldungen kommen: in die Ebene über allem, damit Kobras Aussehen für sie gilt.
export const overlayHost = () => document.querySelector('.kobra-layer') || document.body;
