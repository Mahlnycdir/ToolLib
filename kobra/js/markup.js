// Kobras Gerüst (0.22.0): früher der <body> von kobra/index.html, jetzt eine Ansicht in Toollib (#/m/kobra).
// buildRoot() legt die Wurzel an (sie kommt in Toollibs Arbeitsfläche) und einmal die Ebene für Dialoge, Blätter,
// Meldungen und Fenster (sie liegt direkt im <body>, damit sie über allem steht). Das Gerüst ist fester Text aus
// dieser Datei, keine Inhalte aus Projekten oder dem Wissen.
const ROOT = `
  <header class="topbar">
    <button id="btn-projects" class="icon-btn" type="button" aria-label="Projekte"></button>
    <div class="title">
      <span id="py-status" class="py-status s-loading" role="status" aria-label="Python lädt"></span>
      <div class="title-text"><span id="proj-name">Kobra</span><span id="file-name"></span></div>
    </div>
    <button id="btn-blocks" class="icon-btn" type="button" aria-label="Bausteine aus dem Spickzettel" title="Bausteine aus dem Spickzettel (⌘/Strg+J)"></button>
    <button id="btn-run" class="run-btn" type="button" aria-label="Programm starten"></button>
    <button id="btn-more" class="icon-btn" type="button" aria-label="Weitere Befehle"></button>
  </header>
  <main class="views">
    <section class="view v-files" data-view="files" aria-label="Dateien">
      <div class="view-head"><h2>Dateien</h2><div id="files-toolbar" class="toolbar"></div></div>
      <div id="tree" class="tree" role="tree"></div>
    </section>
    <section class="view v-code" data-view="code" aria-label="Code">
      <div id="tabs" class="file-tabs" role="tablist"></div>
      <div class="editor-wrap">
        <div id="editor" class="editor-host"></div>
        <div id="editor-empty" class="editor-empty" hidden>
          <p>Keine Datei geöffnet.</p>
          <p class="muted">Wähle links unter <strong>Dateien</strong> eine Datei oder lege eine neue an.</p>
        </div>
      </div>
      <div id="sig-bar" class="sig-bar" hidden></div>
      <div id="keybar" class="keybar" role="toolbar" aria-label="Zusatztasten"></div>
    </section>
    <section class="view v-console" data-view="console" aria-label="Konsole">
      <div class="view-head"><h2>Konsole</h2><div id="console-toolbar" class="toolbar"></div></div>
      <div id="console-body" class="console"></div>
    </section>
    <section class="view v-packages" data-view="packages" aria-label="Pakete">
      <div class="view-head"><h2>Pakete</h2></div>
      <div id="packages-body" class="scroll-body"></div>
    </section>
    <section class="view v-git" data-view="git" aria-label="Versionskontrolle">
      <div class="view-head"><h2>Versionskontrolle</h2></div>
      <div id="git-body" class="scroll-body"></div>
    </section>
  </main>
  <nav id="nav" class="bottom-nav" aria-label="Bereiche"></nav>`;

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
  root.innerHTML = ROOT;
  let layer = document.querySelector('.kobra-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'kobra-scope kobra-layer';
    layer.innerHTML = LAYER;
    document.body.append(layer);
  }
  return root;
}

// Wohin Dialoge, Blätter und Meldungen kommen: in die Ebene über allem, damit Kobras Aussehen für sie gilt.
export const overlayHost = () => document.querySelector('.kobra-layer') || document.body;
