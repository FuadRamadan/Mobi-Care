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
    loginUrl: 'https://pharmacy.mobicare.sl', // TODO: replace with real pharmacy portal URL
  },
  hq: {
    name: 'MobiCare HQ dashboard',
    loginUrl: 'https://hq.mobicare.sl', // TODO: replace with real HQ dashboard URL
  },
} as const;

/** Contact path for pharmacies requesting to become a partner. */
export const PARTNER_CONTACT_EMAIL = 'partners@mobicare.sl';
