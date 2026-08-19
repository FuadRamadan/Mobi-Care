# MobiCare

MobiCare is a Sierra Leonean health-tech platform that helps people find and order medicines from licensed pharmacies without travelling from pharmacy to pharmacy first.

The platform connects three groups:

- **Patients** searching for medicines, uploading prescriptions, placing orders, and tracking delivery or collection.
- **Partner pharmacies** managing stock, reviewing prescriptions, and fulfilling orders.
- **MobiCare HQ staff** overseeing pharmacies, medicine records, orders, delivery operations, settlements, and audit activity.

> **Payment status:** MobiCare currently presents Orange Money as the intended payment method. The live Orange Money gateway is **not connected yet**; the existing flow records a payment intent for development/demo use only. A production connection must wait for Orange's merchant onboarding, API documentation, and callback requirements.

## Platform components

| Component | Location | Purpose |
| --- | --- | --- |
| API server | `artifacts/api-server` | Express API for authentication, orders, pharmacies, inventory, prescriptions, notifications, and HQ operations |
| MobiCare Gateway | `artifacts/mobicare-gateway` | Marketing site and web portals for patients and HQ staff |
| Pharmacy Portal | `artifacts/pharmacy-portal` | Web dashboard for pharmacy partners |
| Mobile App | `artifacts/mobicare-mobile` | Expo / React Native patient app |
| Shared database | `lib/db` | PostgreSQL schema and Drizzle ORM access |
| API contract | `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | OpenAPI contract, validation schemas, and generated React Query client |

## What is implemented

### Patient experience

- Patient registration, login, access-token refresh, and logout.
- Search for medicines from partner pharmacies.
- Medicine details, availability, and pharmacy comparisons.
- Cart and checkout flows for collection or delivery.
- Prescription image upload for prescription-required medicines.
- Order tracking with status timeline.
- In-app order notifications and push-notification registration.
- Installable mobile-first web experience and native Expo mobile app.

### Pharmacy portal

- Pharmacy staff login.
- Inventory and medicine catalogue management.
- Order queue and fulfilment status changes.
- Prescription review.
- Pharmacy notifications and operational analytics.

### HQ operations

- HQ login with role-based access.
- Pharmacy, medicine, courier, order, flag, audit, and settlement oversight.
- Staff-focused dashboard views.

### Public MobiCare site

- Landing, About, patient, pharmacy, and HQ pages.
- Brand, mission, values, operating model, partner logos, contact information, and social links.
- Team section with supplied team photos.
- Search/social preview assets and installable web-app metadata.

## Technology

- **Monorepo:** pnpm workspaces
- **Language:** TypeScript
- **API:** Node.js, Express 5, Zod, Pino
- **Database:** PostgreSQL with Drizzle ORM
- **Web apps:** React 19, Vite, Wouter, TanStack Query, Tailwind CSS
- **Mobile:** Expo, React Native, Expo Router, React Query
- **API contract:** OpenAPI with generated Zod schemas and React hooks
- **Storage:** Google Cloud Storage-compatible object storage for prescription images

## Requirements

- Node.js 24 or newer
- pnpm
- PostgreSQL database

Use pnpm for all dependency operations:

```bash
pnpm install
```

## Configuration

The API needs a PostgreSQL connection string:

```bash
DATABASE_URL=postgresql://...
```

The deployed application also relies on server-side session and object-storage configuration. Add these as environment secrets in Replit or your hosting provider; never commit secret values to the repository.

| Configuration | Used for |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `SESSION_SECRET` | Secure session/signing configuration |
| Object storage configuration | Prescription-image storage |
| `ALLOWED_ORIGINS` | Restrict browser origins permitted to call the API in production |

## Run locally

Install dependencies once:

```bash
pnpm install
```

Run each application in a separate terminal:

```bash
# API server
pnpm --filter @workspace/api-server run dev

# Public site, patient web portal, and HQ portal
pnpm --filter @workspace/mobicare-gateway run dev

# Pharmacy partner portal
pnpm --filter @workspace/pharmacy-portal run dev

# Expo patient app
pnpm --filter @workspace/mobicare-mobile run dev
```

In Replit, these are already configured as workflows:

- `artifacts/api-server: API Server`
- `artifacts/mobicare-gateway: web`
- `artifacts/pharmacy-portal: web`
- `artifacts/mobicare-mobile: expo`

## Quality checks

```bash
# Type-check the whole workspace
pnpm run typecheck

# Build every workspace package that provides a build script
pnpm run build

# Type-check one component
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/mobicare-gateway run typecheck
pnpm --filter @workspace/pharmacy-portal run typecheck
pnpm --filter @workspace/mobicare-mobile run typecheck
```

When the API contract changes, regenerate the client and validation code:

```bash
pnpm --filter @workspace/api-spec run codegen
```

For development database schema changes:

```bash
pnpm --filter @workspace/db run push
```

## Key user flows

### Patient order flow

1. Patient signs in and searches for a medicine.
2. They choose a partner pharmacy and add available items to the cart.
3. If necessary, they upload a prescription.
4. They choose delivery or pharmacy collection and submit the order.
5. The order enters the payment window and is then shown as paid in the current development flow.
6. Pharmacy staff confirm, package, and prepare the order for collection or delivery.
7. The patient tracks progress and receives status notifications.

### Pharmacy fulfilment flow

1. Pharmacy staff sign in to the Pharmacy Portal.
2. They keep inventory and availability current.
3. They review incoming orders and prescriptions.
4. They update the order through confirmed, packaging, ready, delivery, and completion states.

## Orange Money integration roadmap

Orange Money is the selected payment direction for MobiCare. The live integration should not be enabled until Orange provides merchant access and confirms its required API flow.

The live integration will need:

1. Orange merchant onboarding and sandbox/production credentials stored as secrets.
2. A server-side payment-request endpoint.
3. A callback/webhook endpoint that verifies Orange's signature and payment status.
4. Idempotent transaction records to prevent a callback or retry from charging/marking an order twice.
5. Order status changes only after Orange confirms payment.
6. Mobile and web checkout updates to redirect or prompt the user using Orange's approved flow.

Do **not** place Orange credentials, API keys, callback signatures, or merchant secrets in source code, this README, or chat messages.

## Current reliability work

The following broader backend hardening work has been identified and is queued separately:

- Add controlled API error handling so database/network failures do not return uncontrolled responses.
- Make pharmacy order status transitions atomic so simultaneous staff actions cannot both succeed.
- Complete Orange Money payment verification once Orange partnership integration details are available.

## Project structure

```text
.
├── artifacts/
│   ├── api-server/          # Express API
│   ├── mobicare-gateway/    # Public site, patient web portal, HQ portal
│   ├── pharmacy-portal/     # Pharmacy partner dashboard
│   └── mobicare-mobile/     # Expo patient app
├── lib/
│   ├── api-client-react/    # Generated API hooks
│   ├── api-spec/            # OpenAPI specification
│   ├── api-zod/             # Generated/request validation schemas
│   └── db/                  # Drizzle schema and database access
├── pnpm-workspace.yaml
└── package.json
```

## Contact

- **Email:** [mobicaresl00@gmail.com](mailto:mobicaresl00@gmail.com)
- **Phone:** [+232 75 726 975](tel:+23275726975)
- **Address:** 84 Sixth Road, Malama Lumley, Sierra Leone
