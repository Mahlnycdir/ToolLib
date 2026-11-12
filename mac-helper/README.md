# Mac-Helfer für die Recherche

Der Mac-Helfer ist ein kleines Python-Programm auf deinem Mac. Toollib fragt ihn für alles, was der Browser und der Cloudflare-Worker nicht können:

- **Von zu Hause holen:** Seiten, PDFs und Schnittstellen über deine Adresse zu Hause. DOAB und manche Websites sperren Server, auch den Worker; über den Helfer antworten sie.
- **Seiten mit JavaScript:** Ein echtes Chromium (über Playwright) öffnet Seiten, die ihren Inhalt erst beim Laden bauen. Der Leser und das Durchgehen nehmen ihn von selbst, wenn eine Seite ohne Text ankommt.
- **PDF-Ordner:** Jedes PDF, das Toollib über den Helfer liest, bleibt als Original in `~/Toollib-PDFs/<website>/`. PDFs, die du selbst in `~/Toollib-PDFs/Eingang/` legst (Skripte, Bücher, Mitschriften), liest Toollib als Funde mit Text in die Mappe „PDF-Ordner“ ein; danach liegen sie in `~/Toollib-PDFs/Eigene/`. Im Wissen steht nur der Text, die Datei bleibt auf dem Mac.

- **Suche im Netz (Teil 2):** SearXNG läuft neben dem Helfer, nur auf diesem Mac (`127.0.0.1:8888`), ohne Konto und ohne Profil. In der Recherche steht unter den Paper-Treffern der Bereich „Im Netz“ (Lesen, Durchgehen, Merken); bei einem Werk ohne freie Fassung sucht „PDF im Netz suchen“ nach seinem Titel mit `filetype:pdf`.
- **Im Hintergrund (Teil 2):** Der Helfer öffnet Toollib ohne Fenster in einem eigenen Chromium. Es gleicht jede Minute ab und geht Websites durch, die du im Dialog „Website durchgehen“ mit **Auf dem Mac** startest, auch wenn Toollib überall sonst zu ist. Anhalten, Fortsetzen, Erneut, Mehr Seiten schickst du von jedem Gerät; der Mac folgt in ein, zwei Minuten (sofort, wenn das Gerät den Helfer erreicht).

Ist der Mac aus oder du unterwegs, nimmt Toollib wie bisher den Worker; ein Auftrag „auf dem Mac“ wartet dann, bis der Mac wieder läuft.

## Einrichten (etwa 5 Minuten)

1. Terminal öffnen und:
   ```bash
   cd ~/ToolLib/mac-helper && bash install.sh
   ```
   Das legt `~/.toollib-helper` an (eigene Python-Umgebung, Chromium, Zertifikat, Einstellungen), trägt das Zertifikat in deinen Schlüsselbund ein (macOS fragt nach deinem Passwort) und lässt den Helfer bei jeder Anmeldung von selbst starten. Am Ende stehen Adresse und Token da. Braucht Python 3.10 oder neuer; mit pyenv etwa `pyenv install 3.13`.
2. Fragt macOS, ob Python eingehende Verbindungen annehmen darf: **Erlauben** (sonst erreicht ihn das iPhone nicht).
3. In Toollib auf dem Mac: **Einstellungen › Recherche › Mac-Helfer**, Adresse `https://localhost:8413` und den Token eintragen, **Verbindung testen**. Steht dort „Mac-Helfer erreichbar“, ist er fertig. Den Token zeigt `~/.toollib-helper/venv/bin/python ~/.toollib-helper/helper.py info` jederzeit wieder.
4. Chrome fragt beim ersten Mal vielleicht, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf: **Zulassen**.

### Im Hintergrund einschalten (einmal)

1. In Toollib (Mac oder iPhone): **Einstellungen › Einstellungen sichern › Als verschlüsselte Datei sichern**, die Datei auf den Mac legen (etwa in Downloads).
2. Im Terminal:
   ```bash
   ~/.toollib-helper/venv/bin/python ~/.toollib-helper/helper.py background setup ~/Downloads/toollib-settings-….json
   ```
   Er fragt nach dem Passwort der Datei, entschlüsselt sie in seinem Chromium (derselbe Code wie „Einstellungen laden“ in Toollib), übernimmt alles außer Adresse und Token des Helfers (die zeigen auf diesen Mac), gleicht das Wissen zum ersten Mal ab und startet neu. Das Passwort und die Datei behält er nicht; deine Einstellungen liegen danach im Profil `~/.toollib-helper/browser` (nur für dich lesbar), wie in jedem Browser.
3. Fertig. `helper.py background status` zeigt, ob er an ist; `background off` schaltet ab, `background off --forget` löscht auch das Profil. Neuer Token im Sync oder neue Schlüssel: Datei neu sichern und `background setup` noch einmal.

