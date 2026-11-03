# Toollib

Persönliche Arbeitsoberfläche für Mac, iPhone und Linux: eine Web-App (PWA) auf GitHub Pages, dazu später ein Hub zu Hause. Das Wissen liegt getrennt im privaten Repository `knowledge`.

Stand: Version 0.8.2, Stufe 2 (Python-Spickzettel als volles Modul) läuft. Der Rahmen läuft als installierbare App und startet offline. Ein Tipp auf Sync holt das Wissen aufs Gerät; die Befehlszeile durchsucht es, Knoten lassen sich lesen und Snippets kopieren, auch ohne Netz. Seit 0.6.0 lässt sich ein Knoten in der App als geprüft markieren; Sync lädt die Änderung hoch. Seit 0.7.0 sucht die Befehlszeile auch nach Problemen in deinen eigenen Worten, und der Spickzettel hat Rezepte. Seit 0.8.0 laufen Snippets direkt in der App: Python mit numpy, scipy, matplotlib und sympy läuft im Browser, von Toollibs eigener Adresse.

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
  app/
    main.js              Start: Texte laden, Rahmen bauen, Service Worker anmelden
    i18n/                strings.json (jeder Satz auf Englisch und Deutsch), i18n.js mit t()
    services/            ui.js und icons.js aus Kobra, prefs.js, pwa.js,
                         storage.js (Dateien auf dem Gerät), sync.js (Abgleich mit GitHub),
                         nodes.js (Knoten lesen: Kopfdaten, Sprachblöcke, Quellen; ein Feld ändern),
                         search.js (Suchindex), python.js und python-worker.js (Python ausführen, aus Kobra),
                         toollib_snippets.py (baut aus Snippet, benötigten Snippets und Check ein Programm)
    shell/               shell.js (Befehlszeile, Modulleiste, Statuszeile), views.js, modules.js, styles.css,
                         node-view.js (Knoten-Ansicht, Python-Spickzettel), markdown.js (sicherer Markdown-Leser),
                         run-panel.js (Ausprobieren, Check ausführen), console.js (Ausgabe, input(), Abbildungen)
  tools/                 Hilfsprogramme: import-snippets, build-vendor, fetch-pyodide
