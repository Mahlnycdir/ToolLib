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
9. Start und Widgets (0.28.0): `app/services/start-store.js` liest und schreibt `start.md`; `widget-store.js` prüft die Bausteine (wie ein pydantic-Modell) und schreibt sie; `md-parts.js` die Abschnitte `## …`. In `app/shell/`: `widget-frame.js` ist der Rahmen aller Widgets (Menü, Breite, Ziehen), `widget-blocks.js` die Bausteine (eine Funktion pro Art, über ein dict gewählt), `steps-ui.js` die Schritte mit Ampel, `pult.js` das Kontrollpult, `start.js` der Start.
10. Die Library (0.29.0): `app/services/shelf.js` stellt die vier Regale aus den Knoten zusammen (Listen von dicts, nichts wird gespeichert außer wie weit du gelesen hast, `noteProgress`); `app/shell/shelf-view.js` zeichnet Regale, Buchkarten und eine offene Dokumentation (`pageTree` aus `crawl-view.js`). Der Reiter „Projekt“ beim Schreiben steht in `library-view.js` (`drawProject`) und nimmt die Widgets aus `project-board.js` (`projectWidgetView`).
11. Pfade (0.30.0): `app/services/paths.js` liest einen Pfad (Schritte im Kopf, Text, Anfang und Check unter `## Step <id>`), merkt den Fortschritt, beginnt ein Projekt daraus (`startProject`, die Datei nennt `from_path`) und findet Vorschläge (`suggest`, `suggestForProject`, `smallSteps`); `app/shell/path-view.js` zeichnet den Pfad im Knoten und führt den Check aus (`runPython` mit deiner Datei aus Kobra und dem Check); `app/shell/problem-ui.js` zeichnet die Vorschläge auf Start, im Projekt und in der Recherche. Kobra nimmt die Aufgabe in `openTask` (kobra/js/app.js) an. Seit 0.30.1 liest `parsePath` auch `level` (eine aus `LEVELS`) und `after` (Pfad-Slugs, nur `[a-z0-9-]`), `path-view.js` zeigt beides.

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

## 0.31.0 Stabil

- Sync und Ansichten: `sync.js` meldet in `state.last.incoming`, welche Dateien von anderswo kamen (`null` = alles). `shell.js` baut den Index nur nach einem Sync neu, der etwas gebracht hat, und zeichnet danach nur die Ansicht neu, deren Datei dabei war (`brought`, `busyInMain`).
- `app/shell/tap-place.js`: `offsetAtPoint(shown, source, x, y)` findet zu einem Tipp auf gezeichnetem Markdown die Stelle im Text (wie `str.find` mit den Wörtern um den Finger, bei mehreren Treffern der nächstgelegene).
- `app/shell/grips.js`: `grip({ start, move, done, reset })`, eine ziehbare Linie zwischen zwei Spalten (Library, Schreiben/Vorschau).
- `md-editor.js` `listKeys`: `emptyItemOut` (leerer Punkt eine Stufe aus) und `nextLetter` (a) → b)) vor `insertNewlineContinueMarkup`.
- `reader.js` `parseBody`: `~~~` in einer Formel ist kein Code-Block; doppelte Abschnitte werden zusammengefasst (Highlights: der letzte).

## 0.32.0 Loom: Rahmen und Heute

- `app/shell/styles.css`: oben die zwei Sätze der Variablen (Morgennebel in `:root`, Waldnacht in `[data-theme="dark"]`), neu `--light` (das warme Licht), `--glass`, `--line`, `--ground`, `--bench`, `--on-accent`; ganz unten der Abschnitt „Loom (0.32.0)“, der nur umfärbt: Klassennamen bleiben. Bewegung hält an mit `html.calm` oder `prefers-reduced-motion`.
- `app/shell/loom.js` (neu): `loomMark` (das Zeichen), `benchItems`/`benchStrip` (Werkbank aus `trail.js`), `openTabs` (Tabs der Projekte), `loomSay`/`loomVoice` (was Loom auf Heute sagt; heute nur aus deinen Projekten, eine spätere Quelle wie ein Modell kommt in `loomSay` dazu).
- `shell.js`: `renderTabs` (Tabs in der Leiste oben), `renderTabbar` (Leiste unten am iPhone), `renderStatus` mit der Werkbank vorn.
- `start.js`: Kopf mit Datum, Gruß und „Anordnen“ (Klasse `arranging` am Board), `focusCard`, `start-aside` mit Loom und (am iPhone) der Werkbank.
- `services/theme.js`: Waldnacht ist Voreinstellung (`appearance` fällt auf `dark`), `calm()`/`setMotion()` für „Licht atmet“ (`look.motion`); `boot-theme.js` setzt beides vor dem ersten Bild.
- `settings/loom.js` (neu): Seite Loom mit `loom.suggest`, `loom.attach`, `loom.model` (`none`). Ein Modell später: ein Wert mehr in `LOOM_MODELS` und eine Quelle in `loomSay`.
- `modules.js`: Akzente als `var(--c-*)`, neuer Akzent `amber` (das warme Licht) für den Rahmen. `colors.js`: PALETTE mit denselben Werten wie die Variablen.


