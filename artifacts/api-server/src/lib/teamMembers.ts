import { db, teamMembersTable } from "@workspace/db";

export const DEFAULT_TEAM_MEMBERS = [
  {
    slug: "abdullah-osman-koroma",
    name: "Dr. Abdullah Osman Koroma",
    role: "CEO & Founder",
    sortOrder: 1,
  },
  {
    slug: "fuad-ramadan-sesay",
    name: "Fuad Ramadan Sesay",
    role: "CIO",
    sortOrder: 2,
  },
  {
    slug: "alhaji-samura",
    name: "Alhaji Samura",
    role: "DevOps Engineer",
    sortOrder: 3,
  },
  {
    slug: "alpha-aziz-jalloh",
    name: "Pharm Alpha Aziz Jalloh",
    role: "Superintendent Pharmacist",
    sortOrder: 4,
  },
  {
    slug: "mamie-saio-johnson",
    name: "Pharm Mamie Saio Johnson",
    role: "Pharmacy Manager",
    sortOrder: 5,
  },
] as const;

/** Ensures the public roster exists without overwriting photos managed by HQ. */
export async function ensureTeamMembers(): Promise<void> {
  for (const member of DEFAULT_TEAM_MEMBERS) {
    await db
      .insert(teamMembersTable)
      .values(member)
      .onConflictDoNothing({ target: teamMembersTable.slug });
  }
}