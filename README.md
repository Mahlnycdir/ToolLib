# Toollib

Persönliche Arbeitsoberfläche für Mac, iPhone und Linux: eine Web-App (PWA) auf GitHub Pages, dazu später ein Hub zu Hause. Das Wissen liegt getrennt im privaten Repository `knowledge`.

Stand: Version 0.29.0 (Library zum Stöbern: vier Regale Weiterlesen, Deine Texte, Dokumentationen, Papers & Funde, Dokumentationen holen, Reiter „Projekt“ beim Schreiben, siehe unten; 0.28.1 Schritte per Ziehen umordnen; 0.28.0 Start als eigenes Board mit Kontrollpult für bis zu vier Projekte, Ampel an Schritten, Widget-Bausteine; 0.27.2 Kobra: Zusatztasten wischen, lange Namen und Pfade; 0.27.1 roter Faden entlang der Herleitungen vorschlagen, „Führt zu“ neben der Karte; 0.27.0 Fäden und Leinwand: jedes Projekt auch als freie Leinwand, Fäden zwischen Karten sind Verknüpfungen im Wissen, ein roter Faden in deiner Reihenfolge, siehe unten; 0.26.1 Blätter am iPhone scrollen; 0.26.0 das Netz in 3D mit Ebenen und Spannung, siehe unten; 0.25.0 Fundament des Ökosystems: Verknüpfungen an einem Ort und an jedem Knoten, Einstellungen als Seiten mit Kontrollzentrale, hell/dunkel mit einem Tipp, siehe unten; 0.24.0 Kobra fertig; 0.23.0 ein Python für die ganze App; davor 0.22.0 Kobra als Ansicht in Toollib, jede Ansicht bleibt an ihrer Stelle; 0.21.0 Kladde in Toollib: Handschrift mit dem Daumen, Notizen im Wissen, als LaTeX lesbar auf dem Mac; davor 0.20.0 Kobra mit mehreren GitHub-Konten, jedes Projekt committet als sein Konto, deine Repositorys auf jedem Gerät; davor 0.19.0 Suche unter anderen Namen und 58 Snippets, 0.18.0 Projekte als Board; 0.17.0 Schreiben, Tasten, Einstellungen: ein neuer Editor mit Farben, LaTeX-Vervollständigung mit Vorschau, Kurzschrift wie `//` → Bruch, eigene Befehle und Makros, Listen, die sich fortsetzen, Formel-Palette, Bilder, Plots und Quellen `[@fund]`; einstellbare Tastenkürzel, die an jedem Knopf stehen; Einstellungen in Bereichen mit Suche, alle Schlüssel und Adressen unter „Zugänge“; Kapitel, Seiten und Abschnitte per Ziehen ordnen, auch mit dem Finger; davor 0.16.0: Recherche, Projekt und Schreiben als eins: die Recherche mit einer Leiste oben (Lernen oder Paper, Suche, „Merken in“ dem Projekt im Fokus, Treffer, Gemerkt, Eingang), links die Treffer und rechts die Vorschau mit Lesen und Merken; Mappen und Bibliotheken gehen im Projekt auf, seine Seiten schreibst du neben seinen Werken; jeden Knoten löschen, mit „Rückgängig“; davor 0.15.1: die Werkzeuge von innen: Snippets in jeder Sprache, jeden Knoten bearbeiten (auch Karten), Befehlszeile als Sprungbrett mit Alt+1…7, Bibliothek als eigenes Werkzeug mit „/“-Menü, Gliederung und Ziehen, Recherche mit „Lernen“ (Überblick, Einführungen, Bücher, Kurse, Code) und Tastatur; davor 0.15.0: der Rahmen um eine Arbeitsweise: Start mit einer Frage, Projekte mit Fokus, Notizen und Eingang, „+“ legt alles von überall an, jeder Knoten zeigt seinen Zusammenhang; dazu Fehlerbehebungen im Leser und in der Recherche; davor 0.14.4.2: Mac-Helfer, Teil 2: Websites „auf dem Mac“ im Hintergrund durchgehen, Befehle von jedem Gerät, Suche im Netz über SearXNG; seit 0.14.4.1 Einstellungen als verschlüsselte Datei sichern und laden; seit 0.14.4 Mac-Helfer, Teil 1: ein kleines Python-Programm auf dem Mac holt über deine Adresse zu Hause, zeigt Seiten mit JavaScript in Chromium und hat einen PDF-Ordner mit Ablage und Eingang; seit 0.14.3 Websites durchgehen: eine Website unter einer Startadresse mit Grenzen, robots.txt und Sitemap, jede Seite und jedes verlinkte PDF als Fund mit Text in einer eigenen Mappe, anhalten und fortsetzen; seit 0.14.2 eigene Bibliotheken mit Kapiteln und Seiten schreiben, mit Stellen aus deinen Funden; seit 0.14.1.2 aus dem Leser schnell Karten und Snippets anlegen, „Dein Wissen“ neben dem Text, Zitate wie [12] antippen; Zurück findet die Stelle auch nach einem Neustart der App; seit 0.14.1.1 läuft Sync von selbst), das Fenster Recherche hat einen Leser (Seiten, PDFs und arXiv-Quelltext lesen, markieren, Notizen) und sucht Paper mit freien Fassungen; Stufe 3 (Formelsammlung) läuft, Welle 2 (mathematische Methoden) ist drin; Stufe 2 (Python-Spickzettel als volles Modul) ist fertig. Der Rahmen läuft als installierbare App und startet offline. Ein Tipp auf Sync holt das Wissen aufs Gerät; die Befehlszeile durchsucht es, Knoten lassen sich lesen und Snippets kopieren, auch ohne Netz. Seit 0.6.0 lässt sich ein Knoten in der App als geprüft markieren; Sync lädt die Änderung hoch. Seit 0.7.0 sucht die Befehlszeile auch nach Problemen in deinen eigenen Worten, und der Spickzettel hat Rezepte. Seit 0.8.0 laufen Snippets direkt in der App: Python mit numpy, scipy, matplotlib und sympy läuft im Browser, von Toollibs eigener Adresse. Seit 0.9.0 legst du eigene Snippets an und änderst Code und Check bestehender Knoten. Seit 0.10.0 gibt es die Gruppen Datenstrukturen, Fehlersuche, Threads & Prozesse und Git. Seit 0.11.0 ist Kobra Teil von Toollib, mit den Bausteinen aus dem Spickzettel. Seit 0.12.0 sind Formeln gesetzt (KaTeX) und es gibt die Formelsammlung: verknüpfte Karten nach Bereich und Thema. Seit 0.13.0 legst du offene Konventionen selbst fest. Seit 0.14.0 sucht das Fenster Recherche Paper und Bücher in sieben offenen Quellen und merkt sie in Recherche-Mappen.

## Aufbau

```text
toollib/                 dieses Repository, öffentlich
  index.html             lädt den Rahmen
  manifest.webmanifest   Name, Farben und Icons der App
  sw.js                  Service Worker: Offline-Cache und Updates (VERSION erhöhen)
  icons/                 App-Icons
  vendor/git.js          isomorphic-git, LightningFS und diff3 als ein Modul (gebaut mit tools/build-vendor)
  vendor/search.js       MiniSearch und js-yaml als ein Modul
  vendor/pyodide/        Python im Browser (Pyodide) mit numpy, scipy, matplotlib, sympy (geholt mit tools/fetch-pyodide)
  vendor/py-bundle.json  Kobras Python-Bibliothek: Laufzeit, matplotlib-Backend, Nachbauten von tkinter und Qt
  vendor/katex/          KaTeX 0.19.1 als ES-Modul, Stylesheet und woff2-Schriften (gebaut mit tools/build-vendor)
  vendor/reader.js       Readability, Turndown (mit GFM), fflate als ein Modul für den Leser (gebaut mit tools/build-vendor)
  vendor/pdfjs/          pdf.js 6.4.299 (Legacy-Bau für Safari 15), liest PDFs im Leser; eigener Cache im Service Worker
  app/
    main.js              Start: Texte laden, Rahmen bauen, Service Worker anmelden
    i18n/                strings.json (jeder Satz auf Englisch und Deutsch), i18n.js mit t()
    services/            ui.js und icons.js aus Kobra, prefs.js, pwa.js,
                         storage.js (Dateien auf dem Gerät), sync.js (Abgleich mit GitHub),
                         nodes.js (Knoten lesen: Kopfdaten, Sprachblöcke, Quellen; ein Feld ändern),
                         search.js (Suchindex), python.js und python-host.js (Python ausführen, ein Worker mit Kobra),
                         toollib_snippets.py (baut aus Snippet, benötigten Snippets und Check ein Programm),
                         research.js (Suche über alle Quellen, Holer, Einstellungen), research-sources.js (die Quellen),
                         research-merge.js (Fassungen zusammenführen und ordnen), research-store.js (Funde und Mappen
                         als Knoten), channel.js (Fenster sagen einander, welche Knoten sich geändert haben),
                         settings-file.js (Einstellungen als verschlüsselte Datei, 0.14.4.1),
                         background.js (Toollib ohne Fenster im Mac-Helfer: Aufträge „auf dem Mac“, 0.14.4.2),
                         projects.js (Projekte, Fokus, Neues kommt von selbst ins Projekt, 0.15.0), notes.js (Notizen,
                         Eingang), trail.js (woran du zuletzt warst),
                         reader.js (Leser: Plan, Holen, Gliederung, Text und Markierungen im Fund-Knoten),
                         reader-cards.js (Leser: Karte aus der Auswahl, passendes Wissen, Zitate [12]),
                         library-store.js (eigene Bibliotheken: Kapitel, Seiten, Zitate mit Quelle, Zusammenführen),
                         reader-latex.js (arXiv-Quelltext → Markdown, ohne DOM), reader-html.js (Webseiten),
                         reader-pdf.js (PDF-Text mit pdf.js)
    shell/               shell.js (Befehlszeile, Modulleiste, Statuszeile), views.js, modules.js, styles.css,
                         start.js (Start), projects-view.js (Projekte, Projekt, Notiz), create.js („+“), context.js (Zusammenhang),
                         node-view.js (Knoten-Ansicht, Python-Spickzettel), markdown.js (sicherer Markdown-Leser),
                         run-panel.js (Ausprobieren, Check ausführen), console.js (Ausgabe, input(), Abbildungen),
                         snippet-form.js (eigene Snippets anlegen, bearbeiten, löschen)
                         math.js (Formeln mit KaTeX, Makros aus Paper und Masterarbeit),
                         formulary.js (Formelsammlung: Bereiche, Themen, Folgt aus / Führt zu, Symbole),
                         choice-box.js (offene Konventionen festlegen; Logik in services/choices.js),
                         research-view.js (Fenster Recherche: Mappen, Treffer, Fassungen und Notizen),
                         reader-view.js (der Leser: Gliederung, Text, Markierungen, Dein Wissen), reader-marks.js (Markierungen im Text finden),
                         library-view.js (eigene Bibliothek: Inhalt, Seite, Übernehmen), page-editor.js (Markdown mit Vorschau),
                         card-dialog.js (Kartenfenster für Auswahl und ganze Werke)
  fetch-proxy/           der Holer für die Recherche: Cloudflare Worker (worker.js) und Anleitung (README.md)
  mac-helper/            der Mac-Helfer (0.14.4): helper.py, install.sh, requirements.txt und Anleitung (README.md)
  tools/                 Hilfsprogramme: import-snippets, build-vendor, fetch-pyodide
```

Neue Datei im App-Ordner? Dann auch in die Liste `FILES` in `sw.js` eintragen und `VERSION` erhöhen, sonst fehlt sie offline.

## Start, Projekte, Notizen (0.15.0)

Der Rahmen ist um eine Arbeitsweise gebaut: sammeln, festhalten, anwenden, und zwar in einem Zug.

