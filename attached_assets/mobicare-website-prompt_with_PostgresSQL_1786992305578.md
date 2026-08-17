# Prompt: Build the MobiCare Unified Gateway Application

Copy everything below into a new Claude (or Claude Code) conversation to kick off the build.

---

I'm building **MobiCare**, a medicine-delivery and pharmacy platform for Sierra Leone. I already have the product built as **three separate working apps** — patient app, pharmacy portal, HQ dashboard — all sharing one backend API. Right now each is its own deployment with its own URL and its own login screen.

I want you to build a **single unified application** that brings all three under one roof:

- **One landing page** at the root domain that explains MobiCare and presents the three portals as clear, distinct entry points (e.g. "I'm a Patient" / "I'm a Pharmacy" / "MobiCare HQ").
- Selecting one takes the visitor to **that portal's own login/sign-in**, still fully separate in terms of role, data, and access — the unification is at the entry point and shell level, not a merging of patient/pharmacy/HQ data or permissions. Nothing about the existing role-based access on the API should change.
- Each portal keeps functioning exactly as it does today once the visitor is inside it — this is about giving the whole product **one front door**, not rebuilding the three apps into one interface.

## What MobiCare is

MobiCare lets patients search for medicine, compare pharmacy prices, order for delivery or collection, pay by mobile money, and track their order — with a licensed pharmacist reviewing any prescription-required item. Partner pharmacies manage their orders and inventory through a dedicated portal, and MobiCare HQ has full operational oversight (dispatch, settlements, audit log) across the platform. It's a three-sided product: **patients**, **pharmacies**, and **MobiCare HQ/ops**, all on one shared backend.

## Who the landing page is for

