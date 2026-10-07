#!/bin/bash
# Print fresh values for MobiCare's two server secrets.
#
#   bash "Final Deployment files/scripts/generate-secrets.sh"
#
# Copy each line into the host's secret manager (never into a file in git, and
# never into chat or email). The values are printed once and stored nowhere.
# See 4-SECRETS.md for when to change each one and what that does.

set -euo pipefail

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))'
  fi
}

jwt="$(random_hex)"
session="$(random_hex)"

echo "JWT_SECRET=$jwt"
echo "SESSION_SECRET=$session"
echo
echo "Changing JWT_SECRET signs everyone out once; nothing is lost."
echo "Changing SESSION_SECRET: also set the old value as SESSION_SECRET_PREVIOUS"
echo "for one restart, so stored provider credentials move to the new key."
