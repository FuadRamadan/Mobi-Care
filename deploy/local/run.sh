#!/bin/bash
# Run all of MobiCare locally, with demo data, so every interface can be used.
#
#   bash deploy/local/run.sh
#
# Then open http://localhost:8080 — the public site, patient app, HQ dashboard
# and pharmacy portal are all served from there. Sign-in details are printed at
# the end.
#
# Needs: Node 22+, pnpm, and PostgreSQL (the `postgres` and `initdb` binaries).
# It starts its own PostgreSQL on a spare port and its own object storage, so
# nothing you already have running is touched.
#
# Options:
#   --fresh       Delete the local database and stored files and start over
#   --no-build    Skip rebuilding (faster when only restarting)
#   --port N      Serve on N instead of 8080
#
# Everything it creates lives in .local/ and is git-ignored. Development only:
# the demo passwords are known, and the object storage does not verify
# signatures. Do not expose any of it.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$REPO/.local"
PGDATA="$STATE/postgres"
STORAGE="$STATE/storage"
LOGS="$STATE/logs"

PORT=8080
PGPORT=55500
STORAGE_PORT=9000
DB_NAME=mobicare
fresh=false
build=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fresh) fresh=true; shift ;;
    --no-build) build=false; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

cd "$REPO"

# ── Ports ────────────────────────────────────────────────────────────────────

# A port already in use is the most common way a rerun fails, and it fails
# confusingly: a background service exits and everything else looks fine.
port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -lnt 2>/dev/null | grep -q ":$1 "
  else
    ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 1 || { exec 3<&-; return 0; }
  fi
}

check_port() {
  if port_in_use "$1"; then
    echo "Port $1 is already in use ($2)." >&2
    echo "Another copy of this script may still be running. Stop it, or pick" >&2
    echo "another port with --port. To find the process:  lsof -i :$1" >&2
    exit 1
  fi
}

# ── Prerequisites ────────────────────────────────────────────────────────────

missing=()
command -v node >/dev/null || missing+=("node")
command -v pnpm >/dev/null || missing+=("pnpm")

# initdb and postgres are often not on PATH even when PostgreSQL is installed.
PG_BIN=""
for candidate in "$(command -v initdb 2>/dev/null || true)" /usr/lib/postgresql/*/bin/initdb /opt/homebrew/opt/postgresql@*/bin/initdb /usr/local/opt/postgresql@*/bin/initdb; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    PG_BIN="$(dirname "$candidate")"
    break
  fi
done
[[ -n "$PG_BIN" ]] || missing+=("postgresql (initdb)")

