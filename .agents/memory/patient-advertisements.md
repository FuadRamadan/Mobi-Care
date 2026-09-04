---
name: Patient advertisements
description: Durable security, compatibility, and presentation rules for HQ-managed patient promotions.
---

Patient advertisements are HQ-curated, stored in App Storage, and publicly readable only while active and inside their optional schedule. Media URLs must enforce the same eligibility check as the feed and require cache revalidation.

**Why:** Hiding an ad from the listing is not enough if a remembered media URL still serves deactivated or expired content.

**How to apply:** Bind signed uploads to one active HQ account with short expiry and metadata verification. Keep media inaccessible after deactivation, scheduling expiry, or deletion, and audit every management write.

Use JPG, PNG, or WebP for images and MP4 for video across both web and native patient carousels. Only the selected slide may play video, always muted by default.

**Why:** WebM is not dependable on iOS, and hidden autoplaying slides waste bandwidth and device resources.

**How to apply:** Preserve the shared public ad feed across both patient clients, hide the carousel when empty, and keep promotions below the core medicine-search experience rather than as overlays.