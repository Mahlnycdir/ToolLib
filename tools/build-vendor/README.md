# build-vendor

Baut `vendor/git.js`: isomorphic-git (Git im Browser), LightningFS (Dateien in IndexedDB), diff3 (Zusammenführen von Text) und ein Buffer-Ersatz, gebündelt als ein ES-Modul. Die Dienste `app/services/storage.js` und `app/services/sync.js` laden nur diese Datei.

Nur nötig, wenn die Bibliotheken aktualisiert werden sollen. Die Versionen sind fest eingetragen.

```bash
cd tools/build-vendor
npm install
npm run build
```

Danach den Kopf aus zwei Kommentarzeilen (Versionen) vor `out/git.js` setzen, die Datei nach `vendor/git.js` kopieren und `VERSION` in `sw.js` erhöhen.

`node_modules/` und `out/` gehören nicht ins Repository (stehen in `.gitignore`).
