# The two things that are not done

Both are deliberate. Neither can be finished without access to the GoDaddy
platform and a real database, and guessing at either would have produced code
that looks finished and fails in production.

---

## 1. The database driver connects on a port GoDaddy blocks

**Status:** not done. One file, about ten lines.

`lib/db/src/index.ts` uses `node-postgres`, which speaks the PostgreSQL wire
protocol on **port 5432**. GoDaddy Node.js Hosting allows outbound connections
on **ports 80 and 443 only**. As it stands, the deployed app cannot reach any
external PostgreSQL at all — it will start, fail to connect, and every request
will error.

The fix is a driver that speaks PostgreSQL over WebSocket on 443. Neon's
`@neondatabase/serverless` does exactly that, and its `Pool` is documented as a
drop-in replacement for `node-postgres` with session and interactive transaction
support — which MobiCare requires, because payment claiming, stock deduction and
the pilot-data reset all run inside `db.transaction()`.

### The change

Add the dependency:

```bash
pnpm --filter @workspace/db add @neondatabase/serverless
```

Then in `lib/db/src/index.ts`:

```diff
-import { drizzle } from "drizzle-orm/node-postgres";
-import pg from "pg";
+import { drizzle } from "drizzle-orm/neon-serverless";
+import { Pool } from "@neondatabase/serverless";
 import * as schema from "./schema";

-const { Pool } = pg;
-
 if (!process.env.DATABASE_URL) {
   throw new Error(
     "DATABASE_URL must be set. Did you forget to provision a database?",
   );
 }
```

Nothing else changes. The schema, all 24 migrations, the baseline, the financial
logic and the tests are untouched, because it is still PostgreSQL.

### Before you make it

Run the [connectivity probe](1-connectivity-probe/README.md) on GoDaddy first.
If it comes back NO-GO, this change is pointless — the platform cannot open the
connection whatever driver you use, and the answer is a VPS instead.

### Watch out for

- **`deploy/local/run.sh` uses a plain local PostgreSQL on 5432.** The Neon
  driver can talk to an ordinary PostgreSQL over TCP as well, but if local
  development breaks after the swap, that is the first place to look. Making the
  driver selectable by an environment variable, defaulting to `pg`, is the
  cleaner shape if you want both.
- **`lib/db/scripts/migrate-tracked.mjs` uses `pg` directly** and runs from a
  developer machine, not from GoDaddy. It does not need changing — but it does
  mean migrations are applied from somewhere with 5432 access, which is normal.

### Why it was left

Database connection code that has never opened a real connection should not be
committed as though it were ready. This needs a Neon project and one successful
connection from a deployed app before it goes in — which is exactly what step 1
establishes.

---

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
