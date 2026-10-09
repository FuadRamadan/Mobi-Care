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
- Stage 7A results: _(to fill in: Holding ID, amounts, real Monime fees)_
- Sub-spaces: the account menu has **Spaces**. Current design uses one space;
  revisit only if Monime's sub-spaces bring a clear benefit (e.g. legal
  separation of pharmacy money). Questions for Monime: can money move between
  spaces by API and at what fee; can sub-spaces be created by API; does one
  token cover several spaces; whose money sits in a sub-space.
- Done 9 Oct 2026: `update-2026-10-07-security` (which contains
  `update-2026-10-02`) merged into this branch; Monime migrations renumbered
  0033/0034 → 0034/0035 (0033 is security_events).
