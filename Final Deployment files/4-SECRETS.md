# Secrets, and the one that must be rotated — step 4

Part of the deployment handover; the order of work is in
[README.md](README.md).

## What happened

`JWT_SECRET` was committed to `.replit` and sat in the repository from commit
`2d6245b` until it was removed. It is 128 hex characters, and it is public to
anyone who has ever had a copy of this repository.

It has been removed from `.replit`, and the stale `exports/` duplicate that held
two further copies of it has been deleted outright.

**It is still in git history, and removing it from there is not the fix.**
Rewriting history would break every existing clone and would not reach copies
already taken. The fix is rotation: generate a new value, and the old one
becomes worthless.

To make that stick, the API now refuses to start if `JWT_SECRET` or
`SESSION_SECRET` matches the retired value. The check compares SHA-256 digests,
so the secret itself is not recorded in the source.

## What the leaked secret could do

`JWT_SECRET` signs two things:

- **Access tokens** (`lib/jwt.ts`) — anyone holding the secret can mint a valid
  token for any role, including HQ, and act as that user for the token's
  lifetime.
- **Signed image URLs** (`lib/signedUrl.ts`) — the links that serve prescription
  images and patient profile photos. Forging one grants access to medical
  images.

Treat it as compromised regardless of whether misuse is suspected.

## Rotate JWT_SECRET — do this

Generate fresh values (both secrets at once, printed and stored nowhere):

```bash
bash "Final Deployment files/scripts/generate-secrets.sh"
```

Set the `JWT_SECRET` line in the host's secret manager and restart the API.
If the live server still runs a release from before September 2026 it may be
using the leaked value: the new release **refuses to start** with it and says
so ("matches the JWT_SECRET that was committed to .replit"). That message means
"rotate now", not "the deploy is broken".

What it costs:

- Everyone signed in is logged out and signs in again. Access tokens live 15
  minutes and refresh tokens are random values stored hashed in the database, so
  nothing is lost.
- Outstanding prescription and photo links stop working. They last 15 minutes
  and pages make new ones on the next load.

Nothing needs re-entering. This is a cheap rotation — do it now.

Prescription and photo links are signed with their own key, derived from
`JWT_SECRET` under a fixed label, so a signature made for one purpose is never
accepted for the other. Sign-in tokens accept only HS256.

## Rotating SESSION_SECRET

`SESSION_SECRET` was **never committed** — it is not affected by the incident.
Rotate it only if it leaks, or as a scheduled precaution (once a year is ample).

It protects two things:

- The AES-256-GCM key for stored provider credentials
  (`lib/credentialEncryption.ts`) — the Orange SMS and API Connections settings
  in HQ.
- The HMAC key for patient password-reset codes (`routes/auth.ts`). Reset codes
  already sent stop verifying; the patient asks for a new one.

Rotating without losing the stored credentials:

1. Run `generate-secrets.sh` and take the `SESSION_SECRET` line.
2. In the secret manager, set **`SESSION_SECRET_PREVIOUS`** to the *current*
   value, and **`SESSION_SECRET`** to the new one.
3. Restart the API. At startup it moves every stored credential to the new key
   and logs: "SESSION_SECRET rotation: N stored credentials moved to the new key.
   Remove SESSION_SECRET_PREVIOUS now."
4. **Delete `SESSION_SECRET_PREVIOUS`** and restart once more.

If the log says some credentials "could not be read with either key", re-enter
those in HQ → API Connections.

The two secrets must be different values. The API refuses to start if they
match, so that the cheap rotation never forces the expensive one.

## What the startup check enforces

In production only, `lib/secrets.ts` refuses to start when any secret is:

- missing
- shorter than 32 characters
- a known-compromised value (currently the retired `JWT_SECRET`)
- a placeholder like `replace-with-...`
- identical to the other secret
- `SESSION_SECRET_PREVIOUS` set to the same value as `SESSION_SECRET`

All problems are reported at once, so a misconfiguration is fixed in one pass.
Development and test runs are unaffected — they use short fixture values on
purpose.

## Keeping secrets out of the repository

- `.env` is already git-ignored. `.env.example` holds names and guidance only,
  never values.
- `.replit` no longer carries a secret, and should never carry one again — put
  values in the host's secret manager.
- `exports/` has been deleted. It was a stale 12 MB duplicate of the whole
  codebase, including a zip, and it is where the leaked secret survived the
  first cleanup. Do not reintroduce a snapshot of the source into the
  repository: it is one more place for a secret to hide.

## Rate limiting and headers

Introduced alongside this, since the platform edge that previously absorbed
abuse is no longer in front of the API.

- **Security headers** (`helmet`) — HSTS, `nosniff`, `SAMEORIGIN`,
  `strict-origin-when-cross-origin` referrer, and no `X-Powered-By`.
- **Content security policy** on every page of the website, patient app, HQ and
  pharmacy portal (`lib/contentSecurityPolicy.ts`): pages load code only from
  MobiCare and Google sign-in, can't be shown inside other sites, and can't send
  data to unknown addresses. Blocked attempts are reported to HQ — see
  [6-MONITORING.md](6-MONITORING.md).
- **Global limit** — 300 requests per minute per client, well above normal use.
  Configure with `RATE_LIMIT_GLOBAL_PER_MINUTE`.
- **Credential limit** — 10 attempts per 15 minutes on login, registration,
  password change and password reset. Successful requests are not counted, so
  ordinary use never trips it. Configure with `RATE_LIMIT_AUTH_PER_15_MIN`.
- `/api/health` is answered before the limiter, so uptime monitoring cannot
  exhaust the budget and a throttled API still reports liveness.

### TRUST_PROXY_HOPS is load-bearing

Rate limits key on the client address, which behind a proxy comes from
`X-Forwarded-For`. Getting the hop count wrong fails in two ways that both look
like working software:

- **Too low** — every request appears to come from the proxy, so all clients
  share one budget and a single attacker locks out every user.
- **Too high** — the client can spoof `X-Forwarded-For`, rotate fake addresses,
  and never be limited at all.

So the count is explicit, not `true`. Default is 1 in production, the usual
single reverse proxy. Set `TRUST_PROXY_HOPS` if the real topology differs, and
confirm it after deploying: the client address in the request logs should be the
real caller, not the proxy.
