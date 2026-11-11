#!/bin/bash
# Installs or updates the Toollib Mac helper: a Python environment in ~/.toollib-helper, Chromium for pages with
# JavaScript, SearXNG for the search on the web (from source, only on this Mac), a certificate of its own (trusted in
# your keychain), and a start at every login (launchd).
#   cd ~/ToolLib/mac-helper && bash install.sh              (bash install.sh --ohne-suche: without SearXNG)
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

# SearXNG: a fixed state of its source, its own Python environment; only fetched again when the state changes
SX_REPO=https://github.com/searxng/searxng.git
SX_SHA=c360868e5b7c01e463a362a53518190d5a3b1097
searxng() {
  local new=""
  if [ "$(git -C "$DEST/searxng" rev-parse HEAD 2>/dev/null || true)" != "$SX_SHA" ]; then
    mkdir -p "$DEST/searxng" && git -C "$DEST/searxng" init -q && git -C "$DEST/searxng" fetch -q --depth 1 "$SX_REPO" "$SX_SHA" \
      && git -C "$DEST/searxng" checkout -q --detach FETCH_HEAD || return 1
    new=1
  fi
  if [ ! -x "$DEST/searxng-venv/bin/python" ]; then "$PY" -m venv "$DEST/searxng-venv" || return 1; new=1; fi
  if [ -n "$new" ] || ! "$DEST/searxng-venv/bin/python" -c 'import searx' 2>/dev/null; then
    "$DEST/searxng-venv/bin/python" -m pip install -q --upgrade pip setuptools wheel pyyaml msgspec typing_extensions \
      && "$DEST/searxng-venv/bin/python" -m pip install -q -r "$DEST/searxng/requirements.txt" \
      && "$DEST/searxng-venv/bin/python" -m pip install -q --use-pep517 --no-build-isolation -e "$DEST/searxng" || return 1
  fi
}
if [ "${1:-}" = "--ohne-suche" ]; then
  echo "› Ohne SearXNG (keine Suche im Netz)"
else
  echo "› SearXNG für die Suche im Netz (nur auf diesem Mac; einmal ein paar Minuten)"
  if ! command -v git >/dev/null 2>&1 || ! searxng; then
    echo "  SearXNG ließ sich nicht einrichten; der Helfer läuft ohne Suche im Netz. Später: bash install.sh erneut."
  fi
fi

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
