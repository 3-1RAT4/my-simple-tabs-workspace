#!/usr/bin/env bash
# Captures the browser environment. Run this before theorising about any
# "it doesn't work" report: several dead ends have turned out to be the flatpak
# sandbox, userChrome.css, or a pref reapplied by user.js at startup.
set -uo pipefail

PROFILE_GLOB="$HOME/.var/app/io.gitlab.librewolf-community/config/librewolf/librewolf/*.default*"

echo "=== flatpak sandbox permissions ==="
for meta in /var/lib/flatpak/app/io.gitlab.librewolf-community/current/active/metadata \
            "$HOME/.local/share/flatpak/app/io.gitlab.librewolf-community/current/active/metadata"; do
  [ -f "$meta" ] && sed -n '/\[Context\]/,/^\[/p' "$meta"
done
echo "--- user overrides ---"
cat "$HOME/.local/share/flatpak/overrides/io.gitlab.librewolf-community" 2>/dev/null || echo "(none)"

echo
echo "=== user.js ==="
for p in $PROFILE_GLOB; do
  echo "--- $p/user.js"
  cat "$p/user.js" 2>/dev/null || echo "(none)"
done

echo
echo "=== userChrome.css / userContent.css ==="
for p in $PROFILE_GLOB; do
  for f in chrome/userChrome.css chrome/userContent.css; do
    [ -f "$p/$f" ] && { echo "--- $p/$f"; cat "$p/$f"; }
  done
done

echo
echo "=== installed extensions (id + version) ==="
for p in $PROFILE_GLOB; do
  python3 - "$p/extensions.json" <<'PY' 2>/dev/null || echo "(cannot read extensions.json)"
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception as err:
    print(f"({err})")
    sys.exit()
for addon in data.get("addons", []):
    if addon.get("location") in ("app-system-defaults", "app-builtin", "app-builtin-addons"):
        continue
    print(f"  {addon.get('id')}  v{addon.get('version')}  active={addon.get('active')}")
PY
done

echo
echo "=== built artifacts in ~/Downloads ==="
ls -la "$HOME/Downloads"/*.xpi 2>/dev/null || echo "(none)"
