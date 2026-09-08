#!/bin/bash
# Do everything on the repository side of a MobiCare deployment, in one go.
#
#   bash "Final Deployment files/scripts/prepare-deployment.sh"
#
# Written for someone doing this for the first time. It checks what it needs
# before it needs it, explains anything missing in plain words, and stops rather
# than half-finishing. Run it as many times as you like — every step is either
# read-only or safe to repeat.
#
# What it does, in order:
#
#   1. Checks Node, pnpm and the tools it needs
#   2. Installs the project's dependencies
#   3. Checks the database and brings its schema up to date
#   4. Generates the two secrets, if you do not already have them
#   5. Builds the release zip you upload to GoDaddy
#   6. Offers to create the first HQ administrator
#   7. Prints the exact environment variables to paste into GoDaddy
#
# What it deliberately does NOT do: anything inside your GoDaddy, Neon or
# storage accounts. Those need a person with a browser. This handles everything
# else.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

# ── Presentation ─────────────────────────────────────────────────────────────
# Colour only when a terminal is watching, so piping to a file stays readable.
if [[ -t 1 ]]; then
  B=$'\e[1m'; DIM=$'\e[2m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; X=$'\e[0m'
else
  B=""; DIM=""; R=""; G=""; Y=""; C=""; X=""
fi

step=0
say()   { printf '%s\n' "$*"; }
head2() { step=$((step + 1)); printf '\n%s──  Step %s of 7 — %s%s\n' "$B" "$step" "$*" "$X"; }
ok()    { printf '   %s✓%s %s\n' "$G" "$X" "$*"; }
info()  { printf '   %s•%s %s\n' "$C" "$X" "$*"; }
warn()  { printf '   %s!%s %s\n' "$Y" "$X" "$*"; }

# Every failure explains what is wrong and what to do about it, then stops.
die() {
  printf '\n%s✗ Stopped: %s%s\n\n' "$R" "$1" "$X"
  shift
  for line in "$@"; do printf '   %s\n' "$line"; done
  printf '\n   Nothing was changed. Fix the above and run this again.\n\n'
  exit 1
}

printf '\n%sMobiCare — preparing a deployment%s\n' "$B" "$X"
printf '%sEverything that happens on this machine. Nothing touches GoDaddy.%s\n' "$DIM" "$X"

# ── 1. Tools ─────────────────────────────────────────────────────────────────
head2 "Checking the tools on this machine"

command -v node >/dev/null || die "Node.js is not installed." \
  "MobiCare needs Node 22. Install it from https://nodejs.org and try again."

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  die "Node $(node --version) is too old." \
    "MobiCare needs Node 22 or newer." \
    "Install it from https://nodejs.org, close this terminal, open a new one."
fi
ok "Node $(node --version)"

command -v pnpm >/dev/null || die "pnpm is not installed." \
  "Install it with:  npm install -g pnpm" \
  "Then run this script again."
ok "pnpm $(pnpm --version)"

command -v zip >/dev/null || die "The 'zip' command is not available." \
  "macOS and most Linux systems have it already." \
  "On Debian or Ubuntu:  sudo apt install zip"
ok "zip"

[[ -f "package.json" && -d "artifacts/api-server" ]] || die \
  "This does not look like the MobiCare repository." \
  "Run the script from inside your clone of it, for example:" \
  "  cd ~/Mobi-Care" \
  "  bash \"Final Deployment files/scripts/prepare-deployment.sh\""
ok "MobiCare repository found at $REPO"

# ── 2. Dependencies ──────────────────────────────────────────────────────────
head2 "Installing the project's dependencies"

if [[ -d "node_modules" ]]; then
  info "Already installed — checking they are current"
else
  info "First run on this machine. This takes a few minutes."
fi

if ! pnpm install --frozen-lockfile > /tmp/mobicare-install.log 2>&1; then
  tail -20 /tmp/mobicare-install.log | sed 's/^/   /'
  die "Dependencies could not be installed." \
    "The last lines are above; the whole log is at /tmp/mobicare-install.log." \
    "" \
    "The usual causes:" \
    "  • No internet, or a network that blocks npm" \
    "  • An old pnpm — this needs pnpm 10. Update with: npm install -g pnpm"
fi
ok "Dependencies installed"

# ── 3. The database ──────────────────────────────────────────────────────────
head2 "Checking the database"

if [[ -z "${DATABASE_URL:-}" ]]; then
  die "DATABASE_URL is not set." \
    "This is the connection string for your Neon database. In the Neon" \
    "dashboard it is shown as a 'connection string' and looks like:" \
    "" \
    "  postgresql://user:password@ep-something.region.aws.neon.tech/dbname?sslmode=require" \
    "" \
    "Run this script with it in front, all on one line:" \
    "" \
    "  DATABASE_URL='postgresql://...' bash \"Final Deployment files/scripts/prepare-deployment.sh\"" \
    "" \
    "Keep the single quotes — the password often contains characters the" \
    "shell would otherwise treat as commands."
fi

case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) die "DATABASE_URL does not look like a PostgreSQL connection string." \
       "It should begin with postgresql:// — yours begins with '${DATABASE_URL%%:*}:'." \
       "Copy it again from the Neon dashboard." ;;
