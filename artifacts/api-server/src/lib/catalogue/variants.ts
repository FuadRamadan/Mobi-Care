import type { DrugVariant } from "@workspace/db/schema";

/**
 * The strengths and forms a catalogue medicine comes in, and the combinations
 * of the two that exist. Shared by HQ's catalogue screens, the catalogue
 * upload, and every place a pharmacy lists stock, so all of them accept the
 * same things and save the same spelling.
 *
 * Text is compared ignoring capitals and repeated spaces: "tablet" and
 * "Tablet" are the same form. What is saved is the catalogue's spelling.
 */

export type { DrugVariant };

interface CatalogueLists {
  commonStrengths: string[];
  commonForms: string[];
  variants: DrugVariant[];
}

const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export function sameText(a: string, b: string): boolean {
  return key(a) === key(b);
}

/** Trimmed, single-spaced, without repeats that differ only in capitals. */
export function cleanList(values: string[]): string[] {
  const kept: string[] = [];
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (value && !kept.some((existing) => sameText(existing, value))) kept.push(value);
  }
  return kept;
}

/** A form with a capital first letter: "tablet" -> "Tablet". */
export function formatForm(form: string): string {
  const value = form.trim().replace(/\s+/g, " ");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function cleanForms(forms: string[]): string[] {
  return cleanList(forms).map(formatForm);
}

export function cleanVariants(variants: DrugVariant[]): DrugVariant[] {
  const kept: DrugVariant[] = [];
  for (const variant of variants) {
    const strength = variant.strength.trim().replace(/\s+/g, " ");
    const form = formatForm(variant.form);
    if (!strength || !form) continue;
    if (!kept.some((existing) => sameText(existing.strength, strength) && sameText(existing.form, form))) {
      kept.push({ strength, form });
    }
  }
  return kept;
}

/** Every strength in every form. */
export function allCombinations(strengths: string[], forms: string[]): DrugVariant[] {
  return forms.flatMap((form) => strengths.map((strength) => ({ strength, form })));
}

/** The combinations a medicine comes in; every pair when none are recorded. */
export function variantsOf(drug: CatalogueLists): DrugVariant[] {
  return drug.variants.length ? drug.variants : allCombinations(drug.commonStrengths, drug.commonForms);
}

/** True when the combinations are exactly every strength in every form. */
export function isEveryCombination(variants: DrugVariant[], strengths: string[], forms: string[]): boolean {
  const every = allCombinations(strengths, forms);
  return every.length === variants.length &&
    every.every((pair) => variants.some((variant) => sameText(variant.strength, pair.strength) && sameText(variant.form, pair.form)));
}

/**
 * The lists to save for a set of combinations. Strengths and forms are the
 * ones the combinations use; combinations covering every pair are saved as
 * empty, meaning "every strength in every form".
 */
export function listsFromVariants(variants: DrugVariant[]): CatalogueLists {
  const cleaned = cleanVariants(variants);
  const commonStrengths = cleanList(cleaned.map((variant) => variant.strength));
  const commonForms = cleanList(cleaned.map((variant) => variant.form));
  return {
    commonStrengths,
    commonForms,
    variants: isEveryCombination(cleaned, commonStrengths, commonForms) ? [] : cleaned,
  };
}

/**
 * New strength and form lists for an entry that may have combinations. Pairs
 * using a removed strength or form go; a newly added strength or form comes
 * in every form or strength, as it would on an entry without combinations.
 */
export function withLists(drug: CatalogueLists, strengths: string[], forms: string[]): CatalogueLists {
  const commonStrengths = cleanList(strengths);
  const commonForms = cleanForms(forms);
  if (!drug.variants.length) return { commonStrengths, commonForms, variants: [] };
  const isNew = (value: string, saved: string[]) => !saved.some((existing) => sameText(existing, value));
  const kept = drug.variants.filter(
    (variant) =>
      commonStrengths.some((strength) => sameText(strength, variant.strength)) &&
      commonForms.some((form) => sameText(form, variant.form)),
  );
  const added = allCombinations(commonStrengths, commonForms).filter(
    (pair) => isNew(pair.strength, drug.commonStrengths) || isNew(pair.form, drug.commonForms),
  );
  return listsFromVariants([...kept, ...added].map((variant) => ({
    strength: commonStrengths.find((strength) => sameText(strength, variant.strength))!,
    form: commonForms.find((form) => sameText(form, variant.form))!,
  })));
}

/** Adds combinations, never removing any. */
export function addVariants(drug: CatalogueLists, extra: DrugVariant[]): CatalogueLists {
  return listsFromVariants([...variantsOf(drug), ...extra]);
}

/**
 * Checks a listing's strength and form against its medicine. Returns the
 * catalogue's spelling of both, or why they are not accepted.
 *
 * A medicine with no strengths (or no forms) recorded accepts any.
 */
export function matchVariant(
  drug: CatalogueLists & { name: string },
  strength: string,
  form: string,
): { strength: string; form: string } | { error: string } {
  const savedStrength = drug.commonStrengths.length
    ? drug.commonStrengths.find((value) => sameText(value, strength))
    : strength.trim();
  if (savedStrength === undefined) {
    return { error: `Select a strength approved in the MobiCare catalogue. ${drug.name} comes in: ${drug.commonStrengths.join(", ")}.` };
  }
  const savedForm = drug.commonForms.length
    ? drug.commonForms.find((value) => sameText(value, form))
    : form.trim();
  if (savedForm === undefined) {
    return { error: `Select a form approved in the MobiCare catalogue. ${drug.name} comes as: ${drug.commonForms.join(", ")}.` };
  }
  if (drug.variants.length && !drug.variants.some((variant) => sameText(variant.strength, savedStrength) && sameText(variant.form, savedForm))) {
    const options = drug.variants.filter((variant) => sameText(variant.form, savedForm)).map((variant) => variant.strength);
    return {
      error: options.length
        ? `${drug.name} ${savedForm} does not come in ${savedStrength}. It comes in: ${options.join(", ")}.`
        : `${drug.name} is not approved as ${savedForm}.`,
    };
  }
  return { strength: savedStrength, form: savedForm };
}

/** "500mg Tablet, 125mg/5ml Syrup" */
export function describeVariants(variants: DrugVariant[]): string {
  return variants.map((variant) => `${variant.strength} ${variant.form}`).join(", ");
}
