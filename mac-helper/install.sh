#!/bin/bash
# Installs or updates the Toollib Mac helper: a Python environment in ~/.toollib-helper, Chromium for pages with
# JavaScript, a certificate of its own (trusted in your keychain), and a start at every login (launchd).
#   cd ~/ToolLib/mac-helper && bash install.sh
# Running it again updates the helper and keeps token, certificate and settings.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DEST="${TOOLLIB_HELPER_HOME:-$HOME/.toollib-helper}"

PY=""
for c in python3.14 python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10 oder neuer fehlt. Mit pyenv: pyenv install 3.13 && pyenv global 3.13, dann bash install.sh erneut."
  exit 1
fi
echo "› Python: $(command -v "$PY") ($("$PY" -V 2>&1))"

mkdir -p "$DEST"
chmod 700 "$DEST"
if [ ! -x "$DEST/venv/bin/python" ]; then
  echo "› Eigene Python-Umgebung in $DEST/venv"
  "$PY" -m venv "$DEST/venv"
fi
echo "› Pakete (aiohttp, cryptography, playwright)"
"$DEST/venv/bin/python" -m pip install -q --upgrade pip
"$DEST/venv/bin/python" -m pip install -q -r "$HERE/requirements.txt"
echo "› Chromium für Seiten mit JavaScript (einmal etwa 100 MB)"
"$DEST/venv/bin/python" -m playwright install --only-shell chromium

cp "$HERE/helper.py" "$DEST/helper.py"
export TOOLLIB_HELPER_HOME="$DEST"
"$DEST/venv/bin/python" "$DEST/helper.py" setup
if ! security verify-cert -q -p ssl -s localhost -c "$DEST/certs/server.pem" >/dev/null 2>&1; then
  "$DEST/venv/bin/python" "$DEST/helper.py" trust
fi
"$DEST/venv/bin/python" "$DEST/helper.py" autostart on
sleep 2
if curl -s --max-time 5 --cacert "$DEST/certs/ca.pem" -o /dev/null "https://localhost:$("$DEST/venv/bin/python" -c "import json;print(json.load(open('$DEST/config.json')).get('port', 8413))")/ping"; then
  echo "› Der Helfer antwortet. Trag Adresse und Token in Toollib unter Einstellungen › Recherche › Mac-Helfer ein."
else
  echo "› Der Helfer antwortet noch nicht. Protokoll: $DEST/helper.log"
fi