esac

# Reported without the password, so a shared screen or a pasted log stays safe.
db_host="$(node -e 'try{const u=new URL(process.env.DATABASE_URL);console.log(u.hostname)}catch{console.log("")}')"
[[ -n "$db_host" ]] || die "DATABASE_URL could not be read as a URL." \
  "Copy it again from the Neon dashboard, and keep it in single quotes."

info "Connecting to $db_host"
# NODE_NO_WARNINGS: an unrelated SSL deprecation notice otherwise buries the one
# line that says what actually went wrong.
if ! (cd lib/db && NODE_NO_WARNINGS=1 node -e '
const pg = require("pg");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.query("SELECT 1")).then(() => c.end()).then(
  () => process.exit(0),
  (e) => { console.error(e.message); process.exit(1); },
)') 2>/tmp/mobicare-db-error; then
  reason="$(grep -v '^$' /tmp/mobicare-db-error | tail -1)"

  # Translate the handful of errors that actually come up, because the raw
  # message names a system call rather than the thing to go and fix.
  case "$reason" in
    *ENOTFOUND*)
      hint=("The host name in the connection string does not exist." \
            "Check '$db_host' against the Neon dashboard — it is easy to lose" \
            "characters when copying, especially at the start.") ;;
    *ETIMEDOUT*|*ECONNREFUSED*)
      hint=("Nothing answered at that address." \
            "Either the database is asleep and needs a moment, or this network" \
            "blocks outgoing port 5432. Try from a phone hotspot to tell which.") ;;
    *"password authentication"*|*"SASL"*)
      hint=("The password was rejected." \
            "Copy the connection string again from Neon — it may have been" \
            "truncated, or the shell may have eaten a character. Use single quotes.") ;;
    *"does not exist"*)
      hint=("That database name does not exist on the server." \
            "Check the part after the last / in the connection string.") ;;
    *)
      hint=("The usual causes:" \
            "  • The connection string was copied incompletely" \
            "  • The password contains a character the shell ate — use single quotes" \
            "  • The database is still starting up — wait a minute and try again") ;;
  esac

  die "Could not connect to the database." \
    "The server said: $reason" \
    "" \
    "${hint[@]}"
fi
ok "Connected"

# ── Schema, still step 3 ─────────────────────────────────────────────────────
printf '   %s•%s Bringing the schema up to date\n' "$C" "$X"

has_tables="$(cd lib/db && node -e '
const pg = require("pg");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
c.connect()
 .then(() => c.query("SELECT to_regclass(\x27public.patients\x27) IS NOT NULL AS yes"))
 .then((r) => { console.log(r.rows[0].yes ? "yes" : "no"); return c.end(); })
 .catch(() => { console.log("unknown"); process.exit(0); })')"

if [[ "$has_tables" == "no" ]]; then
  info "Empty database — building the schema from scratch"
  node lib/db/scripts/migrate-tracked.mjs --init || die \
    "The schema could not be created." \
    "The output above says why. Send it to Martha if it is not obvious."
else
  info "Database already has tables — applying anything new"
  output="$(node lib/db/scripts/migrate-tracked.mjs 2>&1)"
  status=$?
  printf '%s\n' "$output" | sed 's/^/   /'
  if (( status != 0 )); then
    if grep -q "accept-baseline" <<<"$output"; then
      warn "Re-recording the baseline (routine — it executes nothing)"
      node lib/db/scripts/migrate-tracked.mjs --accept-baseline >/dev/null \
        || die "Could not re-record the baseline." "Send the output above to Martha."
      node lib/db/scripts/migrate-tracked.mjs || die \
        "Migrations failed after re-recording the baseline." \
        "Send the output above to Martha."
    else
      die "Migrations failed." "The output above says why."
    fi
  fi
fi
ok "Database schema is current"

# ── 4. Secrets ───────────────────────────────────────────────────────────────
head2 "Secrets"

generated_secrets=false
if [[ -n "${JWT_SECRET:-}" && -n "${SESSION_SECRET:-}" ]]; then
  ok "Using the JWT_SECRET and SESSION_SECRET you supplied"
  if [[ "$JWT_SECRET" == "$SESSION_SECRET" ]]; then
    die "JWT_SECRET and SESSION_SECRET are the same value." \
      "They must differ — the API refuses to start otherwise." \
      "Unset them both and let this script generate them instead."
  fi