```

Neue Datei im App-Ordner? Dann auch in die Liste `FILES` in `sw.js` eintragen und `VERSION` erhöhen, sonst fehlt sie offline.

## Wissen abgleichen

Das Wissen liegt auf jedem Gerät im Browser-Speicher (IndexedDB, Dateisystem `toollib`, Ordner `/knowledge`), getrennt von Kobras Dateisystem `kobra`. Der Knopf Sync

1. sichert, was auf diesem Gerät geändert wurde, als Commit,
2. holt den Stand von GitHub,
3. führt beide Seiten zusammen und
4. lädt das Ergebnis hoch.

Wurde dieselbe Datei hier und auf GitHub geändert, verbindet Sync die Änderungen Zeile für Zeile wie Git. Betreffen beide dieselben Zeilen, bleiben beide Fassungen erhalten: die von GitHub unter dem alten Namen, die des Geräts daneben als `<name>.conflict-<gerät>-<datum>.md`. Die Übersicht listet solche Kopien; du entscheidest, welche bleibt. Eine Datei, die auf einer Seite gelöscht und auf der anderen geändert wurde, bleibt in der geänderten Fassung erhalten.

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
- Zurück (Knopf oder Browser) führt an dieselbe Stelle, an der du warst, im Spickzettel auch mit demselben Filter. Jeder Eintrag im Verlauf merkt sich das in history.state; ein neuer Aufruf beginnt oben.
- Der Suchindex entsteht beim Start und nach jedem Sync im Speicher; bei einigen tausend Knoten dauert das unter einer Sekunde.

## Prüfen

Knoten, die Claude oder ein Import angelegt hat, tragen `verified: false` und zeigen den Hinweis „Ungeprüft“. Darunter steht der Knopf „Als geprüft markieren“. Er ändert in der Datei auf dem Gerät genau eine Zeile (`verified: true`), sonst nichts. Die Statuszeile zeigt dann „Abgleich: 1 zum Hochladen“, und der nächste Sync lädt die Änderung mit einer lesbaren Commit-Nachricht hoch, z. B. `Sync from Mac: verified py-for-in`. Weil nur eine Zeile anders ist, verbindet Sync das auch mit Änderungen, die gleichzeitig auf einem anderen Gerät an derselben Datei entstanden sind. Rückgängig geht es unten in der Ansicht mit „Als ungeprüft markieren“.

Das ist die erste Änderung am Wissen direkt aus Toollib. Knoten mit fehlerhaften Kopfdaten und Konfliktkopien bekommen den Knopf nicht.

## Ausführen

Jedes Snippet hat zwei Knöpfe neben „Code kopieren“:

- **Ausprobieren** öffnet ein Feld mit dem Code des Snippets. Ändern, ergänzen, dann „Ausführen“ (oder Strg/⌘+Enter). Die Ausgabe steht direkt darunter.
- **Check ausführen** öffnet dasselbe Feld auf dem Reiter „Check“ und führt ihn aus, genau wie `check_nodes.py` in der Testumgebung: erst die Definitionen der benötigten Snippets, dann die des Snippets (aus dem Reiter „Code“), dann der Check. Ist er unverändert bestanden und der Knoten noch ungeprüft, bietet die Ausgabe gleich „Als geprüft markieren“ an.

Beide Reiter lassen sich bearbeiten. Was du änderst, bleibt auf diesem Gerät gespeichert, auch wenn du die Ansicht verlässt oder die App neu startest; ein Punkt am Reiter zeigt es an, ↺ holt die Fassung des Knotens zurück. Der Knoten selbst ändert sich dabei nie. Braucht das Snippet andere Snippets (Zeile `# needs:` im Check), lädt es deren Definitionen mit: Importe, Funktionen, Klassen und Konstanten in GROSSBUCHSTABEN.

Gängige Bibliotheken brauchen keine Import-Zeile: Wer `np`, `plt`, `quad`, `math` usw. benutzt, ohne sie zu definieren, bekommt den Import automatisch (`AUTO` in `app/services/toollib_snippets.py`), und die Ausgabe nennt ihn. `sp` bleibt außen vor, weil es mal scipy.sparse, mal sympy ist.

Die Ausgabe zeigt `print`, Fehler mit Traceback, ein Eingabefeld für `input()` und Abbildungen von matplotlib. Animationen (`FuncAnimation`, `plt.pause`) laufen im selben Bild weiter, bis „Stopp“ sie beendet. „Stopp“ während eines laufenden Programms beendet Python ganz; es startet beim nächsten Ausführen neu.

Python ist Pyodide 314.0.7 (Python 3.14) mit numpy, scipy, matplotlib und sympy. Alles liegt in `vendor/pyodide/` und kommt von Toollibs eigener Adresse, kein Code verlässt das Gerät. Beim ersten Ausführen lädt der Kern (etwa 14 MB), jedes Paket erst, wenn ein Snippet es importiert. Einstellungen › Python › „Für offline speichern“ holt alles auf einmal (43 MB); danach laufen Snippets auch ohne Netz. Python liegt in einem eigenen Cache (`toollib-python-<version>`), der App-Updates übersteht.

Noch nicht: Fenster von tkinter und Qt (kommen mit Kobras Fensteransicht) und Pakete außerhalb der vier (z. B. pandas); die Ausgabe sagt dann, warum.

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

- Keine Tracker und keine Anfragen an fremde Server; Schriften und Bibliotheken kommen mit ins Repository. Einzige Ausnahme ist der Abgleich: Er spricht über deinen eigenen Git-Proxy mit GitHub, und nur wenn du Sync tippst.
- Oberfläche auf Englisch, umstellbar auf Deutsch.
- In dieses Repository kommt nur Code, nie Inhalte aus `knowledge`: Dieses Repository und die Seite sind öffentlich.
- Fremde Bibliotheken nur in Versionen, die mindestens zwei Wochen alt sind (auch Pyodide).
