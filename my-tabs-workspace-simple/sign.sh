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
WEB_EXT="${WEB_EXT:-/var/home/rodz/Projects/sidebery/node_modules/.bin/web-ext}"
OUT="$HOME/Downloads/simple-tab-workspaces-signed.xpi"

: "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER}"
: "${AMO_JWT_SECRET:?set AMO_JWT_SECRET}"

"$WEB_EXT" sign \
  --source-dir . \
  --artifacts-dir web-ext-artifacts \
  --ignore-files "*.sh" "README.md" \
  --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"

cp "$(ls -t web-ext-artifacts/*.xpi | head -1)" "$OUT"
echo "signed: $OUT"
