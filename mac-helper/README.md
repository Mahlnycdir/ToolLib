# Mac-Helfer für die Recherche

Der Mac-Helfer ist ein kleines Python-Programm auf deinem Mac. Toollib fragt ihn für alles, was der Browser und der Cloudflare-Worker nicht können:

- **Von zu Hause holen:** Seiten, PDFs und Schnittstellen über deine Adresse zu Hause. DOAB und manche Websites sperren Server, auch den Worker; über den Helfer antworten sie.
- **Seiten mit JavaScript:** Ein echtes Chromium (über Playwright) öffnet Seiten, die ihren Inhalt erst beim Laden bauen. Der Leser und das Durchgehen nehmen ihn von selbst, wenn eine Seite ohne Text ankommt.
- **PDF-Ordner:** Jedes PDF, das Toollib über den Helfer liest, bleibt als Original in `~/Toollib-PDFs/<website>/`. PDFs, die du selbst in `~/Toollib-PDFs/Eingang/` legst (Skripte, Bücher, Mitschriften), liest Toollib als Funde mit Text in die Mappe „PDF-Ordner“ ein; danach liegen sie in `~/Toollib-PDFs/Eigene/`. Im Wissen steht nur der Text, die Datei bleibt auf dem Mac.

Ist der Mac aus oder du unterwegs, nimmt Toollib wie bisher den Worker. Lange Durchgänge im Hintergrund und die Websuche mit SearXNG kommen mit Teil 2.

## Einrichten (etwa 5 Minuten)

1. Terminal öffnen und:
   ```bash
   cd ~/ToolLib/mac-helper && bash install.sh
   ```
   Das legt `~/.toollib-helper` an (eigene Python-Umgebung, Chromium, Zertifikat, Einstellungen), trägt das Zertifikat in deinen Schlüsselbund ein (macOS fragt nach deinem Passwort) und lässt den Helfer bei jeder Anmeldung von selbst starten. Am Ende stehen Adresse und Token da. Braucht Python 3.10 oder neuer; mit pyenv etwa `pyenv install 3.13`.
2. Fragt macOS, ob Python eingehende Verbindungen annehmen darf: **Erlauben** (sonst erreicht ihn das iPhone nicht).
3. In Toollib auf dem Mac: **Einstellungen › Recherche › Mac-Helfer**, Adresse `https://localhost:8413` und den Token eintragen, **Verbindung testen**. Steht dort „Mac-Helfer erreichbar“, ist er fertig. Den Token zeigt `~/.toollib-helper/venv/bin/python ~/.toollib-helper/helper.py info` jederzeit wieder.
4. Chrome fragt beim ersten Mal vielleicht, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf: **Zulassen**.

### iPhone zu Hause (wahlweise)

1. Im Finder `~/.toollib-helper/toollib-helper-ca.cer` per AirDrop aufs iPhone schicken (Rechtsklick › Teilen › AirDrop).
2. Auf dem iPhone: **Einstellungen › Profil geladen › Installieren**, dann **Einstellungen › Allgemein › Info › Zertifikatsvertrauenseinstellungen** und „Toollib Helper CA“ einschalten.
3. In Toollib auf dem iPhone als Adresse eine der Zeilen „Vom iPhone zu Hause“ aus `helper.py info` eintragen, meist `https://<name-des-macs>.local:8413`, dazu denselben Token.

Das Zertifikat taugt nur für Namen und Adressen in deinem Heimnetz (`localhost`, `*.local`, `*.fritz.box`, private Adressen); für fremde Websites kann es nichts bestätigen, selbst wenn jemand die Datei hätte.

## Befehle

Alle mit `~/.toollib-helper/venv/bin/python ~/.toollib-helper/helper.py <befehl>`:

| Befehl | Was er tut |
| --- | --- |
| `info` | Adressen, Token, Ordner, ob er von selbst startet |
| `autostart on` / `off` | bei der Anmeldung starten (launchd) bzw. anhalten und nicht mehr starten |
| `run` | im Vordergrund laufen lassen (zum Ausprobieren; vorher `autostart off`) |
| `trust` | Zertifikat erneut in den Schlüsselbund eintragen |
| `renew` | neues Serverzertifikat (macht er bei neuer Adresse im Heimnetz von selbst); `renew --ca` auch eine neue Zertifizierungsstelle |
| `token --new` | neuer Token (dann auf jedem Gerät neu eintragen) |

Aktualisieren: `bash install.sh` erneut; Token, Zertifikat und Einstellungen bleiben. Entfernen: `helper.py autostart off`, dann den Ordner `~/.toollib-helper` löschen und in der Schlüsselbundverwaltung „Toollib Helper CA“ löschen. Der PDF-Ordner bleibt.

## Einstellungen (`~/.toollib-helper/config.json`)

| Eintrag | Bedeutung |
| --- | --- |
| `port` | 8413 |
| `bind` | `0.0.0.0`: auch das iPhone im Heimnetz; `127.0.0.1`: nur dieser Mac |
| `token` | dein Token; Toollib schickt ihn im Kopf `X-Toollib-Token` |
| `pdf_dir`, `inbox`, `own` | `~/Toollib-PDFs`, `Eingang`, `Eigene` |
| `allowed_origins` | Seiten, die fragen dürfen: `https://mahlnycdir.github.io` |
| `names` | weitere Namen für das Zertifikat, etwa `"mac.fritz.box"` |
| `max_bytes` | größte Antwort, 100 MB |
| `render_timeout` | Sekunden, die eine Seite mit JavaScript zum Laden hat (30) |

Nach einer Änderung: `helper.py autostart on` (startet ihn neu).

## Was er kann

| Anfrage | Antwort |
| --- | --- |
| `GET /ping` | Version, ob Chromium da ist, wie viele PDFs im Eingang liegen |
| `GET /fetch?url=<Adresse>` | die Antwort der Adresse wie beim Worker (`X-Final-URL`); mit `&keep=1` bleibt ein PDF im Ordner (`X-Saved-As`) |
| `GET /render?url=<Adresse>` | die Seite, wie Chromium sie nach ihren Skripten zeigt |
| `GET /files` | die PDFs im Eingang |
| `GET /file?path=<Pfad>` | ein PDF aus dem Ordner (mit `&sha1=` auch nach dem Verschieben) |
| `POST /files/imported` | legt ein eingelesenes PDF von `Eingang/` nach `Eigene/` |

Regeln wie beim Worker: nur deine Seiten mit deinem Token, nur http und https, keine Adressen im Heimnetz (auch nicht über Weiterleitungen oder DNS), keine Cookies, höchstens 100 MB. Bilder, Videos und Schriften lädt Chromium nicht. Das Protokoll steht in `~/.toollib-helper/helper.log` (nur Website, Status, Dauer).