Während eines Durchgangs hält er den Mac wach (`caffeinate`; zugeklappt ohne Netzteil schläft ein MacBook trotzdem). Den Stand sieht jedes Gerät in der Mappe („Durchgehen auf dem Mac“) nach seinem nächsten Sync.

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
| `token --new` | neuer Token (dann auf jedem Gerät neu eintragen; im Hintergrund nimmt er ihn von selbst) |
| `background setup <Datei>` | im Hintergrund arbeiten, mit deiner verschlüsselten Einstellungs-Datei (fragt nach dem Passwort) |
| `background off` / `status` | nicht mehr im Hintergrund (`--forget`: Profil löschen) / ob er an ist |
| `ink-setup` | das Modell für die Handschrift holen (macht `install.sh --handschrift`) |

Aktualisieren: `bash install.sh` erneut; Token, Zertifikat, Einstellungen und das Profil im Hintergrund bleiben. Ohne SearXNG: `bash install.sh --ohne-suche`. Entfernen: `helper.py autostart off`, dann den Ordner `~/.toollib-helper` löschen (mit SearXNG, Profil und Protokollen) und in der Schlüsselbundverwaltung „Toollib Helper CA“ löschen. Der PDF-Ordner bleibt.

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
| `background` | Toollib ohne Fenster an (setzt `background setup`) |
| `app_url` | woher er Toollib lädt: `https://mahlnycdir.github.io/ToolLib/` |
| `search_port` | Port von SearXNG, nur auf `127.0.0.1` (8888); dessen Einstellungen in `~/.toollib-helper/searxng-settings.yml` |

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
| `GET /search?q=<Wörter>` | die Suche im Netz über SearXNG: Titel, Adresse, Auszug, Suchmaschinen, Datum |
| `GET /background` | ob Toollib ohne Fenster läuft, abgeglichen hat, was es gerade durchgeht |
| `POST /background/wake` | gleich abgleichen und nach Aufträgen sehen (Toollib schickt das nach einem Auftrag) |
| `GET /ink/state` | ob er Handschrift lesen kann und ob der Leser gerade läuft |
| `POST /ink/latex` | `{ "images": [PNG als Base64, …] }` (höchstens 40 Zeilen): LaTeX pro Zeile |

Regeln wie beim Worker: nur deine Seiten mit deinem Token, nur http und https, keine Adressen im Heimnetz (auch nicht über Weiterleitungen oder DNS), keine Cookies, höchstens 100 MB. Bilder, Videos und Schriften lädt Chromium nicht. Das Protokoll steht in `~/.toollib-helper/helper.log` (nur Website, Status, Dauer), das von SearXNG in `searxng.log`.

Das Chromium im Hintergrund vertraut dem eigenen Zertifikat des Helfers nur über dessen öffentlichen Schlüssel (`--ignore-certificate-errors-spki-list`), allen anderen Websites wie jeder Browser. Es lädt nur Toollib; die Prüfung auf Zugriffe ins lokale Netz ist dort aus, damit Toollib den Helfer auf `localhost` erreicht.

## Handschrift lesen (Kladde, 0.21.0)

`bash install.sh --handschrift` richtet es einmal ein (etwa 120 MB): eine eigene Python-Umgebung `~/.toollib-helper/ink-venv` (numpy, onnxruntime, pillow, tokenizers aus `requirements-ink.txt`) und das Modell in `~/.toollib-helper/ink-model`.

- **Modell:** Texo (`alephpi/FormulaNet` auf Hugging Face, 20 Millionen Parameter, etwa 80 MB, AGPL-3.0). Es liest Formeln aus Bildern, auch handgeschriebene.
- **Fester Stand:** Der Helfer lädt einen festen Stand des Modells (`INK_REV` in `helper.py`) und prüft die Prüfsumme des Encoders.
- **Kaum bemerkbar:** Der Leser ist ein eigener Prozess. Er startet erst, wenn du in der Kladde „Handschrift lesen“ tippst, rechnet mit zwei Kernen und niedriger Priorität und endet nach fünf Minuten Ruhe. Danach belegt er keinen Speicher mehr. Der Helfer selbst bleibt so klein wie vorher.
- **Nur auf dem Mac:** Die Kladde schickt jede Zeile als kleines Schwarz-Weiß-Bild an den Helfer, sonst nirgendwohin.
- **Unterwegs:** „Vom Mac lesen lassen“ markiert die Notiz (`ink_read: "mac"`). Toollib im Hintergrund des Helfers liest sie beim nächsten Sync und schreibt das Ergebnis unter „## LaTeX (Kladde)“ in die Notiz.
- **Entfernen:** die Ordner `ink-venv` und `ink-model` löschen. Ohne sie antwortet `/ink/latex` mit `ink-not-installed`.

