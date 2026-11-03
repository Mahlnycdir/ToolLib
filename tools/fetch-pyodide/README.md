# fetch-pyodide

Holt Python für Toollib nach `vendor/pyodide/`: Pyodide (Python im Browser) mit numpy, scipy, matplotlib und sympy samt ihren Abhängigkeiten. Toollib lädt Python nur von der eigenen Adresse, kein fremder Server ist beteiligt.

Nur nötig, wenn Pyodide aktualisiert werden soll. Die Dateien liegen fertig im Repository.

```bash
node tools/fetch-pyodide/fetch-pyodide.mjs 314.0.7
```

- Lader, Python-Kern und `pyodide-lock.json` kommen aus dem npm-Paket `pyodide`; geprüft gegen die sha512-Prüfsumme, die die npm-Registry nennt.
- Die Pakete kommen von Pyodides CDN (jsdelivr) und werden gegen die sha256-Prüfsummen in `pyodide-lock.json` geprüft. Mit `--from <Ordner>` nimmt das Skript sie stattdessen aus dem ausgepackten Release (`pyodide-<version>.tar.bz2` von github.com/pyodide/pyodide/releases).
- Am Ende schreibt es `vendor/pyodide/toollib-bundle.json`: Versionen, Paketliste und jede Datei mit Größe und sha256. Die App liest daraus, welche Pakete es gibt; die Einstellungen zeigen daraus die Größe.

Nach einem Wechsel der Version: `PYODIDE` in `sw.js` auf die neue Version setzen und `VERSION` erhöhen. Die neue Version kommt dann in einen neuen Cache, der alte wird beim nächsten Update gelöscht.

Nur Versionen nehmen, die mindestens zwei Wochen alt sind.

Lizenzen: Pyodide steht unter der Mozilla Public License 2.0, der Quelltext liegt auf github.com/pyodide/pyodide. Jedes Paket (Wheel) trägt seine eigene Lizenz in sich (numpy, scipy, sympy: BSD; matplotlib: eigene, BSD-artig; Pillow: MIT-CMU). Die Dateien werden unverändert ausgeliefert; `toollib-bundle.json` nennt die Herkunft.

## vendor/py-bundle.json

Kobras Python-Bibliothek (Laufzeit, matplotlib-Backend für Bilder und Animationen, Nachbauten von tkinter und Qt) als eine Datei. Unverändert aus Kobra übernommen (`py-bundle.json`, gebaut mit `tools/build_bundle.py` dort). Wenn Kobra sie ändert, die Datei neu kopieren und `VERSION` in `sw.js` erhöhen.
