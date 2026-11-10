# Toollib

Persönliche Arbeitsoberfläche für Mac, iPhone und Linux: eine Web-App (PWA) auf GitHub Pages, dazu später ein Hub zu Hause. Das Wissen liegt getrennt im privaten Repository `knowledge`.

Stand: Version 0.14.2 (eigene Bibliotheken mit Kapiteln und Seiten schreiben, mit Stellen aus deinen Funden; seit 0.14.1.2 aus dem Leser schnell Karten und Snippets anlegen, „Dein Wissen“ neben dem Text, Zitate wie [12] antippen; Zurück findet die Stelle auch nach einem Neustart der App; seit 0.14.1.1 läuft Sync von selbst), das Fenster Recherche hat einen Leser (Seiten, PDFs und arXiv-Quelltext lesen, markieren, Notizen) und sucht Paper mit freien Fassungen; Stufe 3 (Formelsammlung) läuft, Welle 2 (mathematische Methoden) ist drin; Stufe 2 (Python-Spickzettel als volles Modul) ist fertig. Der Rahmen läuft als installierbare App und startet offline. Ein Tipp auf Sync holt das Wissen aufs Gerät; die Befehlszeile durchsucht es, Knoten lassen sich lesen und Snippets kopieren, auch ohne Netz. Seit 0.6.0 lässt sich ein Knoten in der App als geprüft markieren; Sync lädt die Änderung hoch. Seit 0.7.0 sucht die Befehlszeile auch nach Problemen in deinen eigenen Worten, und der Spickzettel hat Rezepte. Seit 0.8.0 laufen Snippets direkt in der App: Python mit numpy, scipy, matplotlib und sympy läuft im Browser, von Toollibs eigener Adresse. Seit 0.9.0 legst du eigene Snippets an und änderst Code und Check bestehender Knoten. Seit 0.10.0 gibt es die Gruppen Datenstrukturen, Fehlersuche, Threads & Prozesse und Git. Seit 0.11.0 ist Kobra Teil von Toollib, mit den Bausteinen aus dem Spickzettel. Seit 0.12.0 sind Formeln gesetzt (KaTeX) und es gibt die Formelsammlung: verknüpfte Karten nach Bereich und Thema. Seit 0.13.0 legst du offene Konventionen selbst fest. Seit 0.14.0 sucht das Fenster Recherche Paper und Bücher in sieben offenen Quellen und merkt sie in Recherche-Mappen.

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
                         search.js (Suchindex), python.js und python-worker.js (Python ausführen, aus Kobra),
                         toollib_snippets.py (baut aus Snippet, benötigten Snippets und Check ein Programm),
                         research.js (Suche über alle Quellen, Holer, Einstellungen), research-sources.js (die Quellen),
                         research-merge.js (Fassungen zusammenführen und ordnen), research-store.js (Funde und Mappen
                         als Knoten), channel.js (Fenster sagen einander, welche Knoten sich geändert haben),
                         reader.js (Leser: Plan, Holen, Gliederung, Text und Markierungen im Fund-Knoten),
                         reader-cards.js (Leser: Karte aus der Auswahl, passendes Wissen, Zitate [12]),
                         library-store.js (eigene Bibliotheken: Kapitel, Seiten, Zitate mit Quelle, Zusammenführen),
                         reader-latex.js (arXiv-Quelltext → Markdown, ohne DOM), reader-html.js (Webseiten),
                         reader-pdf.js (PDF-Text mit pdf.js)
    shell/               shell.js (Befehlszeile, Modulleiste, Statuszeile), views.js, modules.js, styles.css,
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
  tools/                 Hilfsprogramme: import-snippets, build-vendor, fetch-pyodide
