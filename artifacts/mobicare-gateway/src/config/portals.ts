/**
 * Portal destinations — the single place to configure where the three
 * MobiCare portals live. Replace the placeholder URLs with the real
 * deployed URLs (e.g. https://app.mobicare.sl) when available.
 */
export const PORTALS = {
  patient: {
    name: 'Patient app',
    loginUrl: 'https://app.mobicare.sl', // TODO: replace with real patient app URL
  },
  pharmacy: {
    name: 'Pharmacy portal',
    // Served from the same domain under path-based routing, so a
    // root-relative link works in both development and production.
    loginUrl: '/pharmacy-portal/',
  },
  hq: {
    name: 'MobiCare HQ dashboard',
    // The HQ dashboard is part of this same site.
    loginUrl: '/hq',
  },
} as const;

/** Contact path for pharmacies requesting to become a partner. */
export const PARTNER_CONTACT_EMAIL = 'partners@mobicare.sl';
