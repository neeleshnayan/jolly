/**
 * The spine. Everything we build later reads from and writes to this.
 *
 * Three layers, one principle: separate the immutable (raw inputs) from the
 * derivable (structured resume + inferred understanding). Everything traces
 * back to a `source` so the mentor can later say "you told me X".
 *
 *   Layer 1 · sources        immutable log — evidence trail / replay path
 *   Layer 2 · profile+facts  known shape → relational → the editable resume
 *   Layer 3 · insights       soft/inferred → flexible → the evolving map
 *   Layer 4 · resume_variants derived projection (stubbed; filled later)
 *
 * See career-copilot-brief.md §11, §13 for the why.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  real,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------- enums

export const sourceKind = pgEnum("source_kind", [
  "resume_upload",
  "user_edit",
  "mentor_call",
  "system",
]);

export const insightDimension = pgEnum("insight_dimension", [
  "aspiration",
  "energizer",
  "drainer",
  "value",
  "constraint",
  "goal",
  "pattern",
  "blocker",
]);

export const insightStatus = pgEnum("insight_status", [
  "active",
  "superseded",
  "contradicted",
]);

// ---------------------------------------------------- Layer 2 · profile root
// One per user. `userId` maps to Supabase auth.users.id (no cross-schema FK
// on purpose — keeps migrations simple in v0).

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  fullName: text("full_name"),
  headline: text("headline"),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  links: jsonb("links").$type<{ label: string; url: string }[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ------------------------------------------------ Layer 1 · sources (immutable)
// Append-only. Never mutate a row. Every derived fact points back here.

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  kind: sourceKind("kind").notNull(),
  storagePath: text("storage_path"), // blob path for uploaded files
  rawText: text("raw_text"), // parsed resume text / transcript
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ------------------------------------------ Layer 2 · structured resume facts
// Known, stable shape → plain relational tables. The resume template is just a
// view over these. Dates are stored as text ("2021-03", "Present") because
// resumes are messy; add a normalized sort key later if needed.

export const experiences = pgTable("experiences", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  org: text("org"),
  title: text("title"),
  employmentType: text("employment_type"),
  location: text("location"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  isCurrent: boolean("is_current").default(false),
  bullets: jsonb("bullets")
    .$type<{ text: string; sourceId?: string }[]>()
    .default([]),
  sourceId: uuid("source_id").references(() => sources.id),
  confidence: real("confidence").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const education = pgTable("education", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  institution: text("institution"),
  degree: text("degree"),
  field: text("field"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  details: text("details"),
  sourceId: uuid("source_id").references(() => sources.id),
  confidence: real("confidence").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  level: text("level"),
  sourceId: uuid("source_id").references(() => sources.id),
  confidence: real("confidence").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name"),
  description: text("description"),
  links: jsonb("links").$type<{ label: string; url: string }[]>().default([]),
  bullets: jsonb("bullets").$type<{ text: string; sourceId?: string }[]>().default([]),
  sourceId: uuid("source_id").references(() => sources.id),
  confidence: real("confidence").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ------------------------------------------------ Layer 3 · insights (the map)
// Empty at v0 — the mentor fills this later. Built now so the spine exists and
// the mentor plugs in with zero migration. `confidence` + `lastConfirmedAt`
// make it *evolving*; supersession (never delete) turns contradictions into a
// feature (the hard-truth mechanic).

export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  dimension: insightDimension("dimension").notNull(),
  content: text("content").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().default({}),
  confidence: real("confidence").default(0.5),
  status: insightStatus("status").default("active").notNull(),
  sourceId: uuid("source_id").references(() => sources.id),
  supersedesId: uuid("supersedes_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ------------------------------------- Layer 4 · resume_variants (projection)
// Aspiration-aligned variants generated from the profile. Stubbed now; the
// alignment engine fills it once the mentor produces aspirations.

export const resumeVariants = pgTable("resume_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  label: text("label"),
  aspirationInsightId: uuid("aspiration_insight_id").references(() => insights.id),
  templateKey: text("template_key").default("default"),
  content: jsonb("content").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ------------------------------------------- agent_runs (observability layer)
// One row per agent invocation: what ran, on whom, how much it cost, how long,
// and whether it failed. This is your debugging + eval + cost surface, and the
// place the runner records every unit of agent work. Logging here never breaks
// the main path (best-effort writes).

export const agentRunStatus = pgEnum("agent_run_status", [
  "running",
  "success",
  "error",
]);

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").references(() => profiles.id, {
    onDelete: "cascade",
  }),
  agent: text("agent").notNull(),
  status: agentRunStatus("status").default("running").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  durationMs: integer("duration_ms"),
  error: text("error"),
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