```

Neue Datei im App-Ordner? Dann auch in die Liste `FILES` in `sw.js` eintragen und `VERSION` erhöhen, sonst fehlt sie offline.

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

Die Ausgabe zeigt `print`, Fehler mit Traceback, ein Eingabefeld für `input()` und Abbildungen von matplotlib. Animationen (`FuncAnimation`, `plt.pause`) laufen im selben Bild weiter, bis „Stopp“ sie beendet. „Stopp“ während eines laufenden Programms beendet Python ganz; es startet beim nächsten Ausführen neu.

Python ist Pyodide 314.0.7 (Python 3.14) mit numpy, scipy, matplotlib und sympy. Alles liegt in `vendor/pyodide/` und kommt von Toollibs eigener Adresse, kein Code verlässt das Gerät. Beim ersten Ausführen lädt der Kern (etwa 14 MB), jedes Paket erst, wenn ein Snippet es importiert. Einstellungen › Python › „Für offline speichern“ holt alles auf einmal (43 MB); danach laufen Snippets auch ohne Netz. Python liegt in einem eigenen Cache (`toollib-python-<version>`), der App-Updates übersteht.

Nicht im Browser: Threads und Prozesse (Pyodide kann keine starten) und `asyncio.run` in manchen Browsern. Snippets mit `runs: desktop` zeigen deshalb statt „Ausprobieren“ einen Hinweis; versucht eigener Code einen Thread zu starten, sagt die Ausgabe dasselbe. Git-Snippets (`language: shell`) sind Befehle fürs Terminal und werden nur kopiert. NumPy meldet im Browser weder NaN noch inf (keine RuntimeWarning, `np.errstate` greift nicht); das Snippet „Finden, wo NaN oder inf entsteht“ zeigt, wie man trotzdem die Stelle findet.

Noch nicht: Fenster von tkinter und Qt (kommen mit Kobras Fensteransicht) und Pakete außerhalb der vier (z. B. pandas); die Ausgabe sagt dann, warum.

## Kobra

Kobra (die Python-IDE) liegt seit 0.11.0 fast unverändert in `kobra/` und öffnet sich über die Modulleiste oder die Befehlszeile („Kobra öffnen“). Oben links führt das T zurück zu Toollib.

- Alles von Kobra ist dabei: Projekte, Editor mit Vervollständigung, Konsole mit `input()`, Fenster von tkinter und Qt, Pakete, Git.
- Bausteine: der Knopf neben „Start“ oder ⌘/Strg+J. Sie kommen aus dem Spickzettel (das Wissen auf diesem Gerät, nach Sync); die Suche versteht Probleme in eigenen Worten wie die Befehlszeile. Ein Tipp fügt den Code an der Schreibmarke ein, Tab springt durch die Platzhalter, „im Spickzettel“ öffnet Erklärung, Beispiel und Stolperfallen. Ohne abgeglichenes Wissen zeigt Kobra seine eigenen Bausteine.
- Python kommt aus `vendor/pyodide` (dafür jetzt auch micropip und jedi), Toollibs Service Worker liefert Kobra auch offline aus und trägt den Kanal für `input()` und Fenster (`kobra/__kobra__/`). Pakete außerhalb von `vendor/pyodide` lädt pip aus dem Netz.
- Projekte: Git › Klonen mit Kobras Token (Einstellungen in Kobra). Im selben Browser auf dem Mac sieht Kobra in Toollib dieselben Projekte wie die eigenständige Kobra (gleiche Adresse); eine installierte App auf dem iPhone hat ihren eigenen Speicher.
- Bewusst noch nicht angeglichen (fundament.md, „Später angleichen“): Kobras Texte sind deutsch und fest im Code, Kobra hat sein eigenes Aussehen und sein eigenes Python neben dem des Spickzettels, eigene Dienste für Speicher, Git und Einstellungen.

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
- Später: Websites durchgehen (0.14.3), Mac-Helfer mit PDF-Ordner und SearXNG (0.14.4).

## Leser

„Lesen“ (bei einem Treffer, bei jeder Fassung, in einem Fund-Knoten) macht das Fenster Recherche zum Leser: links die Gliederung, in der Mitte der Text, rechts deine Markierungen und Notizen. Auf dem iPhone sind das drei Reiter. Der Leser braucht den Holer (Einstellungen › Recherche), weil Browser fremde Seiten nicht lesen dürfen; ein schon gespeicherter Text geht auch offline.

- Woher der Text kommt: bei arXiv der LaTeX-Quelltext (Formeln, Gleichungsnummern, Querverweise, Literatur, Sätze), sonst die freie PDF-Fassung, sonst die Seite. Geht der Quelltext nicht (zum Beispiel nur ein PDF hochgeladen), liest Toollib das PDF und sagt es dazu.
- Webseiten: Toollib holt den Hauptinhalt (Readability) und macht Markdown daraus; Formeln aus KaTeX, MathJax und Wikipedia bleiben Formeln. PDFs: Text in Leserichtung (auch zweispaltig), ohne Kopfzeilen und Seitenzahlen, Silbentrennung zurückgesetzt, Überschriften nach Größe und Nummerierung, Literatur abgetrennt. Formeln in einem PDF sind nur Zeichen und können durcheinander aussehen; Scans ohne Textebene gehen noch nicht.
- Der gelesene Text steht im Fund-Knoten: `## Text` und `## References` (Kopfzeilen `text_via`, `text_url`, `text_fetched`), die Zusammenfassung bleibt oben. Bei einem gemerkten Fund wird der Text sofort gespeichert, sonst fragt „Merken und Text speichern“. Das PDF selbst speichert Toollib nicht (das kommt mit dem Mac-Helfer in 0.14.4).
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
