# build-vendor

Baut die Bibliotheken als ES-Module:

- `vendor/git.js`: isomorphic-git (Git im Browser), LightningFS (Dateien in IndexedDB), diff3 (Zusammenführen von Text) und ein Buffer-Ersatz. Genutzt von `app/services/storage.js` und `app/services/sync.js`.
- `vendor/search.js`: MiniSearch (Suchindex) und js-yaml (Kopfdaten lesen). Genutzt von `app/services/nodes.js` und `app/services/search.js`.
- `vendor/katex/`: KaTeX 0.19.1 (Formeln setzen) als ES-Modul `katex.js`, dazu `katex.min.css`, die woff2-Schriften und die Lizenz. Genutzt von `app/shell/math.js` (seit 0.12.0).

Nur nötig, wenn die Bibliotheken aktualisiert werden sollen. Die Versionen sind fest eingetragen.

```bash
cd tools/build-vendor
npm install
npm run build
```

Danach den Kopf aus zwei Kommentarzeilen (Versionen) vor `out/git.js`, `out/search.js` und `out/katex/katex.js` setzen, die ersten beiden nach `vendor/` kopieren, den Inhalt von `out/katex/` nach `vendor/katex/`, und `VERSION` in `sw.js` erhöhen (neue Schriften auch in `FILES`).

`node_modules/`, `out/` und `package-lock.json` gehören nicht ins Repository (stehen in `.gitignore` dieses Ordners).
