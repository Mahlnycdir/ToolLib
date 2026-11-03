# build-vendor

Baut die Bibliotheken als ES-Module:

- `vendor/git.js`: isomorphic-git (Git im Browser), LightningFS (Dateien in IndexedDB), diff3 (Zusammenführen von Text) und ein Buffer-Ersatz. Genutzt von `app/services/storage.js` und `app/services/sync.js`.
- `vendor/search.js`: MiniSearch (Suchindex) und js-yaml (Kopfdaten lesen). Genutzt von `app/services/nodes.js` und `app/services/search.js`.

Nur nötig, wenn die Bibliotheken aktualisiert werden sollen. Die Versionen sind fest eingetragen.

```bash
cd tools/build-vendor
npm install
npm run build
```

Danach den Kopf aus zwei Kommentarzeilen (Versionen) vor `out/git.js` und `out/search.js` setzen, beide nach `vendor/` kopieren und `VERSION` in `sw.js` erhöhen.

`node_modules/` und `out/` gehören nicht ins Repository (stehen in `.gitignore`).