else
  JWT_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  generated_secrets=true
  ok "Generated two new secrets — printed at the end, once"
  info "SESSION_SECRET must never change after the first deploy; JWT_SECRET may"
fi

# ── 5. The release ───────────────────────────────────────────────────────────
head2 "Building the release you upload to GoDaddy"
info "A few minutes the first time — it installs, typechecks, tests and builds"

if ! DATABASE_URL="$DATABASE_URL" bash "$REPO/Final Deployment files/scripts/package-release.sh" > /tmp/mobicare-build.log 2>&1; then
  tail -25 /tmp/mobicare-build.log | sed 's/^/   /'
  die "The release did not build." \
    "The last lines of the build are above; the whole log is at" \
    "/tmp/mobicare-build.log. Send that file to Martha."
fi

zip_path="$REPO/Final Deployment files/build/mobicare-release.zip"
[[ -f "$zip_path" ]] || die "The build finished but produced no zip." \
  "Send /tmp/mobicare-build.log to Martha."
zip_mb=$(( $(wc -c < "$zip_path") / 1024 / 1024 ))
ok "Built: Final Deployment files/build/mobicare-release.zip (${zip_mb} MB)"

# ── 6. The first HQ administrator ────────────────────────────────────────────
head2 "The first HQ administrator"

hq_count="$(cd lib/db && node -e '
const pg = require("pg");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
c.connect()
 .then(() => c.query("SELECT count(*)::int AS n FROM hq_staff WHERE is_active"))
 .then((r) => { console.log(r.rows[0].n); return c.end(); })
 .catch(() => { console.log("0"); process.exit(0); })')"

if (( hq_count > 0 )); then
  ok "$hq_count active HQ account(s) already exist — nothing to do"
else
  warn "No HQ account exists yet. Without one, nobody can sign in to HQ,"
  warn "which means no pharmacy can be onboarded and the site sits empty."
  if [[ -t 0 ]]; then
    say ""
    read -r -p "   Create one now? [Y/n] " answer
    if [[ ! "$answer" =~ ^[Nn] ]]; then
      say ""
      ( cd artifacts/api-server && DATABASE_URL="$DATABASE_URL" pnpm run bootstrap-hq ) \
        || warn "That did not complete. Run it again on its own — see step 6 of 5-BUILD-AND-DEPLOY.md"
    else
      info "Skipped. Create it before anyone tries to use the site."
    fi
  else
    info "No terminal to ask on. Create it with:"
    info "  cd artifacts/api-server && DATABASE_URL='...' pnpm run bootstrap-hq"
  fi
fi

# ── 7. What to paste into GoDaddy ────────────────────────────────────────────
head2 "The environment variables to set on the GoDaddy app"

cat <<'NOTE'

   Copy each line below into the environment variables section of your
   GoDaddy Node.js app. Do NOT set PORT — the platform provides it.

   Five values are still yours to fill in: the object storage settings from
   your bucket, and your site's address.

NOTE

printf '%s' "$C"
cat <<ENV
NODE_ENV=production
DATABASE_DRIVER=neon
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
SESSION_SECRET=$SESSION_SECRET
ALLOWED_ORIGINS=https://YOUR-DOMAIN
SERVE_STATIC_DIR=./public
TRUST_PROXY_HOPS=1
SMS_TRANSPORT=orange
LOG_LEVEL=info
S3_ENDPOINT=https://YOUR-BUCKET-ENDPOINT
S3_REGION=YOUR-REGION
S3_BUCKET=YOUR-BUCKET-NAME
S3_ACCESS_KEY_ID=YOUR-KEY-ID
S3_SECRET_ACCESS_KEY=YOUR-SECRET-KEY
S3_FORCE_PATH_STYLE=true
ENV
printf '%s' "$X"

if $generated_secrets; then
  say ""
  warn "The two secrets above were generated just now and are shown ONCE."
  warn "Save them somewhere safe before closing this terminal."
  warn "Never commit them, and never paste them into a chat or an email."
fi

cat <<'NEXT'

   ─────────────────────────────────────────────────────────────────────
   Everything on this machine is done. Three things left, all in a browser:

     1. Upload  Final Deployment files/build/mobicare-release.zip
        to your GoDaddy Node.js app

     2. Paste the environment variables above into that app's settings

     3. Start it, then open  https://YOUR-DOMAIN/api/health
        You should see:  {"status":"ok"}

   If the site does not come up, the startup log says why in plain words.
   Send that log to Martha.
   ─────────────────────────────────────────────────────────────────────

NEXT
