/**
 * ONE canonical identity per skill — the hashmap that stops "typescript",
 * "TypeScript" and "K8s"/"Kubernetes" from being three different skills just
 * because different extraction models (or résumé authors) wrote them
 * differently.
 *
 *   canonSkillKey("K8s")        → "kubernetes"   (MATCHING key — always lowercase)
 *   displaySkill("kubernetes")  → "Kubernetes"   (what a person would PUT ON A RÉSUMÉ)
 *
 * Matching/aggregation/dedup always run on keys; UI always renders display
 * forms. Unknown skills fall back to per-word title case with an
 * acronym-aware word map ("data analysis" → "Data Analysis", "aws lambda" →
 * "AWS Lambda"), so nothing ever renders as raw lowercase.
 */

// spelling variants → one key (keys and values both in canonical-key form)
const ALIAS: Record<string, string> = {
  k8s: "kubernetes",
  postgres: "postgresql",
  golang: "go",
  "node js": "node.js",
  nodejs: "node.js",
  "next js": "next.js",
  nextjs: "next.js",
  reactjs: "react",
  "react js": "react",
  js: "javascript",
  ts: "typescript",
  cicd: "ci/cd",
  "ci cd": "ci/cd",
  "amazon web services": "aws",
  "google cloud platform": "gcp",
  "google cloud": "gcp",
  "large language models": "llms",
  llm: "llms",
  "machine learning ops": "mlops",
  "ml ops": "mlops",
  "user experience": "ux",
  "user interface": "ui",
  "a b testing": "a/b testing",
  "ab testing": "a/b testing",
};

// canonical key → exact résumé-ready display form. Only forms that per-word
// title case CANNOT produce (brand casing, acronyms, dotted names).
const CANON: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  "node.js": "Node.js",
  "next.js": "Next.js",
  "vue.js": "Vue.js",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  graphql: "GraphQL",
  grpc: "gRPC",
  "ci/cd": "CI/CD",
  devops: "DevOps",
  devsecops: "DevSecOps",
  mlops: "MLOps",
  sre: "SRE",
  aws: "AWS",
  gcp: "GCP",
  sql: "SQL",
  nosql: "NoSQL",
  html: "HTML",
  css: "CSS",
  php: "PHP",
  "c++": "C++",
  "c#": "C#",
  ".net": ".NET",
  ios: "iOS",
  api: "API",
  apis: "APIs",
  "rest apis": "REST APIs",
  "rest api": "REST API",
  rest: "REST",
  oauth: "OAuth",
  jwt: "JWT",
  llms: "LLMs",
  ai: "AI",
  ml: "ML",
  nlp: "NLP",
  rag: "RAG",
  etl: "ETL",
  bi: "BI",
  ux: "UX",
  ui: "UI",
  seo: "SEO",
  sem: "SEM",
  saas: "SaaS",
  b2b: "B2B",
  b2c: "B2C",
  gtm: "GTM",
  crm: "CRM",
  erp: "ERP",
  kpi: "KPI",
  kpis: "KPIs",
  okrs: "OKRs",
  pytorch: "PyTorch",
  tensorflow: "TensorFlow",
  scikit_learn: "scikit-learn",
  dbt: "dbt",
  slurm: "SLURM",
  hubspot: "HubSpot",
  powerpoint: "PowerPoint",
  "power bi": "Power BI",
  github: "GitHub",
  gitlab: "GitLab",
  linkedin: "LinkedIn",
  "a/b testing": "A/B Testing",
  hipaa: "HIPAA",
  gdpr: "GDPR",
  soc2: "SOC 2",
  "soc 2": "SOC 2",
};

// word-level canon for composing unknown phrases ("aws lambda" → "AWS Lambda")
const WORD: Record<string, string> = {
  aws: "AWS", gcp: "GCP", sql: "SQL", api: "API", apis: "APIs", ai: "AI", ml: "ML",
  nlp: "NLP", llm: "LLM", llms: "LLMs", ci: "CI", cd: "CD", ux: "UX", ui: "UI",
  seo: "SEO", saas: "SaaS", b2b: "B2B", b2c: "B2C", crm: "CRM", etl: "ETL",
  bi: "BI", gtm: "GTM", hr: "HR", qa: "QA", it: "IT", iot: "IoT", "ci/cd": "CI/CD",
};
// words that stay lowercase mid-phrase
const SMALL = new Set(["of", "and", "or", "for", "with", "in", "on", "to", "the", "a", "an", "via", "vs", "de"]);

/** Canonical MATCHING key: lowercase, whitespace/punct-normalized, alias-mapped. */
export function canonSkillKey(raw: string): string {
  let k = String(raw ?? "")
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/") // "ci / cd" → "ci/cd"
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/g, "")
    .trim();
  return ALIAS[k] ?? k;
}

/** Résumé-ready display form for a skill (idempotent; safe on any casing). */
export function displaySkill(raw: string): string {
  const key = canonSkillKey(raw);
  if (CANON[key]) return CANON[key];
  return key
    .split(" ")
    .map((w, i) => {
      if (WORD[w]) return WORD[w];
      if (i > 0 && SMALL.has(w)) return w;
      if (CANON[w]) return CANON[w];
      // keep intra-word punctuation ("ci/cd" handled above; "front-end" → "Front-End")
      return w
        .split("-")
        .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
        .join("-");
    })
    .join(" ");
}
