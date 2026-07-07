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
  uniqueIndex,
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
  // auth identity — set when the user signs in with LinkedIn (OIDC `sub`). The
  // `userId` above stays the app's stable key; linkedinSub just maps a LinkedIn
  // login back to it.
  linkedinSub: text("linkedin_sub").unique(),
  avatarUrl: text("avatar_url"),
  fullName: text("full_name"),
  headline: text("headline"),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  links: jsonb("links").$type<{ label: string; url: string }[]>().default([]),
  // design tokens for the sheet (type scale, accent, font, density). Separate
  // from content so a human — or later an AI "re-paint" agent — can restyle the
  // résumé without touching the underlying facts. Missing keys fall back to
  // defaults in the editor.
  styleConfig: jsonb("style_config").$type<Record<string, string | number>>().default({}),
  // cached scoring vector — expensive to compute (big model), so we persist it
  // and only recompute after uploads / mentor calls or an explicit request.
  scoring: jsonb("scoring").$type<Record<string, unknown>>(),
  scoringAt: timestamp("scoring_at", { withTimezone: true }),
  // explicit, user-stated refinements for matching — concrete comp targets and
  // where/how they want to work. Fold into ranking on top of the scoring vector.
  preferences: jsonb("preferences")
    .$type<{
      currentComp?: number; // annual, in the résumé's currency (₹ here)
      expectedComp?: number;
      locations?: string[]; // preferred cities / regions
      remote?: "remote" | "hybrid" | "onsite" | "any";
    }>()
    .default({}),
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
  position: integer("position").default(0).notNull(),
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
  position: integer("position").default(0).notNull(),
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
  position: integer("position").default(0).notNull(),
  sourceId: uuid("source_id").references(() => sources.id),
  confidence: real("confidence").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const certifications = pgTable("certifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name"),
  issuer: text("issuer"),
  date: text("date"),
  position: integer("position").default(0).notNull(),
  sourceId: uuid("source_id").references(() => sources.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name"),
  description: text("description"),
  position: integer("position").default(0).notNull(),
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

// ----------------------------------------- mentor_probes (call steering)
// Non-obvious threads the résumé RAISES but doesn't answer — generated by the
// big model at upload time and handed to the mentor as specific things to
// explore on the call. `status` lets the refine loop mark them answered.

export const probeStatus = pgEnum("probe_status", ["open", "answered", "dismissed"]);

export const mentorProbes = pgTable("mentor_probes", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  question: text("question").notNull(), // as the mentor would ask it
  rationale: text("rationale"), // the thread it targets / why it matters
  dimension: insightDimension("dimension"), // which map dimension it aims to fill
  status: probeStatus("status").default("open").notNull(),
  sourceId: uuid("source_id").references(() => sources.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

// ---------------------------------------- résumé versioning (themes → versions)
// A THEME is a strategic angle on the same person ("Quant", "Founder", "PM",
// "AI"). A VERSION is a frozen snapshot of the résumé under a theme + the
// hypothesis it tests. APPLICATIONS record where a version was sent; EVENTS
// track the outcome funnel (later auto-updated by a Gmail connector).

export const resumeThemes = pgTable("resume_themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // what this angle emphasizes — free-form now; can become a vector later
  latentAttributes: jsonb("latent_attributes").$type<Record<string, unknown>>().default({}),
  // which version of this theme to use for applications (not always the latest)
  activeVersionId: uuid("active_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const resumeVersions = pgTable("resume_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  themeId: uuid("theme_id").references(() => resumeThemes.id, { onDelete: "set null" }),
  label: text("label"),
  hypothesis: text("hypothesis"), // the bet this version makes
  // frozen snapshot of the full profile + styleConfig at save time
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  company: text("company"),
  role: text("role"),
  resumeVersionId: uuid("resume_version_id").references(() => resumeVersions.id, {
    onDelete: "set null",
  }),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
    onDelete: "set null",
  }),
  coverLetterId: uuid("cover_letter_id"), // future
  status: text("status").default("applied").notNull(), // latest stage (denormalized)
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// the Outcome timeline — one row per stage change (applied → screen → interview
// → offer → rejected/ghosted). `source` records manual vs. a future gmail sync.
export const applicationEvents = pgTable("application_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  result: text("result"),
  source: text("source").default("manual").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ------------------------------------------------ opportunities (the role side)
// A job, vectorized into the candidate's scoring space. Hard facts live in
// columns (so we can FILTER in SQL); the full role vector + facts blob live in
// jsonb (for the matcher). Roles are global — matching is computed per user.

export const opportunitySource = pgEnum("opportunity_source", [
  "greenhouse",
  "lever",
  "ashby",
  "pasted",
  "sample",
  "other",
]);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: opportunitySource("source").default("pasted").notNull(),
    externalId: text("external_id"), // ATS job id, for dedup
    url: text("url"),
    company: text("company"),
    title: text("title"),
    location: text("location"),
    remote: text("remote"), // onsite | hybrid | remote | unknown
    compMin: integer("comp_min"),
    compMax: integer("comp_max"),
    companyStage: text("company_stage"), // startup | growth | enterprise | unknown
    domain: text("domain"),
    rawText: text("raw_text"), // the JD
    vector: jsonb("vector").$type<Record<string, unknown>>().default({}),
    facts: jsonb("facts").$type<Record<string, unknown>>().default({}),
    // null = fetched from a board but not yet vectorized (inference pending).
    // Lets the admin split cheap board-fetching from GPU-heavy inference.
    vectorizedAt: timestamp("vectorized_at", { withTimezone: true }),
    addedByProfileId: uuid("added_by_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // nulls stay distinct, so pasted/sample rows (external_id null) never collide;
    // board rows dedup on their ATS id. Blocks double-inserts from racing fetches.
    externalIdUniq: uniqueIndex("opportunities_external_id_uniq").on(t.externalId),
  }),
);

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