- **Start** (`#/home`) fragt „Was hast du vor?“ und bietet die Wege an: Suchen, Notiz, Projekt, Recherche, Karte, Snippet, Seite. Darunter das Projekt im Fokus mit seinem nächsten Schritt, „Weiter“ (was du zuletzt gelesen, geschrieben, geöffnet hast) und der Eingang. Zahlen zum Wissen und der Sync stehen in der Fußzeile, der Bauplan der Stufe in den Einstellungen.
- **Projekte** (`projects/<name>.md`, `type: project`): Name, Wozu (`goal`), Zustand (`state`: active, paused, done), `links: [...]` mit allem, was dazugehört, darunter `## Next` mit Schritten als `- [ ] …` und `## Notes`. Die Ansicht zeigt den Weg des Wissens als drei Stationen: Sammeln (Funde, Mappen), Festhalten (Karten, Notizen), Anwenden (Snippets, Rezepte, Seiten). „Schon in deinem Wissen“ schlägt Passendes vor; ein Tipp nimmt es auf.
- **Fokus**: Ein Projekt kann auf diesem Gerät im Fokus sein (Einstellung `focus`, wandert nicht mit). Was du dann anlegst, kommt von selbst ins Projekt: Notiz, Karte, Snippet, Mappe, gemerktes Werk, Bibliothek. Was in einer Mappe oder Bibliothek des Projekts liegt, kommt nicht einzeln dazu; Seiten eines Durchgangs auch nicht (ihre Mappe schon). Die Pille neben der Befehlszeile nennt das Projekt.
- **Notizen** (`notes/<name>.md`, `type: note`): ein Gedanke in einem Schritt. Aus der Befehlszeile mit Strg/⌘+Enter oder `+ Text`, über „+“, im Projekt oder auf Start. Ohne Projekt wartet die Notiz im **Eingang**; von dort geht sie in ein Projekt, wird Karte oder Snippet, startet eine Recherche oder wird gelöscht.
- **„+“** (Taste N) legt alles von überall an. Die Einträge stehen in `CREATORS` (`app/shell/create.js`); Start, das Menü und die Befehle „Neu …“ lesen dieselbe Liste.
- **Zusammenhang**: Jeder Knoten zeigt seine Projekte, wer auf ihn verweist, und „Notiz dazu“ / „Recherchieren“. Auf breiten Schirmen steht das neben dem Knoten, sonst darunter.
- **Ein neues Werkzeug** braucht: eine Zeile in `MODULES` (`app/shell/modules.js`, mit `types` für seine Knotenarten), seine Texte `module.<id>.name` und `.desc` in `strings.json`, seine Ansicht in `VIEWS` (`app/shell/shell.js`) und, wenn es etwas anlegt, einen Eintrag in `CREATORS`. Geplante Werkzeuge (`planned: true`) stehen nur auf Start unter „Geplant“.

## Werkzeuge von innen (0.15.1)

- **Snippets in jeder Sprache**: Das Formular fragt nach der Sprache (Python, Rust, JavaScript, Shell, LaTeX … oder eine eigene) und bietet die Gruppen dieser Sprache an, dazu „Neue Gruppe …“. Im Knoten steht `language: <sprache>`, der Code im Block dieser Sprache. Ausführen geht für Python; alles andere kopierst du. Der Spickzettel zeigt Sprach-Chips, sobald es mehr als eine Sprache gibt.
- **Bearbeiten** (`#/src/<pfad>`): Jeder Knoten außer Funden, Mappen, Bibliotheken, Seiten, Projekten und Notizen öffnet sich so, wie er geschrieben ist, mit Vorschau daneben (iPhone: zwei Reiter). Gespeichert wird nur, wenn der Kopf lesbar ist und `type` und `title` hat; `type` bleibt.
- **Befehlszeile ohne Eingabe**: Start und alle Werkzeuge als Kacheln, deine Projekte mit ihrem nächsten Schritt, zuletzt Geöffnetes. Alt+1 … Alt+7 springt direkt.
- **Bibliothek** (`#/m/library`): eigenes Werkzeug statt im Fenster Recherche. Die Seite hat den Platz; „Übernehmen“ (Markierungen, Wissen, Quellen) öffnet sich daneben, „Nur die Seite“ blendet den Inhalt aus. Ein `/` am Zeilenanfang bietet Überschrift, Formel, Liste, Aufgabe, Zitat, Code, Tabelle, Verweis, Trennlinie. Die Überschriften der offenen Seite stehen im Inhalt und führen hin. Seiten ordnest du durch Ziehen (auf eine Seite: davor; auf ein Kapitel: ans Ende). Doppelklick auf ein Kapitel benennt es um.
- **Recherche „Lernen“** (`app/services/learn.js`): Für ein Thema Überblick (Wikipedia), Einführungen und Übersichtsartikel (OpenAlex, nach „lehrt“ geordnet), Bücher (OpenAlex, Open Library), Kurse (Wikibooks, Wikiversity), Ausprobieren (GitHub) und mit dem Mac-Helfer Tutorials (SearXNG). „Paper“ fragt die sieben Paper-Quellen wie bisher; eine DOI sucht immer Paper. Wikipedia und Wikibooks liest der Leser ohne Holer. Tasten in der Trefferliste: ↑↓ oder j/k, Enter, L lesen, M merken.

## Recherche, Projekt und Schreiben als eins (0.16.0)

- **Recherche:** oben eine Leiste: „Lernen“ oder „Paper“, die Suche, die Listen *Treffer*, *Gemerkt* (was das Projekt im Fokus gesammelt hat) und *Eingang* (Gemerktes ohne Projekt, Websites ohne Projekt, Mappen von früher) und „Merken in“: das Projekt im Fokus oder der Eingang. Darunter links die Treffer, jeder mit zwei Knöpfen (lesen, merken), rechts was du angetippt hast: Lesen, Merken, Öffnen, der Rest hinter „…“ (Zitat, weitere Fassungen, Karte, Begriff, Snippet). Fassungen sind eingeklappt, Filter und Quellen stehen hinter „Filter“ (ein „!“ zeigt Quellen ohne Antwort). Auf dem iPhone nimmt ein Treffer den ganzen Bildschirm, „Treffer“ führt zurück.
- **Keine Mappen mehr:** Merken legt das Werk ins Projekt im Fokus. Eine Website durchgehen ergibt einen Eintrag im Projekt. Alte Mappen übernimmst du mit einem Tipp in ein Projekt (im Eingang oder im Projekt selbst): ihre Werke kommen mit, Frage und Notizen werden eine Notiz.
- **Seiten im Projekt:** „Schreiben“ im Projekt öffnet seine Seiten (Kapitel, „/“, Gliederung, Ziehen wie bisher). Rechts unter „Übernehmen“ stehen die Werke des Projekts, auch noch ungelesene; „Lesen“ führt in den Leser und zurück zur Seite. Das Projekt listet seine Seiten unter „Festhalten“. Die Bibliothek als eigenes Werkzeug ist weg.
- **Löschen:** Jeder Knoten hat im Kopf einen Papierkorb. Die Frage nennt, was sich sonst ändert (Projekte, Websites, Kapitel, Verweise); danach bringt „Rückgängig“ alles zurück.

## Schreiben, Tasten, Einstellungen (0.17.0)

