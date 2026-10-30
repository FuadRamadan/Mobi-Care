/**
 * Patient-facing names and icons for the drug categories, as on the web app
 * (patient/categories.tsx). The taxonomy itself comes from the API; anything
 * not listed here falls back to the API's own label with a pill icon.
 */
import type { ComponentProps } from "react";
import type { MaterialCommunityIcons } from "@expo/vector-icons";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const PRESENTATION: Record<string, { icon: IconName; short?: string }> = {
  cardiovascular: { icon: "heart-pulse", short: "Heart & blood pressure" },
  pain_inflammation: { icon: "thermometer", short: "Pain & fever" },
  anti_infectives: { icon: "bug-outline", short: "Infections & malaria" },
  gastrointestinal_nutrition: { icon: "stomach", short: "Gastro & nutrition" },
  endocrine_reproductive: { icon: "baby-face-outline", short: "Diabetes & women's health" },
  respiratory_allergy: { icon: "weather-windy", short: "Chest & allergy" },
  psychiatric_mental_health: { icon: "brain", short: "Mental health" },
  blood_products_plasma_expanders: { icon: "water-outline", short: "Blood products" },
  antidotes_poisoning: { icon: "shield-alert-outline", short: "Poisoning & antidotes" },
  cancer_immunosuppressants: { icon: "ribbon", short: "Cancer care" },
  vaccines_immunologicals: { icon: "needle", short: "Vaccines" },
  eye_preparations: { icon: "eye-outline", short: "Eye care" },
  skin_preparations: { icon: "hand-back-right-outline", short: "Skin care" },
  ear_nose_throat: { icon: "ear-hearing", short: "Ear, nose & throat" },
  other: { icon: "pill", short: "Other medicines" },
};

export function categoryIcon(value: string): IconName {
  return PRESENTATION[value]?.icon ?? "pill";
}

/** The short name where there is one, otherwise whatever the API called it. */
export function categoryLabel(value: string, apiLabel: string): string {
  return PRESENTATION[value]?.short ?? apiLabel;
}
