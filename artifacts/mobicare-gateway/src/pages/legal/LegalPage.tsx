import type { ReactNode } from 'react';
import { CONTACT_EMAIL } from '@/config/portals';

/** Shared layout for the privacy notice and terms of service. */

export const LEGAL_CONTACT_EMAIL = CONTACT_EMAIL;
export const LEGAL_UPDATED = '3 October 2026';

export function LegalPage({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-background">
      <div className="container mx-auto px-4 py-12 md:py-16 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">MobiCare · Last updated {LEGAL_UPDATED}</p>
        <h1 className="font-display font-bold text-3xl md:text-4xl text-dark-green mt-2 mb-4">{title}</h1>
        <div className="text-muted-foreground leading-relaxed">{intro}</div>
        <div className="mt-10 space-y-10">{children}</div>
      </div>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display font-semibold text-xl text-dark-green">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}

export function ContactLink() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-primary font-medium hover:underline">
      {LEGAL_CONTACT_EMAIL}
    </a>
  );
}