- **Editor** (`app/shell/md-editor.js` auf CodeMirror 6 in `vendor/editor/`): Markdown in Farbe, Formeln abgesetzt (Befehle, Klammern, `^` und `_` farbig; was KaTeX nicht setzen kann, ist rot unterwellt, mit dem Grund). Nach `\` kommen alle LaTeX-Befehle (`app/shell/tex-catalog.js`, über 350, auch seltene wie `\overset`, `\underbrace`, `\cancel`, `\substack`, und die Makros aus Paper und Masterarbeit) mit gesetzter Vorschau; Tab springt zur nächsten Stelle. `[[` schlägt Knoten vor, `[@` Quellen (zuerst die Werke des Projekts), `/` am Zeilenanfang Blöcke (auch Bild, Plot, Python-Plot, Rechnung mit `aligned`). Enter setzt Listen, nummerierte Listen und Aufgaben fort, Enter auf einem leeren Punkt beendet sie. Auch der Quelltext-Editor (Karten bearbeiten) nutzt ihn.
- **Kurzschrift** (Einstellungen › Schreiben): in Formeln `//` → `\frac{}{}`, `sr` → `^2`, `td` → `^{}`, `;a` → `\alpha`, `->` → `\to`, `dv` → `\dv{}{}` …; im Text `mk` → `$…$`, `dm` → `$$…$$`. Eigene Befehle (Kürzel → Text mit `#1`, `#2` … und `#0`, in Formeln, im Text oder überall, von selbst oder als Vorschlag) und eigene Makros (`\newcommand{\vev}[1]{\langle #1 \rangle}`), die in jeder Formel gelten.
- **Formel-Palette** (Σ in der Leiste): alle Befehle nach Gruppen mit Bild, gefunden auch über das, was sie tun („Bruch“, „Pfeil mit Text“).
- **Bilder** einfügen, hineinziehen oder über den Knopf: Sie liegen verkleinert unter `assets/` im Wissen und kommen mit dem Sync. **Plots**: ein ```` ```plot ```` -Block zeichnet Funktionen sofort (`y = sin(x)`, `x, y = cos(t), sin(t)`, `x: 0 .. 4pi`); ein ```` ```python plot ```` -Block zeichnet mit matplotlib einmal und legt das Bild unter `assets/plots/` ab, danach zeigt es jedes Gerät ohne Python.
- **Quellen** im Text: `[@fund]`, `[@fund, S. 12]`, `[@a; @b]` werden nummeriert, unten steht die Liste mit Adressen; „Zitieren“ neben jedem Werk setzt sie an die Cursorstelle; „Als Markdown kopieren“ im Seitenmenü macht daraus nummerierte Links.
- **Tasten** (`app/services/keys.js`): jede Aktion hat Standardtasten, in Einstellungen › Tasten änderbar (Konflikte werden gefragt), jeder Knopf zeigt seine Tasten beim Zeigen; `?` zeigt alle. Neu: Alt+H/P/W/R zu Start, Projekte, Schreiben, Recherche, Strg/⌘+, Einstellungen, Alt+S Sync. Ohne Tastatur (iPhone) bleiben die Tasten unsichtbar, außer du schaltest unter „Dieses Gerät“ die Tastatur ein.
- **Einstellungen** in Bereichen mit Leiste und Suche: Allgemein, Schreiben, Tasten, Zugänge (alle Tokens, Schlüssel und Adressen: Wissen, Holer, Mac-Helfer, OpenAlex, Semantic Scholar, Kobra), Wissen & Sync, Recherche (auch Lernquellen), Farben, Python, Dieses Gerät, Sichern & Laden, Bauplan. Die neuen Einstellungen (Schreiben, eigene Befehle und Makros, Tasten, Lernquellen) kommen mit in die verschlüsselte Datei.
- **Ziehen** mit Maus und Finger (`app/shell/drag.js`, auf dem iPhone kurz halten): Seiten, Kapitel und Überschriften der offenen Seite (der Abschnitt zieht mit).

## Projekt als Board, Widgets, Hell und Dunkel (0.18.0)

- **Board** (`app/shell/project-board.js`): Ein Projekt zeigt seine Karten in Bereichen mit Farbe, am Anfang Sammeln, Festhalten, Anwenden. Karten ziehst du innerhalb eines Bereichs und zwischen Bereichen, Bereiche ziehst du am Titel (auf dem iPhone kurz halten). „…“ an einem Bereich: umbenennen, Farbe, verschieben, löschen (die Karten bleiben im Projekt). „Neuer Bereich“ legt weitere an, ein Tipp auf den Titel klappt einen Bereich ein. Auf breiten Bildschirmen stehen die Bereiche nebeneinander, auf dem iPhone untereinander. Die Projektliste zeigt dieselben Bereiche mit ihren Zahlen.
- **Widgets** pro Projekt, über „Widget hinzufügen“, mit „…“ oder durch Ziehen am Kopf zu ordnen: Nächste Schritte, Seiten, Leseliste (Werke abhaken, Fortschritt), Angeheftet (Formeln und Snippets voll gesetzt, die Nadel auf jeder Karte heftet an), Rechenzettel (pro Zeile eine Rechnung, `a = 2` gibt Namen, Ergebnis daneben, ohne Code auszuführen), Fokus-Timer (15, 25, 50 Minuten, die Zeit wird im Projekt notiert), Termin (Tage bis dahin), Links (Repository, Overleaf, Kursseite) und Notizen.
- **Schublade:** Der Fokus-Knopf oben (oder Alt+B) klappt das Projekt im Fokus von überall auf: nächster Schritt, alle Bereiche, und der Knoten, den du gerade ansiehst, kommt mit einem Tipp in einen Bereich.
- **Suche beim Schreiben:** Rechts neben der Seite gibt es den Reiter „Suche“: Paper und Bücher aus den offenen Quellen, ohne die Seite zu verlassen. „Zitieren“ legt das Werk ins Projekt und setzt `[@…]` an die Cursorstelle, „Merken“ legt es nur ab, „Lesen“ öffnet den Leser und führt zurück.
- **Hell und dunkel** (Einstellungen › Aussehen): wie das Gerät, hell oder dunkel. `app/boot-theme.js` setzt die Wahl vor dem ersten Bild, damit nichts weiß aufblitzt; `app/services/theme.js` folgt danach dem Gerät. Die Wahl kommt mit in die verschlüsselte Einstellungsdatei. Kobra bleibt vorerst hell.
- **Im Wissen** (siehe Wissen/README): Bereiche, Kartenplätze und Widgets sind je eine Zeile im Kopf der Projektdatei (`sections`, `board_<id>`, `widgets`, `read`, `pins`, `due`, `due_what`), Links, Rechenzettel und Fokuszeiten Abschnitte darunter (`## Links`, `## Calc`, `## Time`). Ändern zwei Geräte gleichzeitig, vereint der Sync die Listen; bei einem umbenannten Bereich gewinnt dieses Gerät.

## Suche unter anderen Namen, 58 neue Snippets, Korrekturen (0.19.0)

- **Suche** (`app/services/search.js`, `app/services/synonyms.js`):
  - Code-Namen werden zerlegt und zusammengesetzt: curve_fit, FuncAnimation, np.linspace; „curvefit“ findet curve_fit.
  - Jedes Wort sucht auch seine Geschwister aus dem Wörterbuch (126 Gruppen, deutsch, englisch, Code-Namen, Kürzel wie np, plt, gh): „Ausgleichsgerade“, „regression“ und „kleinste quadrate“ finden die Fits, „Diagramm“ findet plot. Treffer über Geschwister zählen etwas weniger.
  - Eine Karte, die genau so heißt, wie du tippst (Titel oder Alias), steht vorn.
  - Ein Wort, das nirgends vorkommt, wird zum nächsten bekannten Namen korrigiert, auch bei vertauschten Buchstaben („plto“ → plot, „jackkinfe“ → jackknife). Die Suchleiste und der Spickzettel sagen es in einer Zeile.
  - Die Suche lernt: Was du nach einer Suche öffnest oder kopierst, steht beim nächsten Mal für dieselben Wörter vorn. Das Gelernte liegt unter `search.learned`, reist in der verschlüsselten Einstellungsdatei mit und lässt sich in Einstellungen › Allgemein vergessen.
- **Spickzettel:** Gruppen-Chips über der Liste, ein Tipp zeigt nur eine Gruppe. Neue Gruppen: Fits & Fehler, Physikalische Modelle, Logs & Protokolle, Terminal & Bash, GitHub.
- **58 neue Snippets im Wissen:**
  - 14 Fits: Messfehler, χ² und p-Wert, Startwerte, Peaks, Potenzgesetz, gedämpfte Schwingung, Grenzen, globaler Fit, Bootstrap, Residuen, x-Fehler, Ausreißer, effektive Masse aus Korrelatoren;
  - 6 Modelle: Ising, Zufallsweg, Oszillator, Wärmeleitung, Schrödinger 1D, Leapfrog;
  - 7 NumPy und 7 Matplotlib;
  - 10 Terminal und 8 GitHub (Token, SSH, zwei Konten, Fork und PR, gh, Actions, Release, geleakter Token);
  - 6 Logs.

  Alle sind als ungeprüft markiert. Alle 39 Python-Checks laufen in Pyodide.
- **`$${…}` in Snippets** bleibt ein wörtliches `${…}`, für Bash (`$${f%.dat}`) und GitHub Actions. `${name}` bleibt ein Platzhalter.
- **Korrekturen nach dem ersten Alltagstag:**
  - Ein Widget oder Bereich, den du auf einen anderen ziehst, nimmt dessen Platz ein (vorher entschied die linke oder rechte Hälfte).
  - Am Rand scrollt die Seite weiter, solange du hältst; neu ist auch „Ganz nach vorne“ im Menü.
  - Dialoge: Ein Tipp auf OK bei offener iPhone-Tastatur zählt nicht mehr als Tipp daneben (das brach das Umbenennen ab). Umbenennen meldet, ob gespeichert wurde.
- **Mac-Helfer in Chrome, Vivaldi, Edge, Brave und Firefox:** Diese Browser fragen, bevor eine Webseite den eigenen Rechner (localhost) oder das Heimnetz erreicht.
  - Die App kennzeichnet ihre Anfragen (`targetAddressSpace`), fragt die Erlaubnis ab (`loopback-network`, `local-network`) und erklärt im Verbindungstest, wo man sie erteilt.
  - Der Knopf „Im neuen Tab prüfen“ öffnet `…/ping`: Eine Antwort mit „error“ heißt, Helfer und Zertifikat sind in Ordnung.

## Library zum Stöbern (0.29.0)

Etappe 4b des Ökosystems. ENTE: „eine kleine Library, wo man durchstöbern kann. Das gilt auch für Dokumentationen“, die Regale „übersichtlich voneinander getrennt“.

- **Eigener Eintrag „Library“** in der Leiste (`#/m/shelf`; `#/m/library` bleibt das Schreiben eines Projekts). Vier Regale, jedes ein eigener Kasten mit Farbe:
  - **Weiterlesen:** was du zuletzt offen hattest (Werke im Leser, Seiten, die du schreibst), mit wie weit du gekommen bist. Eine Dokumentation steht einmal da, bei der Seite, die du zuletzt gelesen hast.
  - **Deine Texte:** deine Bücher, also die Seiten deiner Projekte; ein Tipp öffnet das Schreiben, „Zurück“ führt wieder in die Library.
  - **Dokumentationen:** Websites, die du durchgegangen bist, jede ein Buch. Ein Tipp zeigt den Inhalt als Baum, wie weit du bist, „Weiter: …“ und bei einem laufenden Durchgang seinen Fortschritt. Auch Seiten, deren Mappe gelöscht wurde, bleiben als Buch lesbar (bei dir die SciPy-Seiten).
  - **Papers & Funde:** was du behalten hast, nach Projekt geordnet, mit Neu, Angefangen und Gelesen.
- **Übersicht** zeigt alle vier untereinander, je eine Reihe Bücher (am iPhone seitlich wischen); ein Reiter zeigt ein Regal ganz. Oben eine Suche über die Titel und die Projekte als Chips: ein Tipp zeigt nur, was zu einem Projekt gehört.
- **Buchkarten:** Umschlag in einer festen Farbe (deine Texte in der Farbe ihres Projekts), Titel, Autoren oder Website, unten ein Balken, wie weit du gelesen hast. Werke sehen aus wie Papier, Dokumentationen wie Ordner.
- **Dokumentation holen:** Vorschläge Python (Tutorial), NumPy, SciPy, Matplotlib (User Guide) und das Rust-Buch, oder eine eigene Adresse. Es öffnet der bekannte Dialog „Website durchgehen“ mit Adresse und Bereich; was schon im Regal steht, ist markiert und öffnet sich.
- **Wie weit du gelesen hast** merkt sich der Leser auf dem Gerät (der weiteste Punkt, `reader.progress`); ab 90 % gilt ein Werk als gelesen, ebenso wenn du es in einem Projekt abgehakt hast.
- **Reiter „Projekt“ beim Schreiben:** neben der Seite der nächste Schritt mit Ampel, „Fertig“ und „Abgegeben“, die anderen Schritte (neu per Enter) und die Widgets des Projekts (Timer, Termin, Notizen, Bausteine).
- Auf Start führt „Alles in der Library“ unter „Weitermachen“ hinein.

## Schritte verschieben (0.28.1)

- Die Schritte eines Projekts lassen sich in eine andere Reihenfolge ziehen: im Projekt und im Kontrollpult, mit der Maus an der Zeile (oder an den Punkten links), am iPhone nach kurzem Drücken. Die obere oder untere Hälfte des Ziels sagt, ob der Schritt davor oder dahinter landet; die Ampel zieht mit (ENTE, 14.11.: „Man kann Steps nicht verschieben und tauschen“).

## Start und Widgets (0.28.0)

Etappe 4a des Ökosystems. ENTE: der Fokus „eigentlich wie ein kleines Kontrollpult“, und mehr Struktur für die 3–4 Projekte, an denen er gleichzeitig arbeitet.

- **Start als Board:** Oben bleibt die Frage mit Suchen und Anlegen. Darunter stehen Widgets, die du selbst wählst, ordnest (Menü ⋯ oder am Kopf ziehen), breit oder schmal machst und entfernst: Kontrollpult, Weitermachen, Eingang, weitere Projekte, Werkzeuge und eigene Bausteine. Gespeichert in `start.md` im Wissen (oben im Repository, kein Knoten), also auf Mac und iPhone gleich; am iPhone einspaltig.
- **Kontrollpult:** bis zu vier Projekte („Projekte wählen“). Das im Fokus ist aufgeklappt:
  - der nächste Schritt mit „Fertig“ und „Abgegeben“;
  - alle Schritte mit Ampel, erledigte eingeklappt, ein neuer Schritt per Enter;
  - wo du im roten Faden stehst, mit der nächsten Karte;
  - was du zuletzt im Projekt gemacht hast (Seite, Fund, Karte);
  - Fokus-Timer und Termin; Knöpfe zu Projekt, Schreiben und Netz.

  Die anderen stehen je in einer Zeile: Ampel, nächster Schritt, wie viele warten, Fortschritt, Tage bis zum Termin. Ein Tipp setzt sie in den Fokus.
- **Ampel an Schritten:** grau offen, rot als Nächstes, gelb abgegeben/wartet, grün fertig. Ein Tipp auf das Lämpchen ändert sie, das Häkchen macht grün. Wird ein Schritt grün oder gelb, sagt Toollib, womit du weitermachst: der nächste Schritt hier, sonst der rote eines anderen Projekts im Pult (ein Tipp setzt es in den Fokus). Gespeichert unter `## Next` als `- [ ]`, `- [!]`, `- [>]`, `- [x]` (Obsidian liest sie als Aufgaben).
- **Widget-Bausteine** auf Start und in Projekten: Verknüpfungen (Werkzeug, Karte/Projekt, Suche), Liste aus einer Suche (bleibt aktuell), Notiz (Markdown, Tippen zum Bearbeiten), Checkliste, Netz-Ausschnitt (um eine Karte oder das Projekt im Fokus), Countdown. Einrichten über das Menü ⋯. Gespeichert als eine Zeile `w_<id>: {…}` im Kopf und der Inhalt unter `## Widget <id>`.
- **In Projekten** sitzen die Widgets im selben Rahmen wie auf Start, können breit sein und Bausteine enthalten; die nächsten Schritte haben die Ampel.

## Kobra am iPhone: wischen und lange Namen (0.27.2)

- **Zusatztasten wischen:** Die Leiste mit Symbolen über der Tastatur lässt sich wieder seitlich wischen und gleitet ein Stück nach; eine Taste, über die du gewischt hast, tippt nichts. Die Ränder blenden aus, damit man sieht, dass es weitergeht (ENTE, 14.11.: ließ sich nicht scrollen, man sah nicht alles).
- **Lange Namen und Pfade:**
  - Projekte: Ein langer Name bricht im Blatt „Projekte“ um, höchstens zwei Zeilen, statt aus dem Blatt zu laufen (ENTE, 14.11., mit Bildschirmfoto).
  - Dateien: Namen brechen auf zwei Zeilen um; tiefe Ordner rücken höchstens sechs Stufen ein; der volle Pfad steht im Tooltip.
  - Oben steht bei Dateien in Ordnern `…/name`, damit der Name der Datei sichtbar bleibt; Reiter sind höchstens 14 Zeichenbreiten breit.
  - Geänderte Dateien im Git-Bereich zeigen den ganzen Pfad; Titel von Blättern laufen nicht mehr über den Rand.

## Roter Faden vorschlagen (0.27.1)

- **„Vorschlagen“** im Modus „Roter Faden“ der Leinwand ordnet die Karten eines Projekts entlang ihrer Herleitungen: Was eine Karte voraussetzt („folgt aus“, ihre Konventionen), kommt vor ihr; eine Kette bleibt beisammen; sonst Definitionen vor Formeln vor Snippets, dann die Reihenfolge des Boards. Notizen, Quellen und Mappen bleiben draußen. Danach änderst du ihn wie gewohnt durch Antippen; „Rückgängig“ im Hinweis stellt den alten wieder her.
- **„Führt zu“** steht nicht mehr als Überschrift im Text einer Karte, sondern im Zusammenhang daneben, zuerst unter „Verweisen hierher“, mit der Marke „führt zu“. Es steht nicht in der Karte selbst, sondern ergibt sich aus den Karten, die aus ihr folgen; „Folgt aus“ und „Konventionen“ bleiben in der Karte, weil du sie dort einträgst (ENTE, 14.11.).

## Fäden und Leinwand (0.27.0)

Dritte Etappe des Ökosystems: der Zusammenhang der Karten eines Projekts, sichtbar und von Hand geordnet.

- **Board oder Leinwand:** über den Karten eines Projekts schaltest du zwischen Board (Bereiche in Spalten) und **Leinwand** um; die Wahl bleibt pro Projekt. Auf der Leinwand liegen dieselben Karten frei, wie in einer Mindmap: Karten ziehen, Fläche ziehen verschiebt, zwei Finger oder Strg+Rad (Trackpad: zusammenziehen) zoomen, **0** zeigt alles, Vollbild mit dem Knopf rechts oben. Das Trackpad bewegt die Leinwand, sobald du hineingeklickt hast; vorher scrollt es die Seite.
- **Fäden sind Verknüpfungen:** vom kleinen Punkt rechts an einer Karte auf eine andere ziehen (oder „Faden“ einschalten, mit der Maus auch Alt+Ziehen). Der Faden ist eine Verknüpfung im Wissen (`links:`), also auch im Netz, in jedem Projekt und neben dem Knoten zu sehen, mit „Rückgängig“. Ein Klick auf einen Faden löst ihn wieder. Je enger zwei Karten fachlich zusammengehören, desto kräftiger ist ihr Faden (dieselbe Spannung wie im Netz); er läuft in den Farben seiner beiden Karten. Zeigst du auf eine Karte (am iPhone: antippen), leuchten ihre Fäden, der Rest tritt zurück.
- **Roter Faden in deiner Reihenfolge:** „Roter Faden“ einschalten und die Karten der Reihe nach antippen (etwa Definition → Formel → Snippet), ein zweiter Tipp nimmt eine heraus. Die Karten bekommen Nummern, eine leuchtend rote Linie mit Pfeilen verbindet sie. Neben jeder Karte steht dann „Roter Faden · Projekt: ← vorher  2 von 5  weiter →“. Gespeichert als eine Zeile `thread: [...]` im Projekt.
- **Gruppen:** Rahmen mit Namen und Farbe; am Namen ziehen nimmt die Karten darin mit, an der Ecke ziehen ändert die Größe.
- **Notiz auf der Leinwand:** Doppelklick (Doppeltipp) auf die freie Fläche oder „Notiz“: was du schreibst, wird eine echte Notiz im Wissen, im Projekt, genau an dieser Stelle. Doppelklick auf eine Karte öffnet sie.
- **Speicher:** Plätze und Gruppen in `projects/<name>.canvas` neben dem Projekt, im offenen JSON-Canvas-Format; Obsidian öffnet die Datei auch. Was verknüpft ist, steht nur im Wissen, die Leinwand widerspricht ihm also nie. Sync nimmt die Datei mit; Änderungen von anderen Geräten und Fenstern erscheinen live.
- **Fäden im Board:** Zeigst du im Board auf eine Karte (am iPhone: einmal antippen, ein zweiter Tipp öffnet sie), führen Linien zu den Karten, mit denen sie verknüpft ist, und rot zu ihren Nachbarn im roten Faden. Karten im roten Faden tragen ihre Nummer.

## Blätter am iPhone (0.26.1)

- Ein hohes Blatt (etwa der Filter im Netz) passt jetzt auf den Schirm: Kopf mit × bleibt oben sichtbar, nur der Inhalt scrollt (ENTE, 14.11.: ließ sich nicht scrollen, schließen ging nur am Rand). Dasselbe für Auswahlmenüs.
- Am iPhone zeigt der Kopf eines Blatts einen kleinen Griff: nach unten ziehen schließt es.
- „Wieder alles zeigen“ und „Neu anordnen“ im Netz schlossen ihr Blatt nicht (Fehler in 0.26.0), jetzt schon.

## Das Netz in 3D (0.26.0)

Zweite Etappe des Ökosystems: dein Wissen als Bild, durch das man sich bewegt.

- **Eigene Ansicht „Netz“** (Leiste, **Alt+G**, Befehlszeile „Netz“): ein Knoten in der Mitte mit allem, was bis zu „Tiefe“ Schritte um ihn liegt (Regler bis zur **Maximaltiefe**, einstellbar unter ⋯), oder **Ganzes Wissen** mit einer Obergrenze an Punkten (die nächsten und am besten verbundenen zuerst). `#/m/net/<slug>` stellt einen Knoten in die Mitte.
- **3D mit Ebenen in der Tiefe:** um einen Knoten liegen die Schritte hintereinander (Mitte, 1 Schritt, 2 Schritte …), beim ganzen Wissen die Bereiche (Physik, Mathematik, Programmieren …); wählbar auch nach Arten (Projekte & Notizen, Karten, Snippets, Quellen) oder frei in 3D. Die Ebenen bilden sich von selbst: jede zieht ihre Punkte nur sanft auf ihre Tiefe, ein feiner Ring deutet sie an. Ziehen dreht, Shift+Ziehen oder zwei Finger verschieben, Rad oder zwei Finger zoomen, R wieder von vorn, ▶ dreht langsam von selbst.
- **Spannung:** Je enger zwei Knoten fachlich zusammengehören (gleiches Thema, gleiche Gruppe, gleicher Bereich, gemeinsame Tags, gemeinsame Nachbarn; „folgt aus“ am stärksten, Konventionen und Projekte kaum), desto straffer und kürzer ist ihre Linie. So entstehen Wolken, eine pro Thema, mit einem farbigen Schleier dahinter. Durch Konventionen und Projekte wird nicht weitergegangen, sonst erreichten zwei Schritte alles.
- **Aussehen:** leuchtende Punkte, gebogene Linien im Farbverlauf ihrer Enden, Tiefe durch Nebel, ein feines Sternenfeld, Namen in Glas-Pillen; Bedienung schwebt als Glas über dem Bild. Hell und dunkel. Farben nach Typ (Formeln, Sätze, Definitionen, Konventionen, Themen … je eigene Farbe; Quellen grau) oder nach Bereich.
- **Filter:** Arten der Verbindung, Typen, Bereiche, nur ein Projekt, auch Knoten ohne Verbindung.
- **Verknüpfen im Netz:** „Verknüpfen“ einschalten, dann von einem Punkt zum anderen ziehen oder erst den einen, dann den anderen antippen (mit der Maus auch Alt+Ziehen). Ein Klick auf einen Punkt zeigt ihn mit seinen Verknüpfungen in einer Glaskarte; Doppelklick öffnet ihn.
- **Live:** neue Verknüpfungen, auch per Sync vom iPhone, erscheinen sofort; die Punkte bleiben, wo sie waren (Plätze bleiben auf dem Gerät, „Neu anordnen“ unter ⋯).
- **Kleines Netz neben jedem Knoten** (im Zusammenhang), ein Tipp öffnet das große.
- Dateien: `app/services/graph-layout.js` (Kräfte in 3D, Ebenen, Spannung), `app/shell/net-canvas.js` (Zeichnen, Drehen, Ziehen), `app/shell/net-view.js` (Ansicht, Auswahl, Filter, Spannung, kleines Netz).
- **Fehler behoben:** Escape schließt ein Blatt auch, wenn ein Feld darin den Fokus hat.

## Fundament des Ökosystems (0.25.0)

Erste von fünf Etappen (Plan vom 13.11.: Fundament, Netz, Fäden und Leinwand, Start und Widgets, Problem zuerst).

- **Verknüpfungen an einem Ort:** `app/services/relations.js` kennt alle Beziehungen zwischen Knoten: `links:` und `[[…]]`, „folgt aus“ (`derived_from`), Konventionen, Quellen `[@…]` in Seiten und Notizen, Seiten einer Bibliothek, Karten eines Projekts. Jede Änderung (hier gespeichert, in einem anderen Fenster oder per Sync vom iPhone) meldet sich sofort bei allen Ansichten (`onNodesChange` in search.js, `onRelationsChange`).
- **„Verknüpfungen“ neben jedem Knoten** (Zusammenhang): „Verweist auf“ und „Verweisen hierher“, Quellen und Bibliotheken markiert, Verweise auf noch fehlende Knoten. **Verknüpfen …** (oder **Alt+L**, oder in der Befehlszeile „verknüpfen“) sucht einen Knoten und schreibt eine Zeile `links:` in den Knoten; × löst sie wieder, mit Rückgängig. Ein `[[Verweis]]` im Text bleibt dort.
- **Einstellungen als Seiten:** `#/settings` ist die **Kontrollzentrale**: dieses Gerät in der Mitte, Wissen, Mac-Helfer, Recherche, Kobra, Python und (vorbereitet) der Hub drumherum, jede Verbindung mit Ampel und Linie in ihrer Farbe; darunter jede Seite als Kachel und eine Suche über alle Seiten. Mac-Helfer und Kobra haben eigene Seiten. Alte Adressen (`#/settings/sync`, `#/settings/access`) führen zur richtigen Seite. Jede Seite ist eine eigene Datei in `app/shell/settings/`.
- **Hell und dunkel mit einem Tipp:** Schalter über den Einstellungen in der Leiste, **Alt+D**, oder „dunkel“ in der Befehlszeile. „Wie das Gerät“ bleibt unter Einstellungen › Aussehen.
- **Ein Farbsystem** (`app/shell/colors.js`): dieselben neun Farben für Werkzeuge, Knotentypen, Bereiche und Board-Abschnitte, mit eigenem Ton im Dunkeln.
- **Code lesen:** `CODE.md` erklärt den Aufbau für jemanden, der Python kennt und kaum JavaScript; die neuen Dateien sind so kommentiert.
- **Fehler behoben:** Dialoge und Blätter bleiben bei einem Seitenwechsel nicht mehr offen.

## Scrollen beim Schreiben am Mac (0.24.3)

- In der Library mit „Nur die Seite“ ließ sich der Text mit dem Mausrad nur scrollen, wenn die Maus über der schmalen Textspalte stand; daneben tat sich nichts (ENTE, 13.11.). Jetzt ist die ganze Seite die Scrollfläche, die Spalte bleibt 760 px breit und mittig, die Scrollleiste steht am Rand der Seite. Dasselbe in der Vorschau.
- Editor, Vorschau, Inhaltsverzeichnis und Seitenleiste zeigen eine schmale Scrollleiste, auch wenn macOS sie sonst ausblendet (`app/shell/styles.css`, Ende des Abschnitts zur Library).

## Dialoge scrollen auf dem Handy (0.24.2)

- Hohe Dialoge (etwa „Website durchgehen“) ließen sich auf dem iPhone nicht scrollen. Jetzt hat jeder Dialog höchstens Bildschirmhöhe; nur der Inhalt scrollt, mit sichtbarer schmaler Scrollleiste, Titel und Knöpfe bleiben stehen (`.modal` in `app/shell/styles.css`).

## Alt-Kürzel nur außerhalb von Textfeldern (0.24.1)

- Kürzel nur mit Alt (Option), etwa Alt+H, P, W, R, S, B, gelten nur noch außerhalb von Textfeldern. Auf der deutschen Mac-Tastatur schreiben diese Tasten ª π ∑ ® ‚ ∫; im Feld gewinnt jetzt das Zeichen (ENTE, 13.11.). Kürzel mit ⌘/Strg (auch ⌘+Option) wirken wie bisher, Alt+1…9 wie seit 0.22.0. Einstellungen › Tasten nennen die Regel.

## Kobra fertig: Projekte, Englisch und Deutsch, Aussehen (0.24.0)

- **Kobra und Projekte:** Ein Projekt in Toollib kann ein Code-Repository verknüpfen (Menü des Projekts › „Code-Repository verknüpfen …“).
  - Zur Wahl stehen die Repositorys aus Kobras Konten oder eine eigene Adresse (nur https).
  - Im Projekt steht es dann mit „In Kobra öffnen“: Kobra öffnet das Projekt, das zu diesem Repository gehört, oder bietet das Klonen an.
- **Aus Kobra in den Spickzettel:** Mehr › „Als Snippet in Toollib“ nimmt die Auswahl (ohne Auswahl die ganze Datei) als Entwurf für ein neues Snippet.
- **Englisch und Deutsch:** Alle Texte von Kobra stehen in `app/i18n/strings.json` und folgen Toollibs Sprache.
  - Ein Wechsel gilt sofort, ohne Neuladen; Code, Konsole und ein laufendes Programm bleiben.
  - Neue Projekte aus Vorlagen, das Willkommensprojekt („First steps“ / „Erste Schritte“) und Kobras eigene Bausteine kommen in der gewählten Sprache. Bestehende Projekte bleiben, wie sie sind.
  - Das Projekt für Snippets mit Fenstern heißt auf Englisch „Snippets“; ein „Spickzettel“ aus 0.23.0 wird weiter benutzt.
- **Aussehen wie Toollib:** Knöpfe, Karten, Felder, Dialoge, Blätter und Meldungen haben Toollibs Maße. Blätter schweben mit Abstand zum Rand, Meldungen erscheinen unten. Kobras Gelb bleibt.
  - Behoben: Toollibs Seitenregeln griffen in Kobra, wo Klassen gleich heißen (`.settings`, `.btn`, `.console-out` …). Die Einstellungen standen in zwei ungleichen Spalten, Knöpfe mit langem Text schnitten ab, und bei leerer Konsole sprang die Eingabezeile nach oben.
- **Das alte Repository `Kobra`** hat oben in der README einen Hinweis: Kobra lebt jetzt in Toollib, Projekte sind im selben Browser schon da (gleiche Adresse, gleicher Speicher), der Git-Proxy funktioniert weiter.

## Schreiben am iPhone geht wieder (0.23.1)

- **Der Editor behält seine Höhe:** Beim ersten Tipp in den Text schrieb CodeMirror seine Klassen neu und warf dabei `md-editor` hinaus. Der Editor wuchs dann auf die Länge des ganzen Texts, sein eigenes Scrollen endete, der Rahmen schnitt ihn ab: Scrollen ging nicht mehr, und alle Zeilen wurden auf einmal gezeichnet (es hing). Betraf jede Seite, Quelltext und Notiz mit diesem Editor, auch am Desktop. Die Klassen kommen jetzt über CodeMirror selbst (`EditorView.editorAttributes`).
- **Mit offener Tastatur** sitzt die App fest auf dem sichtbaren Bereich (wie früher Kobras eigene Seite), statt mit der Seite mitzurutschen. Die Werte dafür werden nur noch gesetzt, wenn sie sich ändern; beim Gleiten des iPhones kamen sie viele Male in der Sekunde.

## Ein Python für alles (0.23.0)

- **Ein Worker für die ganze App:** Spickzettel („Ausprobieren“, Checks), Plots in Seiten und Kobra teilen sich einen Python-Worker (`kobra/worker.js`, verwaltet von `app/services/python-host.js`). Pyodide lädt nur einmal; wer zuerst Python braucht, startet es, der andere findet es fertig vor.
  - Jede Seite bekommt nur ihre eigene Ausgabe: Nachrichten eines Laufs tragen `owner` („toollib“ oder „kobra“).
  - input() fragt dort, wo das Programm läuft.
  - Ein Lauf der einen Seite beendet offene Fenster oder Animationen der anderen (es gibt nur ein Python).
  - Stopp startet Python neu, auch für die andere Seite; Kobras Dateien kommen von selbst wieder hinein.
  - In Kobra installierte Pakete stehen auch den Snippets zur Verfügung.
- **Snippets mit Fenstern** (tkinter, Qt) haben „In Kobra ausführen“: Der Code (mit den Snippets, die er braucht, darüber) kommt als Datei ins Kobra-Projekt „Spickzettel“ und startet dort mit echtem Fenster.
- `app/services/python-worker.js` wird nicht mehr gebraucht und kann weg (`git rm app/services/python-worker.js`).

## Kobra in Toollib, jede Ansicht bleibt an ihrer Stelle (0.22.0)

- **Kobra ist eine Ansicht in Toollib** (`#/m/kobra`, `app/shell/kobra-view.js`), keine eigene Seite mehr.
  - Toollibs Leiste, Befehlszeile und Modulleiste bleiben, Kobra füllt die Arbeitsfläche.
  - Kobra startet einmal und läuft weiter, während du in anderen Werkzeugen bist: Code, Konsole und laufende Programme sind beim Zurückkommen noch da.
  - Dialoge, Blätter, Meldungen und tkinter/Qt-Fenster liegen in einer eigenen Ebene über allem (`.kobra-layer`, `kobra/js/markup.js`).
  - Kobras Aussehen gilt nur in Kobra (`kobra/styles.css`, alle Regeln unter `.kobra-scope`), Farben und Hell/Dunkel kommen von Toollib.
  - Am Handy sind Kobras Bereiche Reiter oben unter der Kopfleiste, Toollibs Befehlszeile bleibt unten (entschieden am 01.11.). Bei offener Tastatur im Code macht die Befehlszeile Platz für Kobras Zusatztasten.
  - Die alte Adresse `kobra/` leitet hierher, `kobra/#settings` öffnet Kobras Git-Einstellungen; so auch „In Kobra verwalten“ in Toollibs Einstellungen.
  - Kobras Projekte und Schlüssel (`kobra.*`) bleiben, wie sie sind.
- **Jede Ansicht bleibt an ihrer Stelle** (`app/shell/shell.js`):
  - Gemerkt wird die Zeile oben am Bildschirm (ein Link ins Wissen) und ihr Abstand, nicht nur die Scroll-Höhe. Das iPhone hält die Stelle nicht von selbst, wenn Teile darüber später kommen.
  - Zurück, ein späterer Besuch derselben Ansicht (Start, Werkzeuge, Projekte, Knoten) und ein Neuaufbau an Ort und Stelle (im Projekt etwas abhaken, anheften, herausnehmen) kommen zu dieser Zeile zurück. Einstellungen und Formulare beginnen oben.
  - Schreiben: Jede Seite merkt sich, wo du warst (Zeile, Schreibmarke, Vorschau), für die letzten 40 Seiten. Am Handy behalten Inhalt, Übernehmen, die Trefferliste der Recherche und Gliederung und Markierungen im Leser ihre Stelle, während ein anderer Bereich zu sehen ist (`keepScroll` in `app/services/ui.js`).
- **Befehlszeile am iPhone:** Die Liste passt bei offener Tastatur in den sichtbaren Bereich und lässt sich scrollen. Vorher ragte sie über den oberen Rand. Die große Lücke zwischen Symbol und Text ist weg.
- **Tasten:** Option+Ziffer schreibt auf einer deutschen Mac-Tastatur `[ ] | \ { }`. Beim Tippen gewinnt jetzt das Zeichen, der Sprung (Alt+1…9) gilt außerhalb von Textfeldern.

## Kladde: Handschrift mit dem Daumen, als LaTeX lesbar (0.21.0)

- **Kladde ist ein Werkzeug von Toollib** (Modulleiste, „+“ › Handschrift, Taste H im Menü), gebaut aus deiner Kladde.html. Die Zeichentechnik ist fast unverändert:
  - die Schreiblupe unten, die als Rahmen über die Seite wandert und am rechten Rand weiterrückt;
  - Glättung gegen Daumenzittern, gerade Linien durch kurzes Halten am Strichende, Einrasten waagerecht und senkrecht;
  - vier Tinten, drei Stärken, Radierer für ganze Striche, Rückgängig;
  - Papier kariert, liniert, gepunktet oder blanko; Zoomen mit zwei Fingern.
- **Die Notizen liegen in deinem Wissen** (`app/services/kladde-store.js`): `notes/kladde-<datum>-<uhrzeit>.md` (`type: note`, mit `ink:`, `paper`, `sheets`) und daneben die `.ink`-Datei mit einem Strich pro Zeile (`app/services/ink.js`).
  - Git zeigt so nur geänderte Striche, Sync bringt beides auf jedes Gerät.
  - Die Notiz ist eine normale Notiz: Projekte, Eingang und Suche sehen sie; ihre Ansicht zeigt die Seite als Bild mit „In der Kladde öffnen“.
  - Wo die Lupe stand, bleibt auf dem Gerät.
- **Handschrift lesen** (⋯ › „Handschrift lesen (LaTeX)“, `app/services/ink-read.js`):
  - Die Seite wird in Zeilen geteilt; Zähler, Bruchstrich und Nenner bleiben eine Zeile.
  - Jede Zeile geht als kleines Bild an den Mac-Helfer (`POST /ink/latex`). Dort liest sie ein kleines Modell (Texo, 20 Millionen Parameter) nur auf dem Mac.
  - Du siehst jede Zeile als Formel, korrigierst das LaTeX, und „In die Notiz“ schreibt sie unter „## LaTeX (Kladde)“. Dort findet die Suche sie.
  - Unterwegs markiert „Vom Mac lesen lassen“ die Notiz; der Mac liest sie im Hintergrund mit seinem nächsten Sync.
  - Einrichten auf dem Mac: `bash install.sh --handschrift` (siehe `mac-helper/README.md`).
- **PDF (A4) und Bild** entstehen ohne Bibliothek aus dem Netz (`app/services/pdf-lite.js`; Kladde.html lud jsPDF von einem CDN), auf dem iPhone über das Teilen-Menü.
- **Am Handy** weicht die Befehlszeile, solange die Schreiblupe an ist (entschieden am 01.11.). Hell und dunkel folgen Toollib.
- **Die alte Kladde:** Liegen in diesem Browser Notizen der alten Kladde (gleiche Adresse auf GitHub Pages), bietet die Liste an, sie zu übernehmen.

## Kobra mit mehreren Konten, deine Repositorys überall (0.20.0)

- **Konten** (`kobra/js/accounts.js`, Kobra › Einstellungen › Git & GitHub): beliebig viele GitHub-Konten, jedes mit Bezeichnung (z. B. Privat, Uni), GitHub-Name, Name und E-Mail für Commits und eigenem Token.
  - „Token prüfen“ fragt GitHub, wem das Token gehört. Dann trägt es den GitHub-Namen ein, den Namen und die Adresse ohne Antwort (`123+name@users.noreply.github.com`), damit deine echte Adresse privat bleibt.
  - Das erste Konto steht in den Schlüsseln von früher (`kobra.git.name`, `.email`, `.token`), weitere in `kobra.git.accounts`.
- **Jedes Projekt hat sein Konto:** Commits tragen dessen Namen, Hochladen und Holen nehmen dessen Token.
  - Welches Konto: das, das du im Bereich Git oben beim Projekt wählst (es bleibt in deiner Liste gemerkt), sonst das Konto, dem das Repository gehört (`github.com/<GitHub-Name>/…`), sonst das erste.
  - Beim Klonen kannst du das Konto wählen.
- **Sicherheit:** Ein Token geht nur über https an den Rechner seines Kontos (github.com, falls nicht anders eingetragen), nie an eine andere Adresse. Zweignamen erscheinen als Text, nicht als HTML (vorher hätte ein Repository mit einem Zweig wie `<img/src/onerror=…>` Code in Kobra ausführen können).
- **Deine Repositorys überall** (`kobra.git.repos`): Jedes geklonte oder verbundene Repository kommt in die Liste, mit Adresse, Projektname, Konto und Zweig, ohne Tokens und ohne Dateien.
  - Die Liste reist mit Konten und Tokens in der verschlüsselten Einstellungsdatei. Beim Laden bleibt, was nur auf dem Gerät stand.
  - Projekte › „Noch nicht auf diesem Gerät“ zeigt, was hier fehlt; „Holen“ klont es mit dem gemerkten Konto.
  - „Alle auf den neuesten Stand“ holt jedes verbundene Projekt. Projekte mit Änderungen, die noch nicht committet sind, bleiben unberührt; hochgeladen wird nichts.
- **Am Handy:** Kobras Inhalt war auf schmalen Bildschirmen 18 px breiter als der Bildschirm und um diese Breite verschoben (abgeschnittene Zeilennummern und Überschriften). Kobra folgt jetzt Toollibs Wahl hell oder dunkel, solange in Kobra „Wie Toollib“ eingestellt ist.
- **Toollib › Einstellungen › Zugänge › Kobra** zeigt das erste Konto und zählt Konten und Repositorys; „In Kobra verwalten“ öffnet Kobras Einstellungen.

## Wissen abgleichen

Das Wissen liegt auf jedem Gerät im Browser-Speicher (IndexedDB, Dateisystem `toollib`, Ordner `/knowledge`), getrennt von Kobras Dateisystem `kobra`. Der Knopf Sync

1. sichert, was auf diesem Gerät geändert wurde, als Commit,
2. holt den Stand von GitHub,
3. führt beide Seiten zusammen und
4. lädt das Ergebnis hoch.

Wurde dieselbe Datei hier und auf GitHub geändert, verbindet Sync die Änderungen Zeile für Zeile wie Git. Betreffen beide dieselben Zeilen, bleiben beide Fassungen erhalten: die von GitHub unter dem alten Namen, die des Geräts daneben als `<name>.conflict-<gerät>-<datum>.md`. Die Übersicht listet solche Kopien; jede lässt sich antippen und mit zwei Knöpfen lösen: „Diese Fassung behalten“ ersetzt das Original, „Kopie löschen“ lässt es, wie es ist. Bei Mappen (`research/`) und gemerkten Funden (`clips/`) entsteht seit 0.14.1.1 keine Kopie: Listen wie `clips` werden vereinigt, bei einem geänderten Wert gilt der des Geräts, und zwei verschiedene Notizen bleiben beide stehen (erst die von GitHub, dann die des Geräts).

Sync läuft seit 0.14.1.1 auch von selbst (Einstellungen › Sync › „Von selbst synchronisieren“, standardmäßig an): rund 12 Sekunden nach einer Änderung, wenn du zur App zurückkehrst, wenn das Netz wieder da ist und alle drei Minuten, solange sie offen ist. Nie, bevor du einmal selbst synchronisiert hast, nie in den ersten 6 Sekunden nach einer Eingabe und nach einem Fehler erst nach fünf Minuten wieder. Zwei Fenster teilen sich eine Sperre (Web Locks), damit nicht beide zugleich abgleichen. Vor dem Ersetzen von Dateien sichert Sync noch einmal, was während des Abrufs geschrieben wurde. Eine Datei, die auf einer Seite gelöscht und auf der anderen geändert wurde, bleibt in der geänderten Fassung erhalten.

### Einrichten (einmal pro Gerät)

1. **Token:** GitHub › Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token. Unter *Repository access* „Only select repositories“ und nur `knowledge` wählen, unter *Repository permissions* **Contents: Read and write**. Ablaufdatum setzen.
2. **Proxy:** Browser dürfen nicht direkt mit GitHubs Git sprechen. Kobras Git-Proxy (Cloudflare Worker) funktioniert unverändert, weil Toollib unter derselben Adresse `https://<benutzername>.github.io` läuft und `ALLOWED_ORIGINS` damit schon passt.
3. In Toollib › Einstellungen › Abgleich des Wissens: Repository (`<benutzername>/knowledge`), Token, Proxy-Adresse, Name und E-Mail eintragen. „Verbindung testen“ prüft Lesen und Schreiben. Im Browser (nicht in der installierten App) gibt es einen Knopf, der Proxy, Name und E-Mail aus Kobra übernimmt.
4. Sync tippen.

Der Token bleibt im Speicher dieses Geräts und geht nur an den Proxy und an GitHub.

### Einstellungen sichern und auf ein anderes Gerät bringen (0.14.4.1)

Einstellungen › Einstellungen sichern › „Als verschlüsselte Datei sichern“ legt eine Datei `toollib-settings-<datum>.json` an: Sync, Holer, Mac-Helfer, Schlüssel, Quellen, Durchgehen, Sprache, Akzente und Kobras Git-Einstellungen, mit allen Tokens. Nicht darin: der Name des Geräts für Commits, Änderungen, die noch nicht bei GitHub sind, offene Mappen, Entwürfe. Auf dem iPhone kommt danach das Teilen-Menü (AirDrop, Dateien), auf dem Mac ein Download.

- Verschlüsselt mit AES-256-GCM; der Schlüssel kommt aus deinem Passwort (PBKDF2-SHA-256, 600 000 Runden, für jede Datei ein neues zufälliges Salz). Alles steht verschlüsselt in der Datei, auch die Namen der Einstellungen; eine veränderte Datei öffnet sich nicht. Ohne Passwort kann niemand sie lesen, auch Toollib nicht. Das Passwort wird nirgends gespeichert und braucht mindestens 12 Zeichen.
- Das Formular hat einen Namen („Toollib-Einstellungen“) neben dem Passwort: Safari schlägt ein starkes Passwort vor und behält es im iCloud-Schlüsselbund, auf dem iPhone füllt es AutoFill aus.
- „Aus Datei laden“: Datei wählen, Passwort, dann zeigt Toollib jede Einstellung, die neu ist oder sich ändert (Tokens als ••••••), jede mit einem Haken. Nur Angehakte ändern sich; was nicht in der Datei steht, bleibt. Eine Helfer-Adresse mit `localhost` ist nicht angehakt, wenn das Gerät schon eine andere hat (sie gilt nur auf dem Mac selbst). Danach gibt es „Vorherige Einstellungen wiederherstellen“, solange der Tab offen ist.

## Suchen, lesen, kopieren

- Befehlszeile (⌘K oder `/`, auf dem iPhone unten): Treffer aus dem Wissen stehen oben, darunter passende Befehle. Die Suche verzeiht Tippfehler, findet Wortanfänge und kennt englische und deutsche Namen (title, title_de, problems, problems_de, aliases, tags, Text).
- Suche nach Problemen: Schreib, was du lösen willst, z. B. „wie kann ich eine Simulation animieren“. Füllwörter wie „wie kann ich eine“ zählen nicht, eine leichte Stammform macht „animieren“, „Animation“ und „animate“ gleich. Ein Knoten, bei dem ein einziger Problem-Satz die ganze Frage abdeckt, rückt nach oben, und der Treffer zeigt diesen Satz („Löst: …“).
- Enter öffnet einen Knoten, ⇧ Enter oder das Kopier-Symbol kopiert ein Snippet sofort. Platzhalter wie `${x}` werden beim Kopieren zu `x`.
- Die Knoten-Ansicht zeigt den Text in der gewählten Sprache, Code und Formeln (als LaTeX) mit Kopierknopf, verwandte Knoten, die Quellen mit Link und Fundstelle sowie einen Link zur Datei auf GitHub.
- Modul Python-Spickzettel: oben die Rezepte (Schritt für Schritt zu einem größeren Ziel), darunter alle Snippets nach Gruppen, mit Filter und Kopierknopf. Oben steht, wie viele schon geprüft sind; „Zu prüfen“ und „Geprüft“ zeigen nur diese.
- Die Knoten-Ansicht zeigt unter dem Titel, wobei der Knoten hilft (problems in der gewählten Sprache).
- Zurück (Knopf oder Browser) führt an dieselbe Stelle, an der du warst, im Spickzettel auch mit demselben Filter. Jeder Eintrag im Verlauf merkt sich das in history.state; ein neuer Aufruf beginnt oben. Seit 0.14.1.2 merkt sich das Gerät die Stellen auch (wenn du in eine andere App wechselst oder weiterklickst): Das iPhone wirft die App im Hintergrund oft aus dem Speicher und öffnet sie neu, Zurück führt trotzdem an die alte Stelle. Kommt die Liste nach einem Neustart erst nach dem Suchindex, scrollt die App bis zu 5 Sekunden nach, außer du scrollst selbst.
- Der Suchindex entsteht beim Start und nach jedem Sync im Speicher; bei einigen tausend Knoten dauert das unter einer Sekunde.

## Prüfen

Knoten, die Claude oder ein Import angelegt hat, tragen `verified: false` und zeigen den Hinweis „Ungeprüft“. Darunter steht der Knopf „Als geprüft markieren“. Er ändert in der Datei auf dem Gerät genau eine Zeile (`verified: true`), sonst nichts. Die Statuszeile zeigt dann „Abgleich: 1 zum Hochladen“, und der nächste Sync lädt die Änderung mit einer lesbaren Commit-Nachricht hoch, z. B. `Sync from Mac: verified py-for-in`. Weil nur eine Zeile anders ist, verbindet Sync das auch mit Änderungen, die gleichzeitig auf einem anderen Gerät an derselben Datei entstanden sind. Rückgängig geht es unten in der Ansicht mit „Als ungeprüft markieren“.

Das ist die erste Änderung am Wissen direkt aus Toollib. Knoten mit fehlerhaften Kopfdaten und Konfliktkopien bekommen den Knopf nicht.

Ein geprüfter Knoten sieht aus wie jeder andere: kein Hinweis, kein Häkchen, unten nur der Link „Als ungeprüft markieren“. Im Spickzettel tragen die noch ungeprüften Snippets ein kleines „ungeprüft“; Auswahl (Alle · Zu prüfen · Geprüft) und Balken stehen nur da, solange es Entwürfe gibt.

## Eigene Snippets

- **Neu:** „Neues Snippet“ im Spickzettel oder in der Befehlszeile öffnet ein Formular: Titel (in der Sprache der App, der andere optional), Gruppe, „Hilft bei“ (ein Problem pro Zeile, so wie du suchst), Beschreibung, Stichworte, Code und Check. Ein Entwurf bleibt auf dem Gerät, bis du speicherst oder abbrichst.
- **Aus Ausprobieren:** ＋ in der Leiste übernimmt Code und Check ins Formular; die Gruppe und ein Link kommen vom Snippet, von dem du ausgehst.
- Gespeichert wird `nodes/snippets/<name>.md` mit `source: you` (Format in der README von Knowledge); Sync lädt es hoch, mit „added …“ in der Commit-Nachricht. Eigene Snippets tragen „Eigenes Snippet“ und den Knopf „Bearbeiten“ (dort auch „Löschen“).
- **Bestehende Knoten ändern:** Hast du im Feld Code oder Check geändert, erscheint „In den Knoten übernehmen“. Es ersetzt nur diesen Block in der Datei; unveränderte Zeilen behalten ihre Platzhalter. Sync lädt es mit „edited …“ hoch.

## Ausführen

Jedes Snippet hat zwei Knöpfe neben „Code kopieren“:

- **Ausprobieren** öffnet ein Feld mit dem Code des Snippets. Ändern, ergänzen, dann „Ausführen“ (oder Strg/⌘+Enter). Die Ausgabe steht direkt darunter.
- **Check ausführen** öffnet dasselbe Feld auf dem Reiter „Check“ und führt ihn aus, genau wie `check_nodes.py` in der Testumgebung: erst die Definitionen der benötigten Snippets, dann die des Snippets (aus dem Reiter „Code“), dann der Check. Ist er unverändert bestanden und der Knoten noch ungeprüft, bietet die Ausgabe gleich „Als geprüft markieren“ an.

Beide Reiter lassen sich bearbeiten. Was du änderst, bleibt auf diesem Gerät gespeichert, auch wenn du die Ansicht verlässt oder die App neu startest; ein Punkt am Reiter zeigt es an, ↺ holt die Fassung des Knotens zurück. Der Knoten selbst ändert sich dabei nie. Braucht das Snippet andere Snippets (Zeile `# needs:` im Check), lädt es deren Definitionen mit: Importe, Funktionen, Klassen und Konstanten in GROSSBUCHSTABEN.

Gängige Bibliotheken brauchen keine Import-Zeile: Wer `np`, `plt`, `quad`, `math` usw. benutzt, ohne sie zu definieren, bekommt den Import automatisch (`AUTO` in `app/services/toollib_snippets.py`), und die Ausgabe nennt ihn. `sp` bleibt außen vor, weil es mal scipy.sparse, mal sympy ist.

Die Ausgabe zeigt `print`, Fehler mit Traceback, ein Eingabefeld für `input()` und Abbildungen von matplotlib. Animationen (`FuncAnimation`, `plt.pause`) laufen im selben Bild weiter, bis „Stopp“ sie beendet. „Stopp“ während eines laufenden Programms startet Python neu (seit 0.23.0 auch für Kobra, das sich seine Dateien wieder hineinlegt).

Python ist Pyodide 314.0.7 (Python 3.14) mit numpy, scipy, matplotlib und sympy. Alles liegt in `vendor/pyodide/` und kommt von Toollibs eigener Adresse, kein Code verlässt das Gerät. Beim ersten Ausführen lädt der Kern (etwa 14 MB), jedes Paket erst, wenn ein Snippet es importiert. Einstellungen › Python › „Für offline speichern“ holt alles auf einmal (43 MB); danach laufen Snippets auch ohne Netz. Python liegt in einem eigenen Cache (`toollib-python-<version>`), der App-Updates übersteht.

Nicht im Browser: Threads und Prozesse (Pyodide kann keine starten) und `asyncio.run` in manchen Browsern. Snippets mit `runs: desktop` zeigen deshalb statt „Ausprobieren“ einen Hinweis; versucht eigener Code einen Thread zu starten, sagt die Ausgabe dasselbe. Git-Snippets (`language: shell`) sind Befehle fürs Terminal und werden nur kopiert. NumPy meldet im Browser weder NaN noch inf (keine RuntimeWarning, `np.errstate` greift nicht); das Snippet „Finden, wo NaN oder inf entsteht“ zeigt, wie man trotzdem die Stelle findet.

Noch nicht: Fenster von tkinter und Qt (kommen mit Kobras Fensteransicht) und Pakete außerhalb der vier (z. B. pandas); die Ausgabe sagt dann, warum.

## Kobra

Kobra (die Python-IDE) liegt seit 0.11.0 in `kobra/` und ist seit 0.22.0 eine Ansicht in Toollib (`#/m/kobra`): Modulleiste, Befehlszeile („Kobra öffnen“) oder Alt+Ziffer.

- Alles von Kobra ist dabei: Projekte, Editor mit Vervollständigung, Konsole mit `input()`, Fenster von tkinter und Qt, Pakete, Git.
- Bausteine: der Knopf neben „Start“ oder ⌘/Strg+J. Sie kommen aus dem Spickzettel (das Wissen auf diesem Gerät, nach Sync); die Suche versteht Probleme in eigenen Worten wie die Befehlszeile. Ein Tipp fügt den Code an der Schreibmarke ein, Tab springt durch die Platzhalter, „im Spickzettel“ öffnet Erklärung, Beispiel und Stolperfallen. Ohne abgeglichenes Wissen zeigt Kobra seine eigenen Bausteine.
- Python kommt aus `vendor/pyodide` (dafür jetzt auch micropip und jedi), Toollibs Service Worker liefert Kobra auch offline aus und trägt den Kanal für `input()` und Fenster (seit 0.23.0 `__toollib__/`, derselbe wie für die Snippets). Pakete außerhalb von `vendor/pyodide` lädt pip aus dem Netz.
- Projekte: Git › Klonen mit dem Konto, dem das Repository gehört, oder einem gewählten (seit 0.20.0 mehrere Konten, Einstellungen in Kobra). Die Projekte liegen im Speicher dieser Adresse; eine installierte App auf dem iPhone hat ihren eigenen Speicher.
- Seit 0.23.0 teilen Kobra und der Spickzettel ein Python, seit 0.24.0 auch Sprache und Aussehen. Eigen bleiben Kobras Speicher (die Projekte im Browser-Speicher „kobra“), Git und Kobras Einstellungen; so bleiben bestehende Projekte, wie sie sind.

## Formelsammlung

Die Formelsammlung (Modulleiste oder Befehlszeile) zeigt die Karten des Wissens: Knoten vom Typ `formula`, `definition`, `theorem` und `convention`, nach Bereich (`area`, erste Ebene) und Thema (`topic`, zweite Ebene). Jedes Thema hat eine Übersichtskarte (`type: topic`), die seine Karten in Lesereihenfolge verlinkt.

- Formeln in `$$ … $$` und `$ … $` setzt KaTeX (selbst gehostet in `vendor/katex`, lädt mit der ersten Formel, offline im Cache). „Kopieren“ gibt das LaTeX, wie es im Knoten steht. Die Makros aus Paper und Masterarbeit (`\gch`, `\psibar`, `\slashed`, `\ii`, `\dd`, `\tr`, `\expval` …) stehen in `app/shell/math.js`. KaTeX baut seine Elemente selbst, `\href` und Ähnliches bleiben aus; erlaubt ist nur `\htmlClass{choice-spot}`, die Markierung offener Konventionen.
- Eine Karte zeigt unter dem Text die Symbole (Feld `symbols`), „Folgt aus“ (`derived_from`), „Führt zu“ (Karten, die auf ihr aufbauen), ihre Konventionen und die Themen als Chips.
- „Check ausführen“ gibt es auch bei Karten: Der Check läuft im Python auf dem Gerät, danach „Als geprüft markieren“ wie bei Snippets.
- Offene Konventionen (0.13.0): Legt das Paper eine Konvention nicht fest, trägt die Karte `choices` und im Text Stellen `\choice{id}{…}{…}` mit dem Text für jede Möglichkeit. Die Karte zeigt einen Kasten „Konvention offen“: Du wählst, siehst Formeln, Text und Check mit deiner Wahl (markiert) und lässt den Check laufen. „Festlegen und als geprüft markieren“ schreibt die Wahl in die Karte und in alle Karten mit derselben Konvention (die bleiben ungeprüft) und legt `nodes/conventions/<id>.md` mit `decided` an. Die Formelsammlung zählt die offenen Konventionen und listet sie oben. Logik in `app/services/choices.js`, Kasten in `app/shell/choice-box.js`.
- Format der Karten: README im Repository knowledge.

## Recherche

Das Fenster Recherche (Modulleiste, Befehlszeile oder „Paper suchen“ in der Befehlszeile) sucht Paper und Bücher in sieben offenen Quellen zugleich: OpenAlex, Crossref, arXiv, Semantic Scholar, Europe PMC (Medizin und Pflege), DOAJ (Open-Access-Zeitschriften) und DOAB (Open-Access-Bücher). Alle sind kostenlos und legal; Schattenbibliotheken fragt Toollib nicht.

- Eingabe: Wörter, ein Titel, eine DOI, eine arXiv-ID, eine PMID oder PMC-Nummer, eine ISBN. Eine DOI oder arXiv-ID in der Befehlszeile führt direkt hierher.
- Toollib führt die Treffer derselben Arbeit zusammen (gleiche DOI, arXiv-ID oder PMID, sonst gleicher Titel mit gemeinsamem Autor) und ordnet ihre Fassungen: frei veröffentlicht, dann angenommene Fassung, dann Preprint, dann andere freie Kopien, zuletzt die nicht freien. Die Reihenfolge der Treffer kommt aus allen Quellen zusammen (Reciprocal Rank Fusion); freie Volltexte und die Wörter der Suche im Titel rücken nach oben.
- Hat ein Treffer keine freie Fassung, sucht Toollib beim Öffnen nach dem Titel weiter: ein arXiv-Preprint eines bezahlten Artikels, die veröffentlichte Fassung eines Preprints, eine Kopie in PubMed Central. Bei einer DOI oder arXiv-ID passiert das sofort.
- Merken legt einen Knoten `clips/<name>.md` an (`type: clip`, `source: scraper`, ungeprüft) mit allen Fassungen, der Zusammenfassung und, wenn du willst, „Hilft bei“ in deinen Worten. Eine Recherche-Mappe `research/<name>.md` (`type: research`, `source: you`) hält deine Frage, deine Notizen und die Liste ihrer Funde. Beides ist nach Sync offline durchsuchbar.
- Auf dem iPhone sind die drei Bereiche Reiter; auf Mac und Linux öffnet „Eigenes Fenster“ die Recherche allein (`index.html?solo=1`).
- Einstellungen › Recherche: der Holer (`fetch-proxy/`, für arXiv und DOAB, die Browser nicht direkt lesen dürfen), der kostenlose OpenAlex-Schlüssel (ohne ihn teilt OpenAlex ein kleines Tagesbudget mit allen in deinem Netz), wahlweise ein Semantic-Scholar-Schlüssel, die Quellen an und aus, „Verbindung testen“.
- Aus einem ganzen Werk (0.14.2): in den Details eines Treffers und im Fund-Knoten „Karte“, „Begriff“ oder „Snippet“; das Werk wird dabei gemerkt, der neue Knoten nennt es als Quelle und verlinkt den Fund.
- Eine Webadresse im Suchfeld (oder `crawl <adresse>` in der Befehlszeile) sucht nicht, sondern fragt: Website durchgehen, nur diese Seite lesen oder doch als Wörter suchen.
- Mac-Helfer (0.14.4, `mac-helper/README.md`): Einstellungen › Recherche › Mac-Helfer (Adresse, Token). Antwortet er, fragt Toollib ihn vor dem Holer: über deine Adresse zu Hause (DOAB antwortet), ohne Tageslimit bei Cloudflare. Schläft der Mac oder bist du unterwegs, übernimmt der Holer; einen stummen Helfer fragt Toollib erst nach zwei Minuten wieder. Er spricht HTTPS mit einem eigenen Zertifikat, das nur für Namen und Adressen im Heimnetz gilt (Safari lehnt http von https-Seiten ab).
- Im Netz (0.14.4.2): Hat der Mac-Helfer SearXNG, steht unter den Paper-Treffern der Bereich „Im Netz“ mit Websites zu denselben Wörtern: Lesen (Leser), Durchgehen (Dialog), Merken (als Seite in die gewählte Mappe). Bei einem Werk ohne freie Fassung sucht „PDF im Netz suchen“ den Titel in Anführungszeichen mit `filetype:pdf` und zeigt nur PDFs. Was dort steht, ist ungeprüft wie jeder Fund.
- PDF-Ordner (0.14.4): Jedes PDF, das Toollib über den Helfer liest (Leser, Durchgehen), bleibt als Original in `~/Toollib-PDFs/<website>/`; der Fund nennt es (`file`, `file_sha1`), „Original“ öffnet es. PDFs, die du in `~/Toollib-PDFs/Eingang/` legst, liest Toollib von selbst als Funde mit Text in die Mappe „PDF-Ordner“ ein (beim Start und alle fünf Minuten, solange die App offen ist und der Helfer antwortet; „Jetzt einlesen“ in der Mappe); danach liegen sie in `Eigene/`. Dieselbe Datei wird nur einmal ein Fund.
- Später (Teil 2): lange Durchgänge im Hintergrund auf dem Mac, auch vom iPhone angestoßen, und die Websuche mit SearXNG.

## Websites durchgehen

„Website durchgehen“ (Weltkugel neben „Recherchen“, eine Adresse im Suchfeld oder in der Befehlszeile) holt die Seiten unter einer Startadresse in eine neue Mappe, jede als Fund mit ihrem Text. Das läuft über deinen Holer (Einstellungen › Recherche).

- Im Fenster: Startadresse, „Nur Seiten unter“ (der Bereich; vorgeschlagen ist der Pfad der Startadresse, kürzer heißt mehr von der Website), Tiefe (Klicks von der Startseite), höchstens Seiten, PDFs mitnehmen, Name der Mappe. Die Vorgaben stehen unter Einstellungen › Recherche › Websites durchgehen (Tiefe 2, 200 Seiten, 1 s Abstand, PDFs an).
- Regeln: Toollib liest zuerst robots.txt und hält sich daran (Gruppe für Toollib, sonst für alle; Crawl-delay verlängert den Abstand), nimmt die Seiten der Sitemap dazu, wartet zwischen zwei Anfragen, folgt nur Links im Bereich und lässt Bilder, Dateien, `nofollow`-Links und fremde Websites weg. Seiten mit `noindex` speichert es nicht (ihren Links folgt es), doppelte Seiten (gleiche Adresse anders geschrieben, `canonical`, gleicher Text) nur einmal.
- PDFs, die eine Seite auf derselben Website verlinkt (auch außerhalb des Bereichs und eine Ebene tiefer), kommen mit ihrem Text; sie zählen als Seiten.
- Die Mappe zeigt oben den Durchgang: wie viele Seiten, wie viele warten, die Adresse gerade, „Anhalten“ und „Beenden“, danach „Fortsetzen“, „N Seiten mehr“ (an der Grenze) und „Erneut durchgehen“ (geänderte Seiten bekommen ihren neuen Text, deine Markierungen bleiben). Darunter, was übersprungen wurde und warum, und die Seiten als Baum nach ihrem Pfad.
- Anhalten lässt die Seite fertig laden, die gerade kommt. Der Stand liegt auf dem Gerät (nicht im Wissen): Schließt das iPhone die App, geht der Durchgang beim nächsten Öffnen weiter; ohne Netz hält er an und geht weiter, wenn das Netz zurück ist. Immer nur ein Durchgang zugleich; auf einem anderen Gerät kannst du ihn erneut durchgehen. Sync von selbst wartet während eines Durchgangs (höchstens alle fünf Minuten) und gleicht danach ab.
- Dateien: die Mappe `research/<name>.md` mit `crawl` (Start, Bereich, Tiefe, Grenze, PDFs), `crawl_state`, `crawl_pages`, `crawl_date`; jede Seite `clips/<site>-<titel>.md` (`type: clip`, `kind: page` oder `document`, `site`, `url`, `crawl`, `crawl_depth`, `links` auf die Seiten, auf die ihr Text verweist, `## Text`). Im Leser öffnen Links auf durchgegangene Seiten diese Seite aus deinem Wissen, auch offline.
- Auf dem Mac (0.14.4.2): Im Dialog „Wo es läuft“ › **Auf dem Mac**. Die Mappe bekommt `crawl_on: "mac"` und `crawl_state: "queued"`; Toollib gleicht ab und weckt den Helfer. Der Helfer (im Hintergrund, `mac-helper/README.md`) startet den ältesten wartenden Auftrag, gleicht während des Durchgangs alle zwei Minuten ab und danach sofort. Andere Geräte sehen in der Mappe „Durchgehen auf dem Mac“ den Stand des letzten Syncs (Seiten, wartende Adressen, Zeit) und schicken Anhalten, Beenden, Fortsetzen, Mehr Seiten, Erneut (`crawl_cmd`, `crawl_cmd_at`); der Helfer antwortet mit `crawl_cmd_done`. Erreicht das Gerät den Helfer, folgt er sofort, sonst mit seinem nächsten Sync (jede Minute).
- Seiten mit JavaScript (0.14.4): Kommt eine Seite mit wenig Text, aber Skripten an, zeigt der Mac-Helfer sie in Chromium; ihr Text und ihre Links zählen (`text_via: "render"`, „N von Chromium auf deinem Mac gezeigt“). PDFs des Durchgangs bleiben im PDF-Ordner.
- Grenzen: ohne Mac-Helfer bleiben Seiten, die ihren Inhalt erst mit JavaScript bauen, leer; Websites, die Server sperren, lehnen auch den Holer ab; erneutes Durchgehen holt jede Seite noch einmal.

## Leser

„Lesen“ (bei einem Treffer, bei jeder Fassung, in einem Fund-Knoten) macht das Fenster Recherche zum Leser: links die Gliederung, in der Mitte der Text, rechts deine Markierungen und Notizen. Auf dem iPhone sind das drei Reiter. Der Leser braucht den Holer (Einstellungen › Recherche), weil Browser fremde Seiten nicht lesen dürfen; ein schon gespeicherter Text geht auch offline.

- Woher der Text kommt: bei arXiv der LaTeX-Quelltext (Formeln, Gleichungsnummern, Querverweise, Literatur, Sätze), sonst die freie PDF-Fassung, sonst die Seite. Geht der Quelltext nicht (zum Beispiel nur ein PDF hochgeladen), liest Toollib das PDF und sagt es dazu.
- Webseiten: Toollib holt den Hauptinhalt (Readability) und macht Markdown daraus; Formeln aus KaTeX, MathJax und Wikipedia bleiben Formeln. PDFs: Text in Leserichtung (auch zweispaltig), ohne Kopfzeilen und Seitenzahlen, Silbentrennung zurückgesetzt, Überschriften nach Größe und Nummerierung, Literatur abgetrennt. Formeln in einem PDF sind nur Zeichen und können durcheinander aussehen; Scans ohne Textebene gehen noch nicht.
- Der gelesene Text steht im Fund-Knoten: `## Text` und `## References` (Kopfzeilen `text_via`, `text_url`, `text_fetched`), die Zusammenfassung bleibt oben. Bei einem gemerkten Fund wird der Text sofort gespeichert, sonst fragt „Merken und Text speichern“. Das PDF selbst behält der Mac-Helfer in deinem PDF-Ordner (seit 0.14.4, `file` im Fund); ohne ihn speichert Toollib nur den Text. Seiten mit wenig Text und Skripten zeigt der Helfer in Chromium.
- Markieren: Wörter auswählen, „Markieren“ oder „Mit Notiz“. Die Markierungen stehen im Fund-Knoten unter `## Highlights` (`> Zitat`, `§ Abschnitt`, Notiz) und werden nach dem Zitat wiedergefunden, auch wenn der Text neu geholt wird. Sync nimmt sie mit.
- „Aa“ wechselt die Textgröße, „Neu holen“ lädt den Text noch einmal; die Leseposition merkt sich Toollib.
- Karte aus der Auswahl (0.14.1.2): Wörter auswählen, „Karte“. Ein kleines Fenster ist schon ausgefüllt: Art (Formel, Definition, Satz, Begriff, nach dem Text geraten), Titel (die ersten Wörter, bei einer reinen Formel der Abschnitt), Thema (das zuletzt benutzte, Vorschläge aus deinen Karten), Text (Formeln als LaTeX) und seine Sprache. „Karte anlegen“ schreibt `nodes/formulas/<name>.md` (Begriffe nach `nodes/terms/`) mit `source: you`, `verified: false`, dem Werk und Abschnitt unter `sources` und einem Link auf den Fund-Knoten; der Fund wird dabei gemerkt. Die Karte steht sofort in der Suche und der Formelsammlung, Sync nimmt sie mit. Prüfen und ausbauen wie jede Karte.
- Snippet aus Code: Code im Text auswählen, „Snippet“ öffnet das Formular für ein eigenes Snippet mit dem Code und dem Werk als Herkunft.
- Dein Wissen (rechts, neben „Markierungen“; auf dem iPhone im dritten Reiter): oben die Karten und Snippets, die du aus diesem Werk angelegt hast, darunter was zum Abschnitt passt, den du gerade liest (er wechselt beim Scrollen). Das Suchfeld sucht in deinem Wissen; „Im Wissen“ in der Auswahl-Leiste sucht nach den ausgewählten Wörtern.
- Zitate: Nummern wie [12] oder [2, 3] im Text sind Links, wenn sie in der Literaturliste stehen. Ein Tipp öffnet ein kleines Fenster mit dem Eintrag und fragt, was du willst: „In der Recherche suchen“ (nach DOI, arXiv-Nummer oder Titel, der Leser schließt sich), „Zur Literaturliste“, oder, wenn du das Werk schon gemerkt hast, „In deinem Wissen öffnen“.
- In Seite (0.14.2): Wörter auswählen, „In Seite“. Die Stelle kommt als Zitat mit Quelle in die Seite deiner Bibliothek, die du zuletzt offen hattest, dorthin, wo der Cursor stand; die nächste Stelle kommt dahinter.
- Grenzen: Abbildungen und TikZ kommen nur als Beschriftung, Tabellen als einfache Tabellen; ein Makro, das Toollib nicht kennt, bleibt im Text stehen.

## Eigene Bibliotheken

Im Fenster Recherche stehen links unter den Mappen deine Bibliotheken; „+“ legt eine neue an. Eine Bibliothek ist dein eigenes Buch: Kapitel mit Seiten, die du selbst schreibst. Sie öffnet sich im ganzen Fenster: links der Inhalt, in der Mitte die Seite, rechts was du übernimmst. Auf dem iPhone sind das drei Reiter (Inhalt, Seite, Übernehmen).

- Schreiben: Markdown links, rechts gesetzt wie in der Knoten-Ansicht (Formeln mit KaTeX); „Beides“, „Schreiben“ oder „Vorschau“, auf dem iPhone die letzten zwei. Die Leiste setzt Überschrift (nochmal tippen: kleiner, dann keine), fett, kursiv, Formel im Satz, abgesetzte Formel, Liste, nummerierte Liste, Zitat, Code und `[[Link]]`. Nach `[[` schlägt Toollib Knoten aus deinem Wissen vor (Pfeiltasten, Enter). Strg/Cmd+B und I; Strg/Cmd+S speichert sofort. Gespeichert wird von selbst, kurz nachdem du aufhörst zu tippen, beim Verlassen und wenn die App in den Hintergrund geht. Auf dem iPhone treten Leiste und Kopf der Seite beim Tippen zur Seite.
- Titel und „Hilft bei“ (mehrere mit `;`) stehen über dem Text; die Suche findet die Seite danach wie jeden Knoten.
- Übernehmen, rechts: deine Markierungen aus allen Funden (die Werke, die die Seite schon zitiert, zuerst; „Lesen“ öffnet das Werk im Leser), dein Wissen (Suche; „Link“ setzt `[[name]]`, „Formel“ die erste Formel einer Karte mit Link) und die Quellen der Seite (eigene hinzufügen, etwa ein Buch mit Seite).
- Eine übernommene Stelle steht als Zitat mit Quelle darunter: `> Text`, `>`, `> — [[fund|Autor Jahr, Titel]], § Abschnitt`. Das Werk kommt in `sources` der Seite (Abschnitte gesammelt in `at`), der Fund in `links`; im Leser steht die Seite dann unter „Dein Wissen“.
- Kapitel und Seiten: „+“ am Kapitel legt eine Seite an, „…“ benennt um, verschiebt nach oben oder unten, in ein anderes Kapitel oder löscht. Abschnitte innerhalb einer Seite sind Überschriften.
- In der Knoten-Ansicht zeigt eine Bibliothek ihren Inhalt, eine Seite ihre Bibliothek und ihr Kapitel, „Davor“ und „Weiter“ und „Seite bearbeiten“. Nach einem Neustart der App öffnet sich die Bibliothek wieder auf derselben Seite.
- Dateien: `libraries/<bibliothek>/<bibliothek>.md` (`type: library`, Reihenfolge der Kapitel und Seiten in `chapters`, eine Zeile pro Kapitel) und `libraries/<bibliothek>/<seite>.md` (`type: page`, `library`, `lang`, `problems`, `sources`, `links`, darunter dein Text ohne Sprachblöcke). Wurde die Seite gleichzeitig anderswo geändert (Leser in einem zweiten Fenster, Sync), verbindet Toollib beides Zeile für Zeile; an denselben Zeilen bleibt dein Text, der andere liegt als Konfliktkopie daneben.

## Lokal ansehen

Im Ordner des Repositories:

```sh
python3 -m http.server 8000
```

Dann `http://localhost:8000` im Browser öffnen.

## Veröffentlichen

GitHub › Settings › Pages › „Deploy from a branch“, Zweig `main`, Ordner `/ (root)`. Die Seite liegt danach unter `https://<benutzername>.github.io/toollib/`.

Die leere Datei `.nojekyll` sorgt dafür, dass GitHub Pages alle Dateien unverändert ausliefert.

## Regeln

- Keine Tracker und keine Anfragen an fremde Server; Schriften und Bibliotheken kommen mit ins Repository. Ausnahmen: Der Abgleich spricht über deinen eigenen Git-Proxy mit GitHub, nur wenn du Sync tippst; die Recherche fragt die offenen Quellen direkt oder über deinen Holer, nur wenn du suchst, und schickt nichts über dich mit.
- Oberfläche auf Englisch, umstellbar auf Deutsch.
- In dieses Repository kommt nur Code, nie Inhalte aus `knowledge`: Dieses Repository und die Seite sind öffentlich.
- Fremde Bibliotheken nur in Versionen, die mindestens zwei Wochen alt sind (auch Pyodide).
