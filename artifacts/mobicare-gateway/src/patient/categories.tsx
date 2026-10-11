/**
 * Patient-facing presentation for the drug category taxonomy.
 *
 * The taxonomy itself lives in the database schema and reaches the app through
 * the API — that is the source of truth for which categories exist and what
 * they are formally called. This adds two things on top, for patients rather
 * than pharmacists:
 *
 *   An icon, so a category is recognisable before it is read. Line icons rather
 *   than emoji: emoji render differently on every device, carry a cartoon tone
 *   that sits badly next to medicine, and cannot be made to match the rest of
 *   the interface, which is drawn entirely in this icon set.
 *
 *   A shorter, plainer name. "Pain, inflammation & anaesthesia" is correct and
 *   unhelpful to someone looking for paracetamol. Where a category is named in
 *   the words patients actually use — "Pain & fever", "Infections & malaria" —
 *   it is easier to find.
 *
 * Anything not listed here still works: it falls back to the API's own label
 * with a neutral icon, so a category added at HQ never disappears from the app
 * while waiting for this file to catch up.
 */

import {
  Baby,
  Brain,
  Bug,
  Droplet,
  Ear,
  Eye,
  Hand,
  HeartPulse,
  Pill,
  Ribbon,
  ShieldAlert,
  Syringe,
  Thermometer,
  Wind,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * A stomach, drawn on the same 24px grid and stroke as the icons above
 * (the set has none): the food pipe at the top, the J-shaped bag, and the
 * exit to the gut on the right.
 */
const Stomach = createLucideIcon("stomach", [
  ["path", { d: "M9 2v3C6 5.2 3.5 7.6 3.5 11.5c0 5 4 9 9 9 3.6 0 6.5-2 7.4-5", key: "outer" }],
  ["path", { d: "M12.5 2v4c0 3 1.6 5.5 4 5.5 1.4 0 2.6.4 3.3 1.3", key: "inner" }],
  ["path", { d: "M19.8 12.8h1.7M19.9 15.5h1.6", key: "exit" }],
]);

interface CategoryPresentation {
  icon: LucideIcon;
  /** Short patient-facing name. Omit to use the API's label. */
  short?: string;
}

const PRESENTATION: Record<string, CategoryPresentation> = {
  cardiovascular: { icon: HeartPulse, short: "Heart & blood pressure" },
  pain_inflammation: { icon: Thermometer, short: "Pain & fever" },
  // Malaria is named explicitly: it is the most searched-for treatment here,
  // and "Anti-infectives" is not what anyone types.
  anti_infectives: { icon: Bug, short: "Infections & malaria" },
  gastrointestinal_nutrition: { icon: Stomach, short: "Gastro & nutrition" },
  endocrine_reproductive: { icon: Baby, short: "Diabetes & women's health" },
  respiratory_allergy: { icon: Wind, short: "Chest & allergy" },
  psychiatric_mental_health: { icon: Brain, short: "Mental health" },
  blood_products_plasma_expanders: { icon: Droplet, short: "Blood products" },
  antidotes_poisoning: { icon: ShieldAlert, short: "Poisoning & antidotes" },
  cancer_immunosuppressants: { icon: Ribbon, short: "Cancer care" },
  vaccines_immunologicals: { icon: Syringe, short: "Vaccines" },
  eye_preparations: { icon: Eye, short: "Eye care" },
  skin_preparations: { icon: Hand, short: "Skin care" },
  ear_nose_throat: { icon: Ear, short: "Ear, nose & throat" },
  other: { icon: Pill, short: "Other medicines" },
};

const FALLBACK: CategoryPresentation = { icon: Pill };

export function categoryIcon(value: string): LucideIcon {
  return (PRESENTATION[value] ?? FALLBACK).icon;
}

/** The short name where there is one, otherwise whatever the API called it. */
export function categoryLabel(value: string, apiLabel: string): string {
  return PRESENTATION[value]?.short ?? apiLabel;
}
