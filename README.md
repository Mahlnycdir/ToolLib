# Toollib

Persönliche Arbeitsoberfläche für Mac, iPhone und Linux: eine Web-App (PWA) auf GitHub Pages, dazu später ein Hub zu Hause. Das Wissen liegt getrennt im privaten Repository `knowledge`.

Stand: Basis, Schritt 1 von 5. Die Startseite zeigt den Fortschritt.

## Aufbau (geplant)

```text
toollib/                 dieses Repository, öffentlich
  index.html             Startseite, später der Rahmen (Shell)
  app/
    shell/               Command bar, Module bar, Workspace, Context panel
    services/            Speicher, Git-Abgleich, Python, Editor (aus Kobra)
    i18n/                en.json, de.json
    modules/             parts, pins, cheatsheet, workmode, kobra, kladde, scraper
  hub/                   Python-Server für zu Hause (FastAPI, MQTT, Scraper)
```

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

- Keine Tracker und keine Anfragen an fremde Server; Schriften und Bibliotheken kommen mit ins Repository.
- Oberfläche auf Englisch, umstellbar auf Deutsch.
- In dieses Repository kommt nur Code, nie Inhalte aus `knowledge`: Dieses Repository und die Seite sind öffentlich.