if (( ${#missing[@]} > 0 )); then
  echo "Missing: ${missing[*]}" >&2
  echo >&2
  echo "  macOS:  brew install node pnpm postgresql@16" >&2
  echo "  Ubuntu: sudo apt install nodejs postgresql && npm i -g pnpm" >&2
  exit 1
fi

if $fresh; then
  echo "==> Removing previous local state"
  [[ -f "$PGDATA/postmaster.pid" ]] && "$PG_BIN/pg_ctl" -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true  # best effort
  rm -rf "$STATE"
fi

mkdir -p "$STATE" "$STORAGE" "$LOGS"

# ── Shut everything down together ────────────────────────────────────────────

pids=()
cleanup() {
  echo
  echo "==> Stopping"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  [[ -d "$PGDATA" ]] && "${PG_RUNNER[@]:-}" "$PG_BIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
  echo "    Stopped. Data kept in .local/ — rerun to pick up where you left off."
}
trap cleanup EXIT INT TERM

# ── PostgreSQL ───────────────────────────────────────────────────────────────

# PostgreSQL refuses to run as root. In a container that is the common case, so
# fall back to the unprivileged postgres user rather than failing outright.
PG_RUNNER=()
if [[ "$(id -u)" -eq 0 ]]; then
  if id postgres >/dev/null 2>&1; then
    PG_RUNNER=(runuser -u postgres --)
    mkdir -p "$PGDATA"
    chown -R postgres:postgres "$PGDATA" "$LOGS"
    chmod 700 "$PGDATA"
  else
    echo "Running as root, and PostgreSQL will not start as root." >&2
    echo "Either run this as a normal user, or create a 'postgres' user." >&2
    exit 1
  fi
fi

pg() { "${PG_RUNNER[@]}" "$PG_BIN/$@"; }

if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
  echo "==> Creating a local PostgreSQL database"
  if ! pg initdb -D "$PGDATA" -U postgres --auth=trust > "$LOGS/initdb.log" 2>&1; then
    echo "initdb failed:" >&2
    tail -20 "$LOGS/initdb.log" >&2
    exit 1
  fi
fi

if ! pg pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  echo "==> Starting PostgreSQL on port $PGPORT"
  if ! pg pg_ctl -D "$PGDATA" \
    -o "-p $PGPORT -c listen_addresses=127.0.0.1" \
    -l "$LOGS/postgres.log" start >/dev/null; then
    echo "PostgreSQL failed to start:" >&2
    tail -20 "$LOGS/postgres.log" >&2
    exit 1
  fi
fi

DATABASE_URL="postgresql://postgres@127.0.0.1:$PGPORT/$DB_NAME"

# Wait for it to accept connections rather than guessing at a sleep duration.
for _ in $(seq 1 30); do
  "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1 && break
  sleep 0.5
done

"$PG_BIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || "$PG_BIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -qc "CREATE DATABASE $DB_NAME"

# ── Object storage ───────────────────────────────────────────────────────────

check_port "$STORAGE_PORT" "object storage"
echo "==> Starting object storage on port $STORAGE_PORT"
node deploy/local/dev-storage.mjs --port "$STORAGE_PORT" --dir "$STORAGE" \
  > "$LOGS/storage.log" 2>&1 &
pids+=($!)

storage_ready=false
for _ in $(seq 1 30); do
  if curl -fsS -m 2 "http://127.0.0.1:$STORAGE_PORT/__health" >/dev/null 2>&1; then
    storage_ready=true
    break
  fi
  sleep 0.5
done
if ! $storage_ready; then
  echo "Object storage did not start:" >&2
  tail -20 "$LOGS/storage.log" >&2
  exit 1
fi

export S3_ENDPOINT="http://127.0.0.1:$STORAGE_PORT"
export S3_REGION=local
export S3_BUCKET=mobicare-media
export S3_ACCESS_KEY_ID=localdev
export S3_SECRET_ACCESS_KEY=localdevsecretlocaldevsecret1234
export S3_FORCE_PATH_STYLE=true

# ── Schema and demo data ─────────────────────────────────────────────────────

if ! "$PG_BIN/psql" "$DATABASE_URL" -tAc \
  "SELECT to_regclass('public.schema_migrations') IS NOT NULL" | grep -q t; then
  echo "==> Creating the schema"
  DATABASE_URL="$DATABASE_URL" node lib/db/scripts/migrate-tracked.mjs --init >/dev/null
else
  echo "==> Applying any new migrations"
  DATABASE_URL="$DATABASE_URL" node lib/db/scripts/migrate-tracked.mjs >/dev/null
fi

# ── Build ────────────────────────────────────────────────────────────────────

# The routes must point at the S3 adapter: the Replit one talks to a sidecar
# that does not exist here, so photos would fail.
if grep -rq 'from "\.\./lib/objectStorage\.js"' artifacts/api-server/src/routes; then
  echo "==> Selecting the S3 storage adapter"
  bash deploy/godaddy/switch-object-storage.sh >/dev/null
fi

if $build; then
  echo "==> Installing dependencies"
  pnpm install --frozen-lockfile >/dev/null

  echo "==> Building (this takes a minute the first time)"
  pnpm --filter @workspace/api-server run build >/dev/null 2>&1
  PORT=$PORT BASE_PATH=/ pnpm --filter @workspace/mobicare-gateway run build >/dev/null 2>&1
  PORT=$PORT BASE_PATH=/pharmacy-portal/ pnpm --filter @workspace/pharmacy-portal run build >/dev/null 2>&1

  rm -rf "$STATE/public"
  mkdir -p "$STATE/public"
  cp -r artifacts/mobicare-gateway/dist/public "$STATE/public/gateway"
  cp -r artifacts/pharmacy-portal/dist/public "$STATE/public/pharmacy-portal"
fi

echo "==> Seeding demo data"
# pnpm --filter exec runs from the package directory, so pass absolute paths.
pnpm --filter @workspace/api-server exec esbuild "$REPO/deploy/local/seed.ts" \
  --bundle --platform=node --format=cjs --external:pg-native \
  --outfile="$STATE/seed.cjs" --log-level=warning >/dev/null 2>&1
DATABASE_URL="$DATABASE_URL" node "$STATE/seed.cjs"

# ── API ──────────────────────────────────────────────────────────────────────

check_port "$PORT" "MobiCare"
echo "==> Starting MobiCare on port $PORT"
NODE_ENV=development \
PORT="$PORT" \
LOG_LEVEL=info \
SMS_TRANSPORT=test \
DATABASE_URL="$DATABASE_URL" \
JWT_SECRET=local-development-jwt-secret-not-for-any-real-use-0001 \
SESSION_SECRET=local-development-session-secret-not-for-any-real-use-02 \
ALLOWED_ORIGINS="http://localhost:$PORT" \
SERVE_STATIC_DIR="$STATE/public" \
TRUST_PROXY_HOPS=0 \
  node artifacts/api-server/dist/index.mjs > "$LOGS/api.log" 2>&1 &
pids+=($!)

# Wait for health rather than assuming it came up.
ready=false
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 0.5
done

if ! $ready; then
  echo
  echo "The API did not start. Last lines of .local/logs/api.log:" >&2
  tail -20 "$LOGS/api.log" >&2
  exit 1
fi

cat <<BANNER

  MobiCare is running at http://localhost:$PORT

    Public site       http://localhost:$PORT/
    Patient app       http://localhost:$PORT/app
    HQ dashboard      http://localhost:$PORT/hq
    Pharmacy portal   http://localhost:$PORT/pharmacy-portal/

  Logs in .local/logs/. Text messages are not sent — codes are written to
  .local/logs/api.log instead.

  Press Ctrl-C to stop.

BANNER

# Wait on the API — the last thing started, and the one whose exit should end
# the session. Waiting on an earlier service meant a storage crash shut
# everything down with no explanation.
wait "${pids[-1]}"
