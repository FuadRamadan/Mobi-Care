import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/** Integer platform configuration, deliberately avoiding floating-point money. */
export const platformSettingsTable = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PlatformSetting = typeof platformSettingsTable.$inferSelect;