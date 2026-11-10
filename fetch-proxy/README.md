# Holer für die Recherche (Cloudflare Worker)

Toollib sucht Paper direkt bei den offenen Schnittstellen (OpenAlex, Crossref, Europe PMC, DOAJ). Manche Seiten erlauben Browsern das Lesen ihrer Antworten nicht, allen voran arXiv. Für diese Seiten fragt Toollib diesen Worker: Er holt die Adresse und gibt die Antwort weiter. Er läuft wie Kobras Git-Proxy kostenlos bei Cloudflare und ist von Mac, Linux und iPhone aus erreichbar.

Der Worker nimmt nur Anfragen von deinen eigenen Seiten mit deinem Token an. Er holt nur öffentliche Adressen über http und https, also kein localhost und keine Adressen aus deinem Heimnetz. Eine Antwort darf höchstens 30 MB groß sein. Über dich schickt er nichts an die Seiten, nur den allgemeinen Namen `Toollib-Research/0.14.0 (personal research client)`.

## Einrichten (etwa 5 Minuten)

1. Melde dich bei [dash.cloudflare.com](https://dash.cloudflare.com) an, mit demselben Konto wie für den Git-Proxy.
2. Öffne **Workers & Pages › Create** und lege einen Worker aus der Vorlage „Hello World“ an. Nenne ihn `toollib-fetch` und tippe **Deploy**.
3. Tippe **Edit code**, ersetze den ganzen Code durch den Inhalt von `fetch-proxy/worker.js` und tippe **Deploy**.
4. Öffne den Worker › **Settings › Variables and Secrets** und lege zwei Einträge an:
   - `ALLOWED_ORIGINS`, Typ **Text**: `https://<benutzername>.github.io`. Mehrere Adressen trennst du mit Kommas.
   - `TOKEN`, Typ **Secret**: eine lange, zufällige Zeichenfolge. Im Terminal auf dem Mac erzeugt `openssl rand -hex 24` eine. Benutze nicht den GitHub-Token.
5. Tippe **Deploy**. Die Adresse des Workers steht oben, etwa `https://toollib-fetch.<name>.workers.dev`.
6. Trage in Toollib unter **Einstellungen › Recherche** die Adresse und den Token ein und tippe **Verbindung testen**. Steht dort „Holer erreichbar“, ist alles fertig.

Der Token bleibt im Speicher des Geräts und geht nur an deinen Worker. Auf jedem Gerät trägst du ihn einmal ein.

## Wahlweise

| Eintrag | Bedeutung |
| --- | --- |
| `ALLOWED_HOSTS` | Nur diese Seiten holen, mit Kommas getrennt; `*.example.org` erlaubt auch Unterseiten. Leer bedeutet alle öffentlichen Seiten, das brauchst du später zum Durchgehen von Websites. |
| `MAX_BYTES` | Größte Antwort in Byte, voreingestellt 31457280 (30 MB). |
| `USER_AGENT` | Der Name, mit dem der Worker sich meldet. |

## Was er kann

| Anfrage | Antwort |
| --- | --- |
| `GET /ping` | `{"ok":true,…}`, wenn der Token stimmt |
| `GET /fetch?url=<Adresse>` | die Antwort der Adresse; `X-Final-URL` nennt die Adresse nach Weiterleitungen |
| `&ttl=<Sekunden>` | Cloudflare darf eine erfolgreiche Antwort so lange aufheben, das schont die Seite |

Den Token schickt Toollib im Kopf `X-Toollib-Token`. Weitergegeben werden nur die Köpfe `Accept`, `Accept-Language`, `X-Api-Key` (für Semantic Scholar), `Range`, `If-None-Match` und `If-Modified-Since`; Cookies nie.

## Kosten und Grenzen

Der kostenlose Plan von Cloudflare erlaubt 100 000 Anfragen am Tag; eine Suche braucht eine Anfrage pro Quelle, die der Browser nicht direkt fragen darf. arXiv bittet um höchstens eine Anfrage alle drei Sekunden, Toollib hält das ein.

## Aktualisieren (0.14.1)

Version 0.14.1 gehört zum Leser: Der Worker gibt gepackte Antworten (arXiv-Quelltexte) mit richtiger Länge weiter. Wer den Worker schon hat, ersetzt den Code durch das neue `worker.js` und tippt **Deploy**; „Verbindung testen“ nennt danach Version 0.14.1. Ohne das Update liest Toollib arXiv-Paper notfalls als PDF statt aus dem LaTeX-Quelltext.