## 0.33.0 Loom spricht · Projekt

- `app/shell/widget-frame.js`: der Rahmen kann jetzt anordnen (`arranging`, `onArrange`, `tray`): × mit Rückgängig (`remove` gibt eine Funktion zurück), Größe an der Ecke (`resizable`, rastet auf 1×1/2×1/1×2/2×2), Ziehen am ganzen Widget (`draggable` in `drag.js` hat dafür `when` und `hold`), langes Drücken (`longPress`). Spalten setzt ein ResizeObserver als `--cols`. Größen kommen als `sizes` (`sizesOf` liest auch das alte `wide`).
- `app/services/start-store.js`: `START_WIDGETS` mit focus, loom, problem, step, themes, bench; `size:` statt `wide:`; `migrated()` legt die neuen Widgets einmal vorn dazu (Merker `loom: 1`); `startSnapshot`/`restoreStartWidget` für „Rückgängig“. `projects.js` dasselbe für Projekte (`setProjectSizes`, `projectSnapshot`, `restoreProjectWidget`).
- `app/services/loom-mind.js`: versteht, was du sagst (`understand`: reguläre Ausdrücke je Absicht), findet Antworten in deinen Knoten (`answerFrom`: Suche, dann der beste Satz je Knoten, `near` vergleicht Wörter über Deutsch und Englisch) und Vorschläge mit Grund (`suggestions`). Kein Sprachmodell; ein Modell käme als weitere Quelle dazu (`loomModel` in settings/loom.js).
- `app/shell/loom-talk.js`: das Gespräch (`talkPanel`, `openTalk`, `toggleTalk`), `respond` handelt je Absicht, die Spracherkennung des Browsers (`webkitSpeechRecognition`) oder das Diktat. Verlauf in `loom.talk` (Gerät).
- `app/services/dive.js`: der Weg ins Rabbit Hole je Projekt (pref `dive`: trail, from, finds, since); `app/shell/project-focus.js` zeichnet die Ansicht Fokus.
- `app/shell/projects-view.js`: die Projektseite mit `projectStructure` (links) und `projectSide` (rechts); `project-board.js` die vier Ansichten (`PROJECT_VIEWS`, Vorgabe Fokus), das Board mit Untergruppen (`sectionEl` rekursiv).
- Abschnitte mit Elternteil: `"id|Titel|Farbe|parent"` (`parseSections`, `sectionTree`, `setSectionParent`; `moveSectionTo` nimmt Untergruppen mit). `project-canvas.js`: die Rahmen der Leinwand sind die Abschnitte (`rects()` rechnet sie aus den Karten und den gesetzten Rahmen `state.frames`); in der .canvas-Datei tragen von Loom gezeichnete Rahmen `"auto": true`.
- Nebeneinander: `shell.js` `openSide` lädt die App als `index.html?side=1#…` in einem iframe (`app.side-frame`: ohne Leisten, ohne Sync).
- `app/shell/photo.js`: ein Knopf für Fotos beim Anlegen (`saveImage` aus assets.js).

## 0.33.7 Bugs aus der Liste vom 19.11.

