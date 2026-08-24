#!/usr/bin/env bash
# Auto-reloading dev browser.
#
# Deliberately a vanilla Firefox tarball, not the LibreWolf flatpak: the flatpak
# sandbox can only read ~/Downloads, which breaks web-ext's profile handling and
# file watching. LibreWolf stays the final verification target, not the daily loop.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FF_DIR="$HOME/Downloads/firefox"
PROFILE="$HOME/Downloads/ff-dev-profile"

if [ ! -x "$FF_DIR/firefox" ]; then
  echo "Fetching Firefox to $FF_DIR (one time)..."
  mkdir -p "$HOME/Downloads"
  curl -L -o "$HOME/Downloads/firefox.tar.xz" \
    "https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=en-US"
  tar -xJf "$HOME/Downloads/firefox.tar.xz" -C "$HOME/Downloads"
  rm -f "$HOME/Downloads/firefox.tar.xz"
fi

mkdir -p "$PROFILE"

exec "$ROOT/node_modules/.bin/web-ext" run \
  --source-dir "$ROOT" \
  --firefox "$FF_DIR/firefox" \
  --firefox-profile "$PROFILE" \
  --keep-profile-changes \
  --pref browser.tabs.groups.enabled=true \
  --ignore-files "*.sh" "*.md" "test" "test/**" "tools" "tools/**" "package*.json" "node_modules/**" "web-ext-artifacts/**"
