# Monitoring — step 6

Two kinds of watching, both needed:

1. **Is MobiCare up?** An outside service checks every few minutes and tells
   you when it is not. You set this up once (15 minutes, free).
2. **Is someone attacking it?** MobiCare records suspicious activity itself and
   alerts HQ. Built in; nothing to set up.

---

## 1. Uptime: know within minutes when the site is down

MobiCare answers two health addresses:

| Address | Answers 200 when | Use it for |
|---|---|---|
| `/api/health` | the server process is running | quick "is it alive" checks |
| `/api/health/ready` | the server **and the database** both answer | **the uptime monitor** |

`/api/health/ready` returns `{"status":"ok","database":"ok"}`, or **503** with
`"database":"unreachable"` when the server is up but cannot reach the database —
the outage patients would actually notice.

### Set up a free monitor (UptimeRobot — Better Stack works the same way)

1. Create a free account at uptimerobot.com with the MobiCare email.
2. **Add New Monitor** → type **HTTP(s)**.
3. URL: `https://mobicaresl.com/api/health/ready` (your live address).
4. Interval: **5 minutes**.
5. Alert contacts: your email, and install the UptimeRobot phone app for push
   alerts. Add a second person so someone is always reachable.
6. Optional: a second monitor on `https://mobicaresl.com/` (the website itself).

When it alerts: open the site; check GoDaddy's Node.js app status and logs; if
the database is the problem (`503 … unreachable`), check the database provider's
status page.

---

## 2. Security activity: built into HQ

HQ → **Security & Settings** → **Security activity** (visible to staff with the
*Manage integrations* permission, who also receive the alerts).

What is recorded:

| Shown as | What happened |
|---|---|
| **Wrong password** | A failed sign-in (patient, pharmacy or HQ), a wrong current password when changing it, or a wrong password-reset code. |
| **Blocked: too many tries** | A network made 10 failed attempts in 15 minutes and is locked out of signing in for 15 minutes — even with the right password. |
| **Blocked content** | A browser refused to load or send something a MobiCare page tried to use, because the content security policy does not allow it. |
| **Server error** | A request failed inside the server. |

Phone numbers are shown masked (`+232•••••001`). Events are kept **90 days**,
then deleted automatically.

### Alerts (in the HQ bell, and in the server log)

| Alert | Sent when | What to do |
|---|---|---|
| **Possible password guessing** | 5 wrong passwords for one account in 15 minutes | Call the account holder. If it wasn't them: a pharmacy — HQ → Pharmacies → Reset; a patient — they use "Forgot password"; an HQ account — the person changes their password at once. Look at the network address in the activity list. |
| **Many failed sign-ins** | 30 wrong passwords across all accounts in 15 minutes | Someone is trying passwords on many accounts. Check the networks list; if one address dominates, ask the host to block it. |
| **Sign-in attempts blocked** | 3 lockouts in 15 minutes | Usually the same as above, already being stopped. Watch for it continuing. |
| **Server errors** | 10 in 15 minutes | Patients may be seeing failures. Check the server logs on GoDaddy; send them to your developer. |
| **Browsers blocked unexpected content** | 20 in an hour | Either someone tried to inject code (it was blocked), or a new outside service was added to the site without being allowed. The activity list shows what was blocked and on which page. |

Each alert is sent at most once an hour, so an ongoing attack does not flood
the bell.

---

## 3. The content security policy

Every page tells the browser exactly where it may load code, styles, fonts,
pictures and connections from: MobiCare itself, Google sign-in, Google Fonts,
the map tiles, and the file storage (`S3_ENDPOINT`). Anything else — a script
injected by an attacker, a page trying to send sign-in details to another
server, another website showing MobiCare inside a frame — is refused by the
browser and reported.

**Adding a new outside service** (a new map provider, a chat widget, analytics):
it will be blocked until it is allowed. Either set `CSP_EXTRA_IMG_SRC` /
`CSP_EXTRA_CONNECT_SRC` (see `env.production.example`) or ask your developer to
add it to `artifacts/api-server/src/lib/contentSecurityPolicy.ts`. To test a new
service without blocking anything, set `CSP_MODE=report-only` for a while and
watch Security activity.

---

## 4. Keeping packages up to date

- Every release runs `scripts/check-vulnerabilities.mjs`, which stops the build
  if any package used by the server or the websites has a known high or
  critical vulnerability.
- On GitHub, turn on **Settings → Code security → Dependabot security updates**.
  GitHub then opens a pull request whenever a security fix is available
  (configured in `.github/dependabot.yml`; routine version bumps are off).
- The Expo mobile app's build tools have their own findings; they do not run on
  the server and are cleared by upgrading the Expo SDK.
