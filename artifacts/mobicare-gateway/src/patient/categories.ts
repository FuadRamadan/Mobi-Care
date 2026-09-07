/**
 * Patient-facing presentation for the drug category taxonomy.
 *
 * The taxonomy itself lives in the database schema and reaches the app through
 * the API — that is the source of truth for which categories exist and what
 * they are formally called. This adds two things on top, for patients rather
 * than pharmacists:
 *
 *   An emoji, so a category is recognisable before it is read. On a phone, a
 *   wall of clinical text is slow to scan; a shape is instant.
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

interface CategoryPresentation {
  emoji: string;
  /** Short patient-facing name. Omit to use the API's label. */
  short?: string;
}

const PRESENTATION: Record<string, CategoryPresentation> = {
  cardiovascular: { emoji: "❤️", short: "Heart & blood pressure" },
  pain_inflammation: { emoji: "🤕", short: "Pain & fever" },
  // Malaria is named explicitly: it is the most searched-for treatment here,
  // and "Anti-infectives" is not what anyone types.
  anti_infectives: { emoji: "🦠", short: "Infections & malaria" },
  gastrointestinal_nutrition: { emoji: "🍎", short: "Stomach & nutrition" },
  endocrine_reproductive: { emoji: "🤰", short: "Diabetes & women's health" },
  respiratory_allergy: { emoji: "🫁", short: "Chest & allergy" },
  psychiatric_mental_health: { emoji: "🧠", short: "Mental health" },
  blood_products_plasma_expanders: { emoji: "🩸", short: "Blood products" },
  other: { emoji: "🧪", short: "Other medicines" },
};

const FALLBACK: CategoryPresentation = { emoji: "💊" };

export function categoryEmoji(value: string): string {
  return (PRESENTATION[value] ?? FALLBACK).emoji;
}

/** The short name where there is one, otherwise whatever the API called it. */
export function categoryLabel(value: string, apiLabel: string): string {
  return PRESENTATION[value]?.short ?? apiLabel;
}