- Fokus mit Prioritäten: `app/services/projects.js` hält die Liste (`focusList`, `focusRank`, `addToFocus`, `removeFromFocus`, `moveFocus`, `setFocusOrder`; Kopie in pref `focus.order`). Sie steht in start.md als `focus: [Pfade]` (start-store.js `setFocusField`); Lesen schreibt nie (ein neues Gerät kann sonst nicht klonen), ohne `focus:` entsteht sie einmal aus dem alten Fokus und `pult:`. `focusPath()` ist das Projekt, an dem du auf diesem Gerät arbeitest (pref `focus`, immer eines der Liste, sonst Priorität 1); `setFocus(p)` hängt p hinten an, ohne die anderen zu verschieben.
- `app/shell/focus-ui.js`: das Blatt „Fokus & Prioritäten“ (`openFocusSheet`) und die Zeilen auf Heute (`focusRows`). Die Tabs oben (`loom.js` `openTabs`) sind genau die Liste, ein Projekt außerhalb bekommt einen vorübergehenden Tab (`visit`). Das Kontrollpult (`pult.js`) zeigt die Liste, beliebig lang.
- Projektübersicht als Kacheln (`projects-view.js` `projectTile`, `progressRing`).
- Leinwand: `adoptOldGroups` läuft je Projekt nur einmal zugleich (`adopting`), nimmt gleichnamige Abschnitte, macht innere Gruppen zu Untergruppen und speichert sofort. `repairCanvasSections` räumt einmal je Projekt und Gerät auf (leere Doppelte weg, Rahmen in Rahmen = Untergruppe; pref `canvas.repaired`); die Projektseite ruft es auch. Board und Leinwand bekommen die Breite (`.lp-wide`).
- Notiz: `.md-editor .cm-scroller` ohne `overscroll-behavior: contain` (das Mausrad über dem Text scrollt die Seite).
- Kladde: zweiter Tipp aufs aktive Werkzeug legt es ab (`tool = null`, `.kl-hand`), dann zieht die Maus die Seite; Rad/Trackpad verschiebt, Strg + Rad zoomt; Stärke per langem Drücken oder Rechtsklick. iPhone: die Leiste unten und der Loom-Knopf raus aus dem Raster.
- iPhone: kein Leerraum unter Kladde und Kobra und keiner über der Tastatur (`padding-bottom` 0).
- Sprache: `speech.js` `speechEngine` (pref `loom.speechEngine`: auto, mac, here), `activeEngine`, `warmUp` (Mac: `POST /speech/warm` lädt das Modell, sobald du zu sprechen beginnst), `forgetHere`; Vorschau beim Sprechen mit `quick=1` (ein Durchgang). Einstellungen › Loom zeigen beide Modelle mit Namen und Zustand und wer gerade abschreibt.

## 0.33.8 Bugs aus ENTEs Bildern (24.11.)

- iPhone: Der Platz für Looms runden Knopf ist kein `padding-bottom` mehr unter jeder Seite, sondern ein Abstandhalter `.main::after` nur nach fließenden Seiten; Werkzeuge mit voller Höhe (Recherche und Leser, Netz, Kobra, Kladde, offene Bibliotheksseite, Quelltext) enden direkt an der Leiste. `.main` am iPhone `overflow-x: hidden`; die Ansichtsumschaltung im Projekt scrollt in sich.
- Tastatur (`shell.js` `fitViewport`): Neuere iOS verkleinern `innerHeight` mit der Tastatur; gemessen wird jetzt gegen die größte Höhe ohne Textfeld im Fokus (`tallest`), und „Tastatur offen“ gilt nur mit einem Textfeld im Fokus (`typing`), neu geprüft bei focusin/focusout.
- Board: `.board-cards` mit `minmax(0, 1fr)` (Karten wuchsen über ihre Spalte); Spalten mit Unter-Untergruppen `deep` (doppelte Breite ab 900 px); die Leiste über dem Board als Band; die Linien (`boardThreads`) nur zu Karten, deren Mitte sichtbar ist, und per `clip-path` am sichtbaren Board abgeschnitten.
- Formeln (`math.js` `draw`): erst wie sie sind, dann ohne `\tag`, `\label`, `\nonumber` (und `\1` → `\mathbb{1}`, `\bf` → `\boldsymbol`), sonst ruhig als Quelltext (`.tex-error` gedämpft statt rot). Breite Formeln (`.katex-display`) scrollen in sich. Loom setzt Formeln in Zitaten (`inline` aus markdown.js).
