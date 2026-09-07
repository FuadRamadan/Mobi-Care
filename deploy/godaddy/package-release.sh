#!/bin/bash
# Build MobiCare and assemble a single zip for GoDaddy Node.js Hosting.
#
#   bash deploy/godaddy/package-release.sh
#
# Produces deploy/godaddy/build/mobicare-release.zip containing the bundled API
# and both built frontends, ready to upload. node_modules is excluded — the
# platform installs from package.json, and the API bundle needs no dependencies
# at all, so that install is a no-op.
#
# Everything is served from one origin: the API at /api, the pharmacy portal at
# /pharmacy-portal, the gateway at the root. That is why VITE_API_URL is left
# unset — both frontends then call the API on the same origin, and there is no
# cross-origin request to configure.
#
# Options:
#   --skip-checks   Skip typecheck and tests. For iterating only; never for a
#                   release you intend to deploy.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$REPO/deploy/godaddy/build"
STAGE="$OUT/release"
ZIP="$OUT/mobicare-release.zip"

skip_checks=false
if [[ "${1:-}" == "--skip-checks" ]]; then
  skip_checks=true
elif [[ -n "${1:-}" ]]; then
  echo "Unknown option: $1" >&2
  exit 1
fi

cd "$REPO"

# ── Storage adapter ──────────────────────────────────────────────────────────
# The Replit adapter cannot work off Replit: it authenticates through a sidecar
# on 127.0.0.1:1106 that exists nowhere else. Packaging it would produce a build
# whose every image operation fails.
if grep -rq 'from "\.\./lib/objectStorage\.js"' artifacts/api-server/src/routes; then
  echo "ERROR: the routes still import the Replit storage adapter." >&2
  echo "       Run: bash deploy/godaddy/switch-object-storage.sh" >&2
  exit 1
fi

echo "==> Installing dependencies"
pnpm install --frozen-lockfile >/dev/null

if ! $skip_checks; then
  echo "==> Typecheck"
  pnpm run typecheck >/dev/null

  echo "==> Tests"
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "    DATABASE_URL is not set — skipping tests that need a database." >&2
    echo "    Set it to a staging database to run the full suite before releasing." >&2
  else
    pnpm --filter @workspace/api-server run test >/dev/null
  fi
fi

echo "==> Building API"
pnpm --filter @workspace/api-server run build >/dev/null

echo "==> Building gateway (served at /)"
PORT=8080 BASE_PATH=/ \
  pnpm --filter @workspace/mobicare-gateway run build >/dev/null

echo "==> Building pharmacy portal (served at /pharmacy-portal/)"
PORT=8080 BASE_PATH=/pharmacy-portal/ \
  pnpm --filter @workspace/pharmacy-portal run build >/dev/null

echo "==> Assembling release"
rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE/public"

cp -r artifacts/api-server/dist "$STAGE/dist"
# Source maps are useful in logs but roughly double the size; keep them unless
# the upload limit becomes a problem.
cp -r artifacts/mobicare-gateway/dist/public "$STAGE/public/gateway"
cp -r artifacts/pharmacy-portal/dist/public "$STAGE/public/pharmacy-portal"

# The bundle inlines every dependency, so the deployed package declares none.
# Verified by running the bundle from a directory with no node_modules present.
cat > "$STAGE/package.json" <<'JSON'
{
  "name": "mobicare",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22 <25"
  },
  "scripts": {
    "start": "node dist/index.mjs"
  }
}
JSON

cat > "$STAGE/README.txt" <<'TXT'
MobiCare release bundle.

  npm start          runs the API and serves both frontends

Required environment variables:

  NODE_ENV=production
  DATABASE_URL          PostgreSQL, reached over WebSocket on 443
  JWT_SECRET            openssl rand -hex 32
  SESSION_SECRET        openssl rand -hex 32 (a different value)
  ALLOWED_ORIGINS       the public HTTPS origin, e.g. https://mobicare.sl
  SMS_TRANSPORT=orange
  SERVE_STATIC_DIR=./public
  TRUST_PROXY_HOPS=1

  S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
                        private object storage for prescriptions and photos

PORT is supplied by the platform.

The database schema must be current before this starts; the API checks on
startup and exits if it is behind. See deploy/godaddy/DEPLOY.md.
TXT

echo "==> Zipping"
( cd "$STAGE" && zip -rq "$ZIP" . )

size_bytes=$(wc -c < "$ZIP")
size_mb=$(( size_bytes / 1024 / 1024 ))
echo
echo "    $ZIP"
echo "    ${size_mb} MB ($(printf "%'d" "$size_bytes") bytes)"

if (( size_bytes > 100 * 1024 * 1024 )); then
  echo
  echo "WARNING: over GoDaddy's 100 MB upload limit." >&2
  echo "         Removing dist/*.map would cut this roughly in half." >&2
  exit 1
fi

echo
echo "    Contents:"
echo "      dist/                 bundled API (no dependencies to install)"
echo "      public/gateway/       public site, patient app, HQ dashboard"
echo "      public/pharmacy-portal/  pharmacy portal"
echo
echo "    Next: deploy/godaddy/DEPLOY.md"