1. **Patients/the public** — explain what MobiCare does, build trust, and route them into the patient portal (it's an installable PWA, "Add to Home Screen," not an app-store download).
2. **Pharmacies** — a partner-recruitment pitch plus a clear "Pharmacy Login" path (HQ issues credentials, no self-registration for pharmacies).
3. **MobiCare HQ/ops staff** — a low-key, clearly-labelled entry point into the HQ dashboard. This one doesn't need marketing copy, just a direct, unambiguous login link — it shouldn't be prominent to the general public.

## Brand identity (use these exactly)

- Primary green: `#1A8F6E`
- Dark green: `#0B3D2E`
- Accent (terracotta/orange): `#D85A30`
- Orange Money brand orange: `#FF6600` (used only in payment-related contexts)
- Light green background: `#E8F5EF`
- Neutral background: `#F5F7F6`
- Text: `#1B2B27`, muted text: `#6B7C76`, border: `#D9E2DE`
- Currency is the Sierra Leonean Leone, formatted like `Le 1,955`
- Tone: warm, clear, plain-spoken — never clinical or corporate. Short sentences. Built for a mobile-first, sometimes low-bandwidth audience.

## Non-negotiable honesty/policy points (must appear on the site, worded carefully)

- MobiCare **never marks an order as paid until the payment provider confirms it** — don't imply instant/guaranteed payment.
- MobiCare **does not itself verify prescriptions** — the accurate phrasing is "a licensed pharmacist reviews yours."
- Controlled/Tier 1 medicines are **collection-only, with in-person ID check at pickup** — never online, never delivered.
- Medicines are shown in three tiers: over-the-counter, prescription-required, and controlled — be accurate about what each tier means and don't blur them for marketing effect.

## Site structure I want

1. **Landing page (`/`)** — hero explaining MobiCare in one line, then three clear cards/buttons: **Patient**, **Pharmacy**, **HQ**. Under "how it works" (search → compare → order → pay → track) and the honesty/trust highlights below. HQ's card should be visually de-emphasized relative to Patient and Pharmacy — smaller, plainer, maybe lower on the page — since it's for internal staff, not the public.
2. **Patient entry (`/patient` or subdomain)** — a short "for patients" pitch (search & compare pharmacy prices, delivery or collection, mobile money payment, prescription upload, tracking, alerts) with a CTA into the existing patient app's login/register.
3. **Pharmacy entry (`/pharmacy`)** — partner pitch (reach more patients, manage orders/inventory from one portal, HQ-issued onboarding) with a CTA into the existing pharmacy portal's login. No self-registration — say so plainly, and give a "request to become a partner" contact path for pharmacies that don't have credentials yet.
4. **HQ entry (`/hq` or `/staff`)** — minimal, no marketing copy, just a login link into the existing HQ dashboard.
5. **About** (optional, can fold into the landing page) — the three-sided model and why it's trustworthy, Sierra Leone context.

## How the three portals should connect to the gateway

Tell me your read on the best approach given what actually exists — the three portals are already separately deployed, working apps (see `patient-app`, `pharmacy-portal`, `hq-dashboard`) each with their own `serve.js` and login screen. I'd rather not rebuild their internals. Reasonable options, roughly in order of how much I'd prefer them:

- **Routed links**: the landing page lives at the root domain and its three buttons link straight to each portal's existing URL/subdomain (e.g. `app.mobicare.sl`, `pharmacy.mobicare.sl`, `hq.mobicare.sl`) or existing deployed path. Simplest, keeps each app fully independent, no risk to what's already working.
- **Reverse-proxied paths under one domain**: same three untouched apps, but served under one domain at different paths (e.g. `mobicare.sl/patient`, `/pharmacy`, `/hq`) via a proxy/rewrite layer, so it *feels* like one app without merging code.
- Only propose an iframe-embed or a true single-codebase merge if you think it's clearly better — I'd want to understand the trade-offs (especially for the patient PWA's installability) before going that route.

## Brand identity (use these exactly)

- Primary green: `#1A8F6E`
- Dark green: `#0B3D2E`
- Accent (terracotta/orange): `#D85A30`
- Orange Money brand orange: `#FF6600` (used only in payment-related contexts)
- Light green background: `#E8F5EF`
- Neutral background: `#F5F7F6`
- Text: `#1B2B27`, muted text: `#6B7C76`, border: `#D9E2DE`
- Currency is the Sierra Leonean Leone, formatted like `Le 1,955`
- Tone: warm, clear, plain-spoken — never clinical or corporate. Short sentences. Built for a mobile-first, sometimes low-bandwidth audience.

## Non-negotiable honesty/policy points (must appear on the landing/patient/pharmacy pages, worded carefully)

- MobiCare **never marks an order as paid until the payment provider confirms it** — don't imply instant/guaranteed payment.
- MobiCare **does not itself verify prescriptions** — the accurate phrasing is "a licensed pharmacist reviews yours."
- Controlled/Tier 1 medicines are **collection-only, with in-person ID check at pickup** — never online, never delivered.
- Medicines are shown in three tiers: over-the-counter, prescription-required, and controlled — be accurate about what each tier means and don't blur them for marketing effect.

## Technical requirements

- The **gateway/landing layer** should be a lightweight, dependency-light build (plain HTML/CSS/JS or a simple framework) — fast on low-bandwidth mobile connections, mobile-first and fully responsive.
- Don't rewrite or restructure the existing `patient-app`, `pharmacy-portal`, or `hq-dashboard` client codebases as part of this — treat the gateway as a new layer that sits in front of them. If a chosen approach genuinely requires a small, additive change inside one of those apps (e.g. a redirect target), flag it explicitly and keep it minimal.
- Preserve the patient app's PWA installability ("Add to Home Screen") — this is the main reason to lean toward linking/proxying over iframing.
- Accessible (good contrast, readable type sizes), fast load, minimal dependencies.

## Database: keep PostgreSQL

The existing shared API (`api/`) is already built on **PostgreSQL** — `pg` + `node-pg-migrate`, with a relational schema (migrations, `seeds/seed.js`, `seeds/bootstrap-hq.js`, tests referencing tables) that all three portals depend on for orders, users, pharmacies, prescriptions, inventory, settlements, and the audit log. **Keep it on PostgreSQL — no database migration.** Don't touch the schema, migrations, or query layer as part of this gateway work.

What I do want verified: **every connection must be accurate, not assumed.** The API's Postgres connection config, each portal's `api.js` client pointing at the right API base, and CORS between the gateway, the three portals, and the API all need to actually work end-to-end. Test the full path for each portal (login → a real read → a real write) before considering it done, and tell me explicitly what you tested and what you couldn't verify.

## What I want from you first

Before writing code, tell me which gateway connection approach (linked / proxied / other) you'd recommend given the existing repo structure, propose a short site map/wireframe for the landing page, and draft hero copy — then build it out once I confirm direction.
