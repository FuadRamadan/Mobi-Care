# Secrets, and the one that must be rotated — step 4

Part of the deployment handover; the order of work is in
[README.md](README.md).

## What happened

`JWT_SECRET` was committed to `.replit` and sat in the repository from commit
`2d6245b` until it was removed. It is 128 hex characters, and it is public to
anyone who has ever had a copy of this repository.

It has been removed from three places in the working tree: `.replit`, the stale
copy under `exports/mobicare-source-export/`, and inside
`exports/mobicare-source-export.zip`.

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

```bash
openssl rand -hex 32
```

Set the result as `JWT_SECRET` in the host's secret manager and restart the API.

What it costs:

- Everyone signed in is logged out and signs in again. Access tokens live 15
  minutes and refresh tokens are random values stored hashed in the database, so
  nothing is lost.
- Outstanding signed image URLs stop working. They are short-lived and minted on
  demand, so pages regenerate them on next load.

Nothing needs re-entering. This is a cheap rotation — do it now.

## Do NOT rotate SESSION_SECRET casually

`SESSION_SECRET` was **never committed** — it is not affected by this incident,
and there is no reason to change it.

That matters, because rotating it is expensive and partly irreversible:

- It derives the AES-256-GCM key that encrypts stored provider credentials
  (`lib/credentialEncryption.ts`) — the Orange SMS credentials held in the HQ API
  Connections feature. Change the secret and those values **cannot be
  decrypted**. They must be re-entered in HQ.
- It is the HMAC key for patient password-reset codes (`routes/auth.ts`). Change
  it and every reset code already sent stops verifying.

If it ever does need rotating — because it leaks — plan it: re-enter provider
credentials immediately afterwards, and expect in-flight password resets to
fail.

The two secrets must be different values. The API refuses to start if they
match, so that the cheap rotation never forces the expensive one.

## What the startup check enforces

In production only, `lib/secrets.ts` refuses to start when any secret is:

- missing
- shorter than 32 characters
- a known-compromised value (currently the retired `JWT_SECRET`)
- a placeholder like `replace-with-...`
- identical to the other secret

All problems are reported at once, so a misconfiguration is fixed in one pass.
Development and test runs are unaffected — they use short fixture values on
purpose.

## Keeping secrets out of the repository

- `.env` is already git-ignored. `.env.example` holds names and guidance only,
  never values.
- `.replit` no longer carries a secret, and should never carry one again — put
  values in the host's secret manager.
- `exports/` is a stale duplicate of the whole codebase, 12 MB including a zip.
  It is where the leaked secret survived the first cleanup. It is out of date
  with the current source and serves no purpose in the repository. **Deleting it
  is recommended** — it is one more place for a secret to hide.

## Rate limiting and headers

Introduced alongside this, since the platform edge that previously absorbed
abuse is no longer in front of the API.

- **Security headers** (`helmet`) — HSTS, `nosniff`, `SAMEORIGIN`,
  `no-referrer`, and no `X-Powered-By`. No Content-Security-Policy: this process
  serves JSON and image bytes, never HTML.
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
