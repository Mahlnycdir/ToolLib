# build-vendor

Baut die Bibliotheken als ES-Module:

- `vendor/git.js`: isomorphic-git (Git im Browser), LightningFS (Dateien in IndexedDB), diff3 (Zusammenführen von Text) und ein Buffer-Ersatz. Genutzt von `app/services/storage.js` und `app/services/sync.js`.
- `vendor/search.js`: MiniSearch (Suchindex) und js-yaml (Kopfdaten lesen). Genutzt von `app/services/nodes.js` und `app/services/search.js`.
- `vendor/katex/`: KaTeX 0.19.1 (Formeln setzen) als ES-Modul `katex.js`, dazu `katex.min.css`, die woff2-Schriften und die Lizenz. Genutzt von `app/shell/math.js` (seit 0.12.0).

- `vendor/reader.js`: Readability 0.6.0 (Hauptinhalt einer Seite), Turndown 7.2.4 mit turndown-plugin-gfm 1.0.2 (HTML → Markdown) und fflate 0.8.3 (gzip, zip) als ein Modul; Einstieg `entry-reader.js`. Genutzt vom Leser (`app/services/reader-*.js`, seit 0.14.1).
- `vendor/editor/`: CodeMirror 6 (Editor der Seiten und Knoten seit 0.17.0) mit Markdown, LaTeX (stex), Python, JavaScript, YAML, Shell; Rust und C++ in `editor-langs.js`, erst bei Bedarf geladen; gemeinsamer Teil `editor-shared.js`. Einstiege `entry-editor.js` und `entry-editor-langs.js`, `npm run build:editor` legt alles nach `out/editor/` (vor jede Datei die Kopfzeile mit den Versionen setzen). Versionen fest, `@lezer/common` und `@lezer/lr` über `overrides` auf mindestens zwei Wochen alte Stände.
- `vendor/pdfjs/`: pdf.js (`pdfjs-dist` 6.4.299, Legacy-Bau, läuft auch in Safari 15): `pdf.min.mjs`, `pdf.worker.min.mjs`, Lizenz. `npm run build:pdfjs` kopiert sie nach `out/pdfjs/`. Der Service Worker legt sie in einen eigenen Cache (`toollib-pdfjs-<Version>`, `PDFJS` in `sw.js` gleich halten).

Nur nötig, wenn die Bibliotheken aktualisiert werden sollen. Die Versionen sind fest eingetragen.

```bash
cd tools/build-vendor
npm install
npm run build
```

Danach den Kopf aus zwei Kommentarzeilen (Versionen) vor `out/git.js`, `out/search.js`, `out/reader.js` und `out/katex/katex.js` setzen, die ersten drei nach `vendor/` kopieren, den Inhalt von `out/katex/` nach `vendor/katex/`, von `out/pdfjs/` nach `vendor/pdfjs/` und von `out/editor/` nach `vendor/editor/`, und `VERSION` in `sw.js` erhöhen (neue Schriften auch in `FILES`).

`node_modules/`, `out/` und `package-lock.json` gehören nicht ins Repository (stehen in `.gitignore` dieses Ordners).
