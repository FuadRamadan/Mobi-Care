import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { hqStaffTable } from "./hqStaff";

export const savedApiRequestsTable = pgTable("saved_api_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  method: text("method").notNull(),
  authType: text("auth_type").notNull().default("none"),
  authConfigEncrypted: text("auth_config_encrypted"),
  params: jsonb("params").$type<Array<{ key: string; value: string }>>().notNull().default([]),
  headers: jsonb("headers").$type<Array<{ key: string; value: string }>>().notNull().default([]),
  paramsEncrypted: text("params_encrypted"),
  headersEncrypted: text("headers_encrypted"),
  body: text("body"),
  createdBy: uuid("created_by").references(() => hqStaffTable.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => hqStaffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const savedApiRequestHistoryTable = pgTable("saved_api_request_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => savedApiRequestsTable.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => hqStaffTable.id, { onDelete: "set null" }),
  method: text("method").notNull(),
  url: text("url").notNull(),
  status: integer("status"),
  durationMs: integer("duration_ms").notNull(),
  responseHeaders: jsonb("response_headers").$type<Record<string, string>>().notNull().default({}),
  responseBody: text("response_body"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});