#!/usr/bin/env bash
# Builds the addon and drops an .xpi in ~/Downloads, which is the only
# directory the LibreWolf flatpak sandbox can read.
set -euo pipefail

cd "$(dirname "$0")"

# --bump raises the patch version, so an installed build is never ambiguous.
if [ "${1:-}" = "--bump" ]; then
  python3 - <<'PYEOF'
import json, collections, io
m = json.load(open('manifest.json'), object_pairs_hook=collections.OrderedDict)
major, minor, patch = (int(x) for x in m['version'].split('.'))
m['version'] = f"{major}.{minor}.{patch + 1}"
io.open('manifest.json', 'w').write(json.dumps(m, indent=2) + '\n')
print(f"version -> {m['version']}")
PYEOF
fi
WEB_EXT="${WEB_EXT:-$(pwd)/node_modules/.bin/web-ext}"
OUT="$HOME/Downloads/my-simple-tabs-workspace.xpi"

"$WEB_EXT" build --source-dir . --artifacts-dir web-ext-artifacts --overwrite-dest --ignore-files "*.sh" "*.md" "test" "test/**" "tools" "tools/**" "package*.json" "node_modules/**" "web-ext-artifacts/**" >/dev/null
cp "$(ls -t web-ext-artifacts/*.zip | head -1)" "$OUT"

echo "built: $OUT"
