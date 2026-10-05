# Running MobiCare locally

One command starts the whole platform with demo data, so every interface can be
opened and used — public site, patient app, HQ dashboard and pharmacy portal.

```bash
bash deploy/local/run.sh
```

Then open **http://localhost:8080**.

| | |
|---|---|
| Public site | http://localhost:8080/ |
| Patient app | http://localhost:8080/app |
| HQ dashboard | http://localhost:8080/hq |
| Pharmacy portal | http://localhost:8080/pharmacy-portal/ |

Sign in with (printed again when the script finishes):

| Role | Sign in with | Password |
|---|---|---|
| HQ | `hqadmin` | `HqAdmin#2026` |
| Pharmacy | `citypharmacy` | `Pharmacy#2026` |
| Patient | `+23276000001` | `Patient#2026` |

Press Ctrl-C to stop. Data is kept, so the next run picks up where you left off.

## What you need installed

Node 22+, pnpm, and PostgreSQL.

```bash
# macOS
brew install node pnpm postgresql@16

# Ubuntu / Debian
sudo apt install nodejs postgresql && npm install -g pnpm
```

PostgreSQL only needs to be *installed* — the script starts its own instance on
port 55500 with its own data directory, so anything you already have running is
untouched.

## What the script does

1. Starts a private PostgreSQL on port 55500
2. Starts a local object storage server on port 9000 so photos work
3. Creates the schema with the tracked migration runner
4. Points the routes at the S3 storage adapter
5. Builds the API and both frontends
6. Seeds an HQ account, a pharmacy, a patient, six medicines across all three
   tiers, and stock for each
7. Serves everything from one port

Everything it creates lives in `.local/`, which is git-ignored. `--fresh`
deletes it and starts over; `--no-build` skips the rebuild when restarting;
`--port N` serves somewhere other than 8080.

## Online payments (Monime) locally

`--monime` switches on Monime payments against a **fake Monime**
(`fake-monime.mjs`, port 9100). It answers the parts of Monime's API that
MobiCare uses: payment links, payments, and a test payment page where you
"pay" with a test Orange Money or AfriMoney wallet or cancel. It sends the
webhooks back to the local site. No real money and no Monime account are
involved, and it is never deployed.

```bash
bash deploy/local/run.sh --monime
```

Then add a medicine to the cart and tap **Place order and pay**. Test helpers:
`POST http://localhost:9100/__admin/expire/<link id>` expires a payment link,
`POST http://localhost:9100/__admin/fail-next?count=N` makes Monime answer 503
N times, and `GET http://localhost:9100/__admin/state` shows everything it holds.

Paid orders show up on the pharmacy portal's Overview (**Paid online through
MobiCare**, at the pharmacy's own prices) and on HQ's **Online Payments** page
(fees, commission, delivery, Monime fees, money held and refunds to pay).

When an online-paid order is delivered or collected, its money moves from
Holding to the pharmacy's own account and to MobiCare Revenue. The pharmacy
cashes out from **Payouts** in the portal; HQ approves cash-outs above
Le 2,000 under **Online Payments → Payouts**. The fake keeps real balances
(saved in `.local/fake-monime-state.json`, so they survive a restart), and a
transfer or payout the source can't cover fails just as Monime's would.
More helpers: `POST /__admin/fail-payout?code=provider_account_missing` and
`POST /__admin/fail-transfer?code=fund_insufficient` make the next one fail;
`POST /__admin/credit?account=fac-holding-local&value=5000` tops up an account.

## Photos work

Prescriptions, profile photos, courier and team photos and advertisements all
function locally. `dev-storage.mjs` is a small S3-compatible server that keeps
objects on disk under `.local/storage/`, so they survive a restart.

The application talks to it through exactly the same adapter, signing and
presigned uploads it uses with S3, R2 or B2 in production. Nothing dev-only is
compiled into the app, so what works here is what will work when deployed.

Verified end to end: a prescription uploads and lands in object storage with the
`cloud:` key prefix, and a profile photo uploads and is served back through the
API's signed-URL route as a valid PNG.

## Things worth knowing

- **Text messages are not sent.** `SMS_TRANSPORT=test`, so verification codes
  are written to `.local/logs/api.log` instead. Search that file when a flow
  asks for a code.
- **Payment is not real.** Marking an order paid does not contact Orange Money —
  the order simply moves to `paid`. This is the known gap recorded in
  `Final Deployment files/`.
- **Searching needs a term.** `q=para` finds Paracetamol; an empty search
  returns nothing rather than the whole catalogue.
- **Pharmacies cannot self-register.** That is by design: HQ issues credentials.
  The seeded pharmacy exists so the portal is usable immediately.
- Logs are in `.local/logs/` — `api.log`, `postgres.log`, `storage.log`.

## Development only

The demo passwords are in this repository, and the object storage server does
not verify signatures — it is bound to localhost and exists to make development
easy. Do not expose any of it, and do not point the seed script at a database
anyone else can reach.

## If something goes wrong

- **"Port 8080 is already in use"** — a previous run is still going. Stop it, or
  use `--port 8081`. `lsof -i :8080` finds the process.
- **"Running as root, and PostgreSQL will not start as root"** — run as a normal
  user. In a container, the script uses the `postgres` user automatically if one
  exists.
- **The API did not start** — the last lines of `.local/logs/api.log` are printed
  automatically; they usually name the problem outright.
- **Anything stale** — `bash deploy/local/run.sh --fresh` starts clean.

## Running on the production database driver

MobiCare deploys onto a host that allows outbound traffic on ports 80 and 443
only, so in production the database connection goes through a WebSocket rather
than the ordinary PostgreSQL port. That is a different driver, and it is worth
being able to run the whole application on it before deploying.

`ws-proxy.mjs` stands in for Neon's WebSocket endpoint: it accepts a WebSocket
and pipes it to a local TCP port. With `deploy/local/run.sh` already running:

```bash
# Build the helpers once.
pnpm --filter @workspace/api-server exec esbuild deploy/local/ws-proxy.mjs \
  --bundle --platform=node --format=cjs --outfile=.local/ws-proxy.cjs
pnpm --filter @workspace/api-server exec esbuild deploy/local/verify-neon-driver.ts \
  --bundle --platform=node --format=cjs --external:pg-native \
  --outfile=.local/verify-neon-driver.cjs

node .local/ws-proxy.cjs --port 5433 --allow 127.0.0.1:55500 &

# Six checks: the driver choice, a query, the schema, enum and numeric
# decoding, and a transaction committing and rolling back.
DATABASE_URL=postgresql://postgres@127.0.0.1:55500/mobicare \
  node .local/verify-neon-driver.cjs
```

To run the API itself on it, add these to the API's environment:

```
DATABASE_DRIVER=neon
NEON_WS_PROXY=127.0.0.1:5433
```

`NEON_WS_PROXY` is ignored when `NODE_ENV=production` — it also turns off
transport hardening that only makes sense against a local proxy, and that is not
something an environment variable should be able to do to a live deployment.

Development only. The proxy has no authentication; never run it anywhere
reachable.
