# Monime payments — setup, step by step

How MobiCare's Monime account is set up, first in **test mode** (pretend
money) and then **live**. Work through the stages in order; each one is
finished before the next starts.

**Never** paste an access token into chat, email, WhatsApp or a file in git.
Tokens go only into a secret manager / environment settings.

---

## How the money moves (one space, many accounts)

All of MobiCare lives in one Monime space, **MobiCare SL**
(`mobicaresl.monime.space`, Space ID `spc-k6VasL8zN2DVb4JCm4RMaqLA6Cn`).

- **MobiCare Holding** account — every patient payment lands here.
- **One account per pharmacy** — created by the server the first time it is
  needed (reference = the pharmacy's ID).
- When an order is delivered or collected, the pharmacy's share (its prices
  less the 5% commission) moves Holding → pharmacy account. The commission and
  the delivery fee stay in Holding.
- A pharmacy cashes out from its account to its Orange Money / AfriMoney
  number (Monime's payout fee on top).

---

## Stage 1 — Test access token ✅ done 9 Oct 2026

developer.monime.io → Access Tokens → **Create token**:

| Field | Value |
|---|---|
| Token Name | `MobiCare - Test` |
| Expiry | 2 Months |
| Default API Release | Caph (Latest) |
| **Test Mode** | **ON** — the token must start `mon_test_` |

Roles — tick exactly these six, nothing else:

| Service | Role | Used for |
|---|---|---|
| Checkout Session | Checkout Session Admin | create / check / cancel each order's payment page |
| Payment | Payment Viewer | confirm a payment really completed before marking an order paid |
| Financial Account | Financial Account Admin | create Holding and the pharmacy accounts |
| Financial Account | Financial Account Balance Viewer | show pharmacies what they can cash out |
| Internal Transfer | Internal Transfer Admin | move the pharmacy's share after delivery |
| Payout | Payout Admin | send a pharmacy's cash-out to mobile money |

Not needed now: Payment Code, Receipt, USSD OTP, Provider KYC (maybe later, to
check a pharmacy's mobile-money name), Financial Transaction (maybe later, for
monthly reconciliation).

## Stage 2 — Give the development workspace access

Cloud environment settings (environment menu in the session's title bar → Edit):

1. **Network access** → Limited → Allowed domains: `api.monime.io`, `docs.monime.io`
   (keep "Allow package managers" ticked).
2. **Environment variables**:
   ```
   MONIME_MODE=test
   MONIME_SPACE_ID=spc-k6VasL8zN2DVb4JCm4RMaqLA6Cn
   MONIME_ACCESS_TOKEN=mon_test_…   (entered in the settings only)
   ```
3. Start a new session if the current one does not see them.

The **live** token never goes into the development workspace — only onto the
production server.

## Stage 3 — First connection (developer)

1. Check the token: the server's startup self-check confirms the token is a
   test token and Monime reports the same mode.
2. Create Holding: `node "Final Deployment files/scripts/monime-setup-accounts.mjs"`
   (finds or creates "MobiCare Holding", prints `MONIME_HOLDING_ACCOUNT_ID=fac-…`).
3. Add `MONIME_HOLDING_ACCOUNT_ID` to the environment settings.

## Stages 4–6 — replaced: Monime has no test mode

Monime support confirmed by phone on 9 Oct 2026 that test mode is not
available yet, which matches Stage 3 (every payment endpoint answers 403 to a
test token). MobiCare's money logic is instead proven against the local fake
Monime (`bash deploy/local/run.sh --fresh --monime`: payment, release to the
pharmacy, cash-out, HQ Settlements — all passed 9 Oct 2026), and the real
Monime is checked once, with small real amounts, in Stage 7.

## Stage 7 — Live

### 7A. Live check from the development workspace (small real money)

Safety rules for the whole check:
- A **separate, short-lived** token, revoked when the check ends.
- No **Payout Admin** role until step 6.
- Money only ever leaves to a phone **Martha owns**. `run.sh --monime-live`
  renames the demo pharmacies to "Live check - …" and removes their made-up
  payout numbers, so Monime accounts can't be mistaken for a real pharmacy and
  no cash-out can reach a stranger.
- Smallest amounts that work. The money goes Martha's phone → Holding →
  pharmacy account → Martha's phone; only Monime's fees are spent.

Steps:
1. **Martha — token.** Monime dashboard (Live) → Access Tokens → Create:
   name `MobiCare - Live dev check`, shortest expiry, **Test Mode OFF**, roles:
   Checkout Session Admin, Payment Viewer, Financial Account Admin, Financial
   Account Balance Viewer, Internal Transfer Admin (five; **no** Payout Admin).
   Revoke `MobiCare - Test`.
2. **Martha — environment.** Default environment → Environment variables:
   `MONIME_MODE=live`, `MONIME_SPACE_ID=spc-k6VasL8zN2DVb4JCm4RMaqLA6Cn`,
   `MONIME_ACCESS_TOKEN=mon_…` (the new token). Network: `api.monime.io`
   allowed (done). Start a **new session** (variables load at session start).
3. **Developer — connect.** Confirm `GET https://api.monime.io/` reports a live
   token (never print the token). Create Holding:
   `node "Final Deployment files/scripts/monime-setup-accounts.mjs"`. The
   Holding ID is not a secret: record it below and pass it on the command line;
   Martha adds `MONIME_HOLDING_ACCOUNT_ID` to the environment for later sessions.
4. **Developer — run.** `MONIME_HOLDING_ACCOUNT_ID=fac-… bash deploy/local/run.sh --fresh --monime-live`
   (refuses unless every setting is live and the database is fresh).
5. **Payment.** Developer sets one medicine's price at the pharmacy to the
   smallest amount Monime accepts and places a **collection** order (no
   delivery fee) as the demo patient. The site sends the browser to Monime's
   payment page: the developer sends that link to Martha, who opens it on her
   phone and pays with her own Orange Money / AfriMoney. Monime's "return"
   link points at the development machine and will not open on her phone —
   expected; the server confirms the payment by asking Monime (open the order
   page, or wait for the 10-minute safety check). Confirm: order **paid**,
   Holding balance in the Monime dashboard = amount less Monime's fee, HQ
   Settlements agrees.
6. **Pharmacy share + cash-out.** Mark the order collected → the pharmacy's
   95% moves Holding → "Live check - …" pharmacy account (check the dashboard).
   Martha creates a second short token with all six roles (adds Payout Admin)
   and swaps it into the environment (new session). Developer sets the test
   pharmacy's payout number to **Martha's own number** (directly in the local
   database, with no change date, so the 48-hour new-number hold does not apply
   to this check) and cashes out from the pharmacy portal. Confirm it arrives
   and note Monime's real payout fee.
7. **Close.** Revoke both dev-check tokens; remove `MONIME_ACCESS_TOKEN` from
   the development environment. Record results and real fees below.

What stays in Monime afterwards: the Holding account (reused by production),
a "Pharmacy: Live check - City Pharmacy, Lumley" account (empty after the
cash-out), and MobiCare's few Leones of commission in Holding.

### 7B. Production (GoDaddy)

1. Token `MobiCare - Live`, Test Mode OFF, all six roles, **1 year** (calendar
   reminder to renew).
2. On the production server only: `PAYMENTS_PROVIDER=monime`,
   `MONIME_MODE=live`, the live token, `MONIME_SPACE_ID`,
   `MONIME_HOLDING_ACCOUNT_ID` (the same Holding as 7A),
   `PUBLIC_APP_URL=https://…` (https required in production), and
   `MONIME_WEBHOOK_HEADER_TOKEN` (32+ random characters; the server refuses to
   start in production without it).
3. Monime dashboard → Developer → Webhooks → Create: URL
   `https://<site>/api/webhooks/monime`; events: checkout sessions, payouts,
   internal transfers; custom header `x-mobicare-webhook-token` = the same
   value. The server re-checks every event with Monime before acting.
4. One small real payment end to end on the live site before opening to
   pharmacies.

---

## Status and open questions

- 9 Oct 2026: Stage 1 done (token `MobiCare - Test`, created 9 Oct, active).
  Waiting on Stage 2.
- 9 Oct 2026: Stage 2 done. Stage 3 **blocked by Monime**:
  - Connection OK: `GET /` says authenticated, environment `test` (matches
    `MONIME_MODE=test`), token `MobiCare - Test` active until 9 Dec 2026,
    `apiVersion: null` (not deprecated). The server's self-check passes.
  - Every endpoint MobiCare uses answers **403 "Test mode is not supported for
    this endpoint"**: `/v1/financial-accounts`, `/v1/checkout-sessions`,
    `/v1/payments`, `/v1/internal-transfers`, `/v1/payouts` (read-only list
    calls; same with or without `Monime-Version`). So the setup script cannot
    create Holding and there is no `MONIME_HOLDING_ACCOUNT_ID` yet.
  - Monime's docs say test mode is "a full simulation of our API", so this is
    most likely a space/account setting. Ask Monime support: is test mode
    enabled for space `spc-k6VasL8zN2DVb4JCm4RMaqLA6Cn` (does the space need
    verification/KYC or a dashboard toggle first), and which endpoints test
    mode supports.
- 9 Oct 2026: Monime support (phone): test mode not available yet. Decision:
  go live with small real amounts (Stage 7A). Local fake-Monime run of the full
  flow passed the same day (payment, release, cash-out, Settlements).
- 9 Oct 2026: Stage 7A steps 1–3 done.
  - Live token: `GET /` says authenticated, environment `live`, token
    `MobiCare - real ` (`pat-k6ViVoKtseNzWaBazJdKWQ9GWVp`), active until
    9 Dec 2026. Roles checked with read-only list calls: financial accounts,
    checkout sessions, payments, internal transfers answer 200; payouts answers
    403, so there is no Payout Admin (as required until step 6).
    Differs from step 1 as written: name is not `MobiCare - Live dev check`
    and expiry is 2 months, not the shortest. Revoke it in step 7 all the same.
  - **Holding: `MONIME_HOLDING_ACCOUNT_ID=fac-k6ViVwMBF1tYfS1aUk2fgbumgw5`**
    (reference `mobicare-holding`, SLE). The space now has two accounts: `Main`
    (Monime's default) and MobiCare Holding.
  - Environment still has `MONIME_MODE=test`; it must be `live` before step 4
    (`run.sh --monime-live` refuses otherwise). Martha: set `MONIME_MODE=live`
    and add `MONIME_HOLDING_ACCOUNT_ID` above to the environment settings.
  - Found: Monime ignores `GET /v1/financial-accounts?reference=…` (returns an
    empty list even for an existing reference). Running the setup script again
    still gives the same Holding, because the create call's idempotency key
    returns the existing account, but the "find first" never matches. The
    server uses the same lookup for pharmacy accounts (`payouts.ts`) only as a
    backup: it stores each account ID once created, so this does not cause
    duplicates in normal use. Follow-up: match the reference by listing the
    accounts instead of relying on the filter.
- 9 Oct 2026: Stage 7A step 4 done, step 5 started.
  - `run.sh --fresh --monime-live` started; the API logged "Payments: Monime
    (live mode)" and "Monime payments ready" (mode live). Pharmacy renamed to
    "Live check - City Pharmacy, Lumley", with no payout numbers.
  - Found: on a fresh clone `run.sh` fails at "Creating the schema" (`Cannot
    find package 'pg'`) because migrations run before its `pnpm install` step.
    Worked around with `pnpm install --frozen-lockfile` first. Fixed the same
    day: `run.sh` now installs before the schema step (verified from a
    checkout with no `node_modules`).
  - Amount: Le 11.00, the smallest that still allows the step 6 cash-out
    (pharmacy share Le 10.45 ≥ Le 10 minimum + 1% fee). Paracetamol (Generic)
    set to Le 11.00 in the local database; patient accepted the terms
    (`POST /api/patient/privacy/consent`, needed before ordering).
  - Order `91f77f74-bff2-4868-987e-e55930d1924d`, collection: total Le 11.00,
    commission Le 0.55, patient service fee 0, delivery 0.
  - Checkout session `scs-k6ViWuhEyP2sLc68wyBCVsH8hK6`: Monime reports one line
    "Paracetamol (Generic)", SLE 1100, into Holding
    `fac-k6ViVwMBF1tYfS1aUk2fgbumgw5`; link expires 18:19 UTC.
  - Changed to Le 5.00 (Martha's decision: not enough on the wallet for
    Le 11). The Le 11 order was cancelled from the patient side. The first
    cancel was refused ("payment in progress"): Monime would not delete a link
    already opened on a phone. Once Monime showed the link `cancelled`, the
    cancel went through. Monime lists no payments, so no money moved. This is
    the intended safe behaviour, now seen against the real API.
  - Order `e76f175b-f310-4da0-a57a-b3d953edf5e2`, collection, Le 5.00
    (commission Le 0.25, pharmacy share Le 4.75). Checkout session
    `scs-k6ViXgB3wZsngxzujWHRZrnmySo`: Monime reports SLE 500 into Holding;
    link expires 18:29 UTC. Waiting on Martha's payment.
  - Le 4.75 is below the Le 10 minimum cash-out, so step 6 can move the share
    to the pharmacy account but cannot cash it out as things stand. Decide at
    step 6 (top up with a second order later, or a dev-only lower minimum).
- 9 Oct 2026: Stage 7A step 5 done, step 6 first half done.
  - Martha paid Le 5.00 with Orange Money (17:32 UTC). Monime payment
    `spm-k6ViXu5i4eGdGKEZmwfjQNZMtX9`, completed, fee `Base` **Le 0.05 (1%)**.
    Holding balance Le 4.95. The watcher saw the order go **paid** by asking
    Monime (no webhook reaches the development machine), as designed.
  - HQ Settlements agreed to the cent: paid 500, sales 500, commission 25,
    Monime fee 5 (taken from Monime's real figure), revenue 20, pharmacy
    receives 475, state "waiting". So Monime's collection fee does come out of
    Holding (`COLLECTION_FEE_TAKEN_FROM_HOLDING = true` confirmed).
  - Pharmacy confirmed → ready → collected (ID checked). Internal transfer
    `trn-k6ViXyAhFgeYVnrUoMfuxBPy2BC`, Le 4.75 Holding → new account
    "Pharmacy: Live check - City Pharmacy, Lumley"
    (`fac-k6ViXy8cSMyMntxbkZmcuMdqwYo`, reference = pharmacy ID). Completed
    at Monime at once, **no fee** on internal transfers. MobiCare's record
    moved to completed at the next 5-minute payouts check (17:37 UTC).
  - Balances afterwards: Holding Le 0.20 (= MobiCare revenue), pharmacy
    account Le 4.75. HQ: owed to pharmacies 475, order "paid_to_pharmacy".
    Pharmacy portal: available 475, max cash-out 470, minimum 1000, so the
    cash-out cannot run yet (expected, see the Le 5 note above).
- Stage 7A results so far: collection fee 1% (Le 0.05 on Le 5), internal
  transfer free. Payout fee still to measure (step 6, second half).
- 9 Oct 2026: Stage 7A **paused** after step 6's first half (Martha's
  decision): payment and release proven; the cash-out and the real payout fee
  are left for later. Le 4.75 stays in "Pharmacy: Live check - City Pharmacy,
  Lumley" until then (needs ≥ Le 10.10 for one cash-out). Local server
  stopped. Next: step 7 (revoke the live token, remove `MONIME_ACCESS_TOKEN`
  from the development environment); the cash-out check needs a new
  short-lived token with Payout Admin when it is resumed.
- 10 Oct 2026: resuming step 6 (cash-out). The local database was rebuilt
  for the fake-Monime tests, so MobiCare no longer has a record of the
  Le 4.75 release; the cash-out limit comes from those records, not from
  Monime's balance. Plan: a fresh `--monime-live` run and a **new Le 11
  collection order** (pharmacy share Le 10.45 ≥ Le 10 + 1% fee), then cash
  out about Le 10.34 to Martha's Orange Money. The seed makes a new pharmacy
  ID, so Monime gets a second "Live check" account; the earlier Le 4.75 stays
  in the first one (`fac-k6ViXy8cSMyMntxbkZmcuMdqwYo`) until moved from the
  Monime dashboard. Needs a new short token with all six roles (Payout
  Admin) and a new session; Martha gives her Orange Money number in chat.
- 9 Oct 2026: added **"Ask someone else to pay"** (Martha's request). On an
  unpaid order the patient can make a link to send to someone else by
  WhatsApp, copy or the phone's share menu. That link shows Monime one line,
  "MobiCare order <number>" and the total (no medicines, pharmacy or delivery
  area), and returns the payer to the public page `/pay/done` instead of the
  patient's order page. Still one live link per order: sharing retires the
  patient's own link first, and is refused (`PAYMENT_IN_PROGRESS`) if
  payment has already started on it; the patient's own Pay reuses a live
  shared link. Migration `0036_monime_shared_payment_links.sql`. Tested with
  the fake Monime (18 checks) and unit tests; not yet tried on real Monime.
- Sub-spaces: the account menu has **Spaces**. Current design uses one space;
  revisit only if Monime's sub-spaces bring a clear benefit (e.g. legal
  separation of pharmacy money). Questions for Monime: can money move between
  spaces by API and at what fee; can sub-spaces be created by API; does one
  token cover several spaces; whose money sits in a sub-space.
- Done 9 Oct 2026: `update-2026-10-07-security` (which contains
  `update-2026-10-02`) merged into this branch; Monime migrations renumbered
  0033/0034 → 0034/0035 (0033 is security_events).
