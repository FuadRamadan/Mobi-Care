import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { hqStaffTable } from "./hqStaff";

export const apiConnectionsTable = pgTable("api_connections", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  displayName: text("display_name").notNull(),
  category: text("category").notNull(),
  credentialsEncrypted: text("credentials_encrypted"),
  publicConfig: jsonb("public_config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  isEnabled: boolean("is_enabled").notNull().default(false),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestStatus: text("last_test_status"),
  lastTestMessage: text("last_test_message"),
  updatedBy: uuid("updated_by").references(() => hqStaffTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ApiConnection = typeof apiConnectionsTable.$inferSelect;