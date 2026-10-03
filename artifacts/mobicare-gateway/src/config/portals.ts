/**
 * Portal destinations — the single place to configure where the three
 * MobiCare portals live. Replace the placeholder URLs with the real
 * deployed URLs (e.g. https://app.mobicare.sl) when available.
 */
export const PORTALS = {
  patient: {
    name: 'Patient app',
    // The patient experience is part of this same site.
    loginUrl: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/app`,
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

/** MobiCare's one contact address: patients, pharmacies and legal questions. */
export const CONTACT_EMAIL = 'mobicaresl00@gmail.com';

/**
 * "Request to become a partner" opens the pharmacy's email app with the
 * details HQ needs to verify them already listed, so requests arrive complete.
 */
export const PARTNER_REQUEST_MAILTO = `mailto:${CONTACT_EMAIL}?${new URLSearchParams({
  subject: 'Pharmacy partner request',
  body: [
    'Hello MobiCare,',
    '',
    'We would like to join MobiCare as a partner pharmacy.',
    '',
    'Pharmacy name:',
    'Pharmacy Board licence number:',
    'Address (street, town, district):',
    'Contact person:',
    'Phone number:',
    'Opening hours:',
    'Do you offer delivery? (yes/no):',
    '',
    'Please attach a photo of your Pharmacy Board licence.',
  ].join('\n'),
}).toString().replace(/\+/g, '%20')}`;
