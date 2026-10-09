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

## Stage 4 — Test payment

Run MobiCare locally with the real Monime test API, place an order, pay on
Monime's test payment page, confirm the order turns **paid** (the server checks
with Monime on return and every 10 minutes — webhooks are not needed for this).

## Stage 5 — Test the pharmacy's money

Deliver / collect the order → the pharmacy's share moves to its account →
cash out to a test number → confirm balances in the Monime dashboard match the
pharmacy portal and HQ → Settlements.

## Stage 6 — Webhooks (needs a public test server)

Monime dashboard → Developer → Webhooks → **Create webhook**:
- URL: `https://<server>/api/webhooks/monime`
- Events: checkout sessions, payouts, internal transfers.
- If the form allows a custom header, add `x-mobicare-webhook-token` with a
  random value and set the same value as `MONIME_WEBHOOK_HEADER_TOKEN` on the
  server. Either way the server re-checks every event with Monime before acting.

## Stage 7 — Go live

1. New token, **Test Mode OFF**, same six roles, name `MobiCare - Live`, 1 year
   (calendar reminder to renew).
2. On the production server only: `MONIME_MODE=live`, the live token, the space ID.
3. Run the setup script again (creates the live Holding account).
4. Live webhook to the production URL.
5. One small real payment end to end (e.g. Le 5) before opening to pharmacies.

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
- Confirm the token starts with an underscore form `mon_test_` (the server
  rejects other forms).
- Sub-spaces: the account menu has **Spaces**. Current design uses one space;
  revisit only if Monime's sub-spaces bring a clear benefit (e.g. legal
  separation of pharmacy money). Questions for Monime: can money move between
  spaces by API and at what fee; can sub-spaces be created by API; does one
  token cover several spaces; whose money sits in a sub-space.
- Before testing, merge `update-2026-10-02` and `update-2026-10-07-security`
  into this branch (controlled-medicine cap fix, fonts, security update), and
  renumber this branch's migrations 0033/0034 → 0034/0035 (0033 is
  security_events; nothing here has been deployed).
