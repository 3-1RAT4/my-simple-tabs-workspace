#!/usr/bin/env bash
# Signs the addon through addons.mozilla.org on the unlisted channel, so it
# installs with xpinstall.signatures.required left at its default (true).
#
# Needs AMO credentials from https://addons.mozilla.org/developers/addon/api/key/
# Pass them in the environment, do not commit them:
#
#   AMO_JWT_ISSUER=user:1234:567 AMO_JWT_SECRET=abcdef... ./sign.sh
set -euo pipefail

cd "$(dirname "$0")"
WEB_EXT="${WEB_EXT:-$(pwd)/node_modules/.bin/web-ext}"
OUT="$HOME/Downloads/my-simple-tabs-workspace-signed.xpi"

: "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER}"
: "${AMO_JWT_SECRET:?set AMO_JWT_SECRET}"

"$WEB_EXT" sign \
  --source-dir . \
  --artifacts-dir web-ext-artifacts \
  --ignore-files "*.sh" "*.md" "test" "test/**" "tools" "tools/**" "package*.json" "node_modules/**" "web-ext-artifacts/**" \
  --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"

cp "$(ls -t web-ext-artifacts/*.xpi | head -1)" "$OUT"

echo
echo "signed: $OUT"
echo "version: $(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
echo
echo "Install it: about:addons -> gear -> Install Add-on From File"
