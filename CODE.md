# Toollib lesen, wenn man Python kann

Diese Anleitung ist für jemanden, der Python gut kennt und JavaScript kaum. Sie zeigt, wo was liegt, wie ein Klick durch den Code läuft und welche JavaScript-Wörter man zum Lesen braucht. Stand: 0.26.0.

## Das Wichtigste in einem Satz

Toollib ist eine Webseite, die im Browser läuft (Mac, iPhone, Linux). Dein Wissen sind Markdown-Dateien in einem privaten Git-Repository; die App holt sie auf das Gerät, baut einen Suchindex und ein Netz der Verknüpfungen und zeigt alles in Ansichten.

## Wo was liegt

| Ordner | Was drin ist | Vergleich mit Python |
| --- | --- | --- |
| `app/services/` | Logik ohne Oberfläche: Dateien, Sync, Suche, Knoten, Verknüpfungen, Projekte, Recherche, Python | ein Paket mit Modulen ohne GUI |
| `app/shell/` | alles Sichtbare: Rahmen, Start, Knoten, Projekte, Schreiben, Recherche, Kladde | die GUI-Schicht |
| `app/shell/settings/` | die Einstellungen, eine Datei pro Seite; `index.js` ist die Kontrollzentrale | ein Unterpaket |
| `app/i18n/strings.json` | jeder sichtbare Satz auf Englisch und Deutsch | eine Übersetzungstabelle |
| `kobra/` | Kobra, die IDE, als eigenes Programm in Toollib | ein eingebettetes Unterprogramm |
| `mac-helper/` | der Mac-Helfer, ein echtes Python-Programm | hier ist es Python |
| `vendor/` | fremde Bibliotheken (CodeMirror, KaTeX, Pyodide …) | wie `site-packages`, nicht anfassen |
| `sw.js` | Service Worker: hält die App offline bereit | ein Cache vor dem Webserver |

## Die Dateien, die man zuerst kennen sollte

1. `app/main.js`: der Start, wie `if __name__ == "__main__":`.
2. `app/shell/shell.js`: der Rahmen. Er liest die Adresse (`#/home`, `#/m/projects`, `#/n/<pfad>`, `#/settings/<seite>`) und ruft die passende Ansicht auf (`VIEWS`, `render()`).
3. `app/services/nodes.js`: liest einen Knoten (YAML-Kopf + Markdown) und macht daraus ein Wörterbuch (`summary`). Ändert einzelne Kopfzeilen (`setField`), damit Git nur eine Zeile Unterschied zeigt.
4. `app/services/search.js`: der Suchindex über alle Knoten; meldet jede Änderung (`onNodesChange`).
5. `app/services/relations.js`: das Netz der Verknüpfungen (seit 0.25.0). Hier steht, wie Knoten zusammenhängen.
6. `app/services/sync.js`: Abgleich mit GitHub (isomorphic-git im Browser).
7. Das Netz (0.26.0): `app/services/graph-layout.js` rechnet, wo die Punkte stehen (Kräfte wie bei networkx.spring_layout, in 3D, mit Ebenen); `app/shell/net-canvas.js` zeichnet und dreht; `app/shell/net-view.js` baut die Ansicht und rechnet die Spannung einer Linie aus (`tension`).
8. Die Leinwand eines Projekts (0.27.0): `app/services/canvas-store.js` liest und schreibt die Plätze als JSON (wie `json.load`/`json.dump`); `app/shell/project-canvas.js` zeichnet Karten, Gruppen und Fäden (ein SVG darüber) und rechnet zwischen Bildschirm und Fläche um (`toWorld`); `setThread` in `projects.js` speichert den roten Faden.

## Wie eine Verknüpfung durch den Code läuft

Du drückst an einem Knoten **Alt+L**, tippst „FuncAnimation“ und Enter:

1. `shell.js` → Taste `node.link` → `linkFrom(d)` in `app/shell/link-ui.js`.
2. `pickNode()` öffnet die Suche (`searchNodes` aus `search.js`) und gibt den gewählten Knoten zurück.
3. `connect(von, nach)` in `relations.js` liest die Datei, ändert genau eine Zeile (`links: [...]`) und schreibt sie.
4. `refreshNode()` in `search.js` erneuert den Eintrag im Index und ruft alle `onNodesChange`-Zuhörer.
5. `relations.js` verwirft sein zwischengespeichertes Netz und ruft seine Zuhörer (`onRelationsChange`).
6. Die Liste „Verknüpfungen“ neben jedem offenen Knoten zeichnet sich neu, auch in einem zweiten Fenster (`channel.js`) und nach einem Sync, der Änderungen vom iPhone bringt.
7. `noteChange()` merkt die Datei für den nächsten Sync vor; GitHub bekommt sie beim nächsten Abgleich.

