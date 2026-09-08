# Blockers

Was two. One is now done and is kept here with the evidence, because "the
driver is handled" is a claim worth being able to check. The other is a
decision for you, not a piece of missing code.

---

## 1. The database driver — done

**Status:** built and verified. Nothing to do beyond setting one environment
variable.

GoDaddy Node.js Hosting allows outbound traffic on **ports 80 and 443 only**,
and `node-postgres` speaks the PostgreSQL wire protocol on 5432. The app now
supports both drivers and chooses between them:

| `DATABASE_DRIVER` | Driver | Transport |
|---|---|---|
| unset (default) | `node-postgres` | PostgreSQL protocol on 5432 |
| `neon` | `@neondatabase/serverless` | the same protocol inside a WebSocket on 443 |

A connection string pointing at a `*.neon.tech` host selects the Neon driver on
its own, so forgetting the variable is not what breaks a deploy. An explicit
setting always wins. The chosen driver and the reason are logged at startup.

**On GoDaddy, set `DATABASE_DRIVER=neon`.** Development, the test suite and the
migration runner are unaffected — they keep the default.

### What was verified, and how

Not "it compiles". The Neon driver was run against a real PostgreSQL through a
WebSocket, using `deploy/local/ws-proxy.mjs` in place of Neon's own endpoint:

- a query returned `PostgreSQL 16.13` over the WebSocket
- the application schema read back correctly, including the `enum` and `numeric`
  columns that a port to MySQL would have broken
- an interactive transaction committed, and a failing one rolled back — the
  reason a plain HTTP driver is not enough, since payment claiming, stock
  deduction and the pilot-data reset all run inside `db.transaction()`
- the whole application ran on it: patient sign-in, category browse, search,
  add to cart, a real order placed and paid, HQ dashboard, orders and insights,
  and the pharmacy portal — all through a browser, with no errors logged
- with `NODE_ENV=production` the driver connects on **443**, and the
  development-only proxy setting is ignored

Reproduce it yourself:

```bash
bash deploy/local/run.sh                      # in one terminal
node .local/ws-proxy.cjs --port 5433 --allow 127.0.0.1:55500 &
DATABASE_URL=postgresql://postgres@127.0.0.1:55500/mobicare \
  node .local/verify-neon-driver.cjs
```

### What is still unproven

That **GoDaddy permits the outbound WebSocket at all**. That is a property of
their network, not of this code, and only the
[connectivity probe](1-connectivity-probe/README.md) deployed there can answer
it. Run it first. If it says NO-GO, no driver helps and the answer is a VPS.

### Found while testing this

A pool with no `error` listener exits the process when an idle connection dies —
and a serverless PostgreSQL drops idle connections routinely when its compute
suspends. The API now logs it and stays up. Verified by dropping every pooled
connection at once: the process survived, the request in flight returned a clean
500, and the next request after the database came back returned 200 with no
restart.

## 2. Payment is not verified

**Status:** known and accepted for this deployment. Decide before real orders.

`POST /api/patient/orders/:id/pay` moves an order to `paid` on the patient's own
authenticated request, with **no Orange Money confirmation**. Anyone with an
account can mark their own order paid and trigger fulfilment without paying, and
those orders flow into pharmacy commission settlements — so the financial
records inherit the same gap.

The intended design is that the mobile money provider confirms the payment: once
money reaches the pharmacy's number, the order registers as paid automatically.
That integration is not built.

### Your options

- **Complete the Orange Money integration** before opening checkout. This is the
  real answer.
- **Run the site without advertising the ordering flow** — everything else
  (search, price comparison, pharmacy discovery) is safe to use.
- **Disable the payment route at the proxy** until the integration lands.

What you should not do is take real orders through it and treat the settlement
figures as money owed.

The pharmacy's mobile money numbers are already collected and shown to the
patient at checkout, so payment happens correctly today — it just is not
*verified* by the platform. The patient pays the pharmacy directly and the
pharmacy confirms.
