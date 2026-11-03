# import-snippets

Einmaliger Import von Kobras Bausteinen (`js/snippets.js`) als Snippet-Knoten für den Python-Spickzettel. Jeder Baustein wird eine Datei in `knowledge/nodes/snippets/`, englisch mit deutschem Sprachblock.

## Aufruf

Braucht nur Node.js (ab Version 18), keine Pakete.

```sh
node tools/import-snippets/import-snippets.mjs <pfad/zu/kobra/js/snippets.js> <pfad/zu/knowledge/nodes/snippets>
```

- Vorhandene Dateien bleiben unangetastet. Wer Knoten im Wissen bearbeitet hat, verliert also nichts.
- Mit `--force` werden alle Dateien neu geschrieben.
- Fehlen für einen neuen Baustein die Texte, meldet das Skript seinen Schlüssel.

## texts.json

- `groups`: Kobras Gruppennamen und ihr englischer Kurzname (`control-flow`, `science`, …).
- `translate`: deutsche Wörter in Kobras Code und ihr englischer Ersatz, z. B. `liste` → `items`. Ersetzt werden nur ganze Wörter.
- `snippets`: pro Baustein Dateiname (`slug`), Titel in beiden Sprachen, Erklärung (`en`, `de`), zusätzliche Aliase und optional Stolperfallen. `rename` gilt nur für diesen einen Baustein.

Kobras eigene Beschriftung (`label`) und Kurzbeschreibung (`detail`) landen automatisch in `aliases`, die Schlüsselwörter aus `KEYWORD_SNIPPETS` in `tags`.

Nach dem Import sind die Knoten die Quelle: Änderungen gehören in `knowledge`, nicht in dieses Skript.