Dasselbe Muster gilt überall: **Datei ändern → Index erneuern → Zuhörer zeichnen neu.**

## JavaScript-Wörter für Python-Leser

| JavaScript | Python |
| --- | --- |
| `const x = 1` / `let x = 1` | `x = 1` (const: wird nicht neu zugewiesen) |
| `function f(a, b = 2) { … }` | `def f(a, b=2): …` |
| `(x) => x * 2` | `lambda x: x * 2` |
| `async function f()` / `await g()` | `async def f()` / `await g()` |
| `export function f()` | eine öffentliche Funktion im Modul |
| `import { a, b } from './x.js'` | `from x import a, b` |
| `{ key: 'value' }` | `{'key': 'value'}` (ein Objekt ist wie ein dict) |
| `[1, 2, 3]` | `[1, 2, 3]` |
| `new Map()` / `new Set()` | `dict()` / `set()` |
| `for (const x of liste)` | `for x in liste:` |
| `liste.map((x) => …)` / `.filter(…)` | `[… for x in liste]` / `[x for x in liste if …]` |
| `a?.b` | `a.b if a is not None else None` |
| `a ?? b` | `a if a is not None else b` |
| `` `Text ${wert}` `` | `f"Text {wert}"` |
| `...liste` | `*liste` |
| `x === y` | `x == y` (immer drei Gleichheitszeichen) |
| `try { … } catch (e) { … }` | `try: … except Exception as e: …` |

Zwei Dinge, die es in Python so nicht gibt:

- `h('div', { class: 'x' }, kind1, kind2)` baut ein HTML-Element (definiert in `app/services/ui.js`). Die ganze Oberfläche entsteht so, ohne Vorlagen.
- `t('rel.title')` holt einen Text aus `strings.json` in der eingestellten Sprache.

## Selbst nachsehen, ob alles läuft

- **In der App:** Einstellungen → Kontrollzentrale zeigt, ob Wissen, Mac-Helfer, Recherche, Kobra und Python verbunden sind.
- **In der Entwicklerkonsole** des Browsers (Safari: Entwickler › Webinformationen; Chrome: ⌥⌘I) kann man Module direkt fragen, wie in einer Python-Shell:

```js
const R = await import('/app/services/relations.js');
R.relationsOf('spectral-flow-2d')          // was zeigt wohin
R.neighbourhood('spectral-flow-2d', { depth: 2 }).nodes.size
R.dump().missing                            // Verweise auf Knoten, die es (noch) nicht gibt
// im Netz (#/m/net): was gerade gezeichnet ist
__netIds().length; __netEdges().slice(0, 5); __netCamera()
```

## Ein neues Werkzeug einbauen

1. Eine Zeile in `MODULES` (`app/shell/modules.js`) mit Symbol, Farbe und den Knotentypen, die es zeigt.
2. Die Texte `module.<id>.name` und `module.<id>.desc` in `strings.json`.
3. Eine Ansicht in `VIEWS` (`app/shell/shell.js`); `main.cleanup` räumt auf, wenn die Ansicht geht.
4. Wenn es etwas anlegt: ein Eintrag in `CREATORS` (`app/shell/create.js`).
5. Seine Dateien in `FILES` von `sw.js`, `VERSION` erhöhen.

Farben kommen aus `app/shell/colors.js` (dieselben neun Farben für Werkzeuge, Knotentypen, Bereiche und Board-Abschnitte, hell und dunkel). Verknüpfungen kommen aus `relations.js`.

## Eine neue Einstellungsseite

Eine Zeile in `PAGES` (`app/shell/settings/index.js`), die Texte `settings.sec.<id>` und `settings.sec.<id>.hint`, und eine Funktion, die die Karte baut (Beispiel: `helperCard` in `settings/research.js`). Eine Einstellung, die zwischen Geräten wandern soll, kommt zusätzlich in `KEYS` von `app/services/settings-file.js`.

## Regeln, die man nicht brechen sollte

- Knoten nur zeilengenau ändern (`setField`, `removeField`), nie die ganze Datei neu schreiben.
- Inhalte aus dem Wissen nie über `innerHTML` einsetzen (Sicherheit).
- Schlüssel in `localStorage` nie umbenennen.
- Jeder sichtbare Satz steht in `strings.json`, auf Englisch und Deutsch.
- Neue Datei → in `FILES` von `sw.js`, `VERSION` erhöhen.
