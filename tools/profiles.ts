/**
 * Shared archetype profiles for the offline ranking harnesses. ONE definition of
 * each synthetic candidate (scoring vector + résumé skills + the natural-text
 * direction production embeds) so tools/match-sanity.ts (pool-scan) and
 * tools/anchors.ts (frozen-fixture regression) agree on who they're testing.
 *
 * The pure-multiplier archetypes (comp-maximizer, location-locked) are NOT here —
 * comp/location are recommend.ts factors OUTSIDE scoreMatch+blend, so they're
 * exercised by component unit checks at the recommend layer, not these harnesses.
 */
type P = { score: number; rationale: string };
const p = (score: number): P => ({ score, rationale: "" });

export type Profile = {
  key: string;
  name: string;
  vector: Record<string, P>;
  skills: string[]; // résumé-proven, lowercase (evidence input)
  direction: string; // NATURAL text → embedding trajectory (what production uses)
};

export const PROFILES: Profile[] = [
  {
    key: "senior_ic",
    name: "senior backend IC (builder)",
    vector: {
      seniority: p(0.75), leadership_inclination: p(0.15), technical_depth: p(0.9), breadth: p(0.5),
      builder_energy: p(0.9), people_energy: p(0.2), autonomy_need: p(0.8), impact_drive: p(0.7),
      comp_priority: p(0.6), risk_tolerance: p(0.5), growth_vs_stability: p(0.7), pivot_appetite: p(0.2),
    },
    skills: ["python", "go", "kubernetes", "distributed systems", "postgresql", "aws", "terraform", "grpc"],
    direction: "Target role: Staff Backend Engineer. Build reliable distributed systems and services end to end, own backend infrastructure at scale.",
  },
  {
    key: "eng_manager",
    name: "engineering manager (people-first)",
    vector: {
      seniority: p(0.8), leadership_inclination: p(0.9), technical_depth: p(0.55), breadth: p(0.7),
      builder_energy: p(0.3), people_energy: p(0.9), autonomy_need: p(0.7), impact_drive: p(0.8),
      comp_priority: p(0.6), risk_tolerance: p(0.4), growth_vs_stability: p(0.6), pivot_appetite: p(0.3),
    },
    skills: ["engineering management", "hiring", "roadmap planning", "mentoring", "agile", "cross-functional collaboration"],
    direction: "Target role: Engineering Manager. Lead and grow an engineering team, own delivery, hiring, and people development.",
  },
  {
    key: "sales_ae",
    name: "enterprise sales AE",
    vector: {
      seniority: p(0.6), leadership_inclination: p(0.3), technical_depth: p(0.2), breadth: p(0.6),
      builder_energy: p(0.2), people_energy: p(0.7), autonomy_need: p(0.7), impact_drive: p(0.7),
      comp_priority: p(0.85), risk_tolerance: p(0.5), growth_vs_stability: p(0.7), pivot_appetite: p(0.3),
    },
    skills: ["enterprise sales", "salesforce", "pipeline management", "negotiation", "prospecting", "saas sales", "account management"],
    direction: "Target role: Enterprise Account Executive. Close large SaaS deals, own a revenue number, build relationships with executive buyers.",
  },
  {
    key: "marketer",
    name: "product marketer",
    vector: {
      seniority: p(0.6), leadership_inclination: p(0.4), technical_depth: p(0.25), breadth: p(0.7),
      builder_energy: p(0.45), people_energy: p(0.5), autonomy_need: p(0.6), impact_drive: p(0.7),
      comp_priority: p(0.5), risk_tolerance: p(0.5), growth_vs_stability: p(0.7), pivot_appetite: p(0.35),
    },
    skills: ["product marketing", "positioning", "content strategy", "campaigns", "seo", "brand marketing", "copywriting"],
    direction: "Target role: Product Marketing Lead. Positioning, messaging, go-to-market campaigns, and brand storytelling.",
  },
  {
    key: "junior_analyst",
    name: "junior data analyst",
    vector: {
      seniority: p(0.25), leadership_inclination: p(0.1), technical_depth: p(0.5), breadth: p(0.4),
      builder_energy: p(0.6), people_energy: p(0.3), autonomy_need: p(0.5), impact_drive: p(0.5),
      comp_priority: p(0.5), risk_tolerance: p(0.4), growth_vs_stability: p(0.8), pivot_appetite: p(0.4),
    },
    skills: ["sql", "excel", "tableau", "python", "data analysis", "dashboards"],
    direction: "Target role: Data Analyst, early career. SQL, dashboards, and turning data into business insight.",
  },
  // ---- edge cases (anchors harness) ----
  {
    key: "overqualified_staff",
    name: "over-qualified staff eng (casting wide)",
    vector: {
      seniority: p(0.9), leadership_inclination: p(0.2), technical_depth: p(0.95), breadth: p(0.6),
      builder_energy: p(0.85), people_energy: p(0.2), autonomy_need: p(0.85), impact_drive: p(0.8),
      comp_priority: p(0.7), risk_tolerance: p(0.5), growth_vs_stability: p(0.6), pivot_appetite: p(0.2),
    },
    skills: ["python", "go", "rust", "distributed systems", "kubernetes", "compilers", "postgresql", "aws"],
    direction: "Target role: Staff or Principal Engineer. Deep systems work, technical direction, hardest problems.",
  },
  {
    key: "career_changer",
    name: "marketer pivoting to PM",
    vector: {
      seniority: p(0.55), leadership_inclination: p(0.4), technical_depth: p(0.35), breadth: p(0.75),
      builder_energy: p(0.55), people_energy: p(0.6), autonomy_need: p(0.6), impact_drive: p(0.8),
      comp_priority: p(0.55), risk_tolerance: p(0.55), growth_vs_stability: p(0.8), pivot_appetite: p(0.85),
    },
    skills: ["product marketing", "positioning", "user research", "roadmap planning", "analytics", "stakeholder management"],
    direction: "Target role: Product Manager. Own a product area, translate user needs into roadmap, work with engineering to ship.",
  },
  {
    key: "generalist",
    name: "cross-functional generalist / chief-of-staff",
    vector: {
      seniority: p(0.7), leadership_inclination: p(0.6), technical_depth: p(0.5), breadth: p(0.95),
      builder_energy: p(0.5), people_energy: p(0.6), autonomy_need: p(0.8), impact_drive: p(0.85),
      comp_priority: p(0.6), risk_tolerance: p(0.7), growth_vs_stability: p(0.85), pivot_appetite: p(0.5),
    },
    skills: ["operations", "strategy", "program management", "analytics", "stakeholder management", "cross-functional collaboration"],
    direction: "Target role: Chief of Staff or BizOps lead. Own cross-functional initiatives end to end across a fast-scaling org.",
  },
];

export const profileByKey = (key: string): Profile => {
  const found = PROFILES.find((p) => p.key === key);
  if (!found) throw new Error(`unknown profile: ${key}`);
  return found;
};
