/**
 * Sanity harness for hard-requirement gates (pure math, no DB).
 *   npx tsx tools/test-gates.ts
 */
import { deriveCandidateQuals, hardGate, parseYear } from "@/lib/opportunities/gates";

const assert = (name: string, cond: boolean) => {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`ok: ${name}`);
};

// ---- candidate derivation (shaped like Neelesh: B.Tech, working since 2019) ----
const cand = deriveCandidateQuals({
  experiences: [{ startDate: "June 2019" }, { startDate: "October 2019" }, { startDate: "July 2025" }],
  education: [{ degree: "B.Tech in Computer & Communication Engineering" }],
});
assert(`years derived from earliest start (got ${cand.yearsExperience})`, cand.yearsExperience === new Date().getFullYear() - 2019);
assert("bachelors detected from B.Tech", cand.credentials.has("bachelors"));
assert("no phantom PhD", !cand.credentials.has("phd"));
assert("parseYear handles '2019-06'", parseYear("2019-06") === 2019);
assert("parseYear null on garbage", parseYear("Present") === null);

// ---- credential gates ----
const g = (facts: Record<string, unknown>) => hardGate({ facts }, cand);
assert("PhD required → gated out", g({ required_credentials: ["phd"] }).pass === false);
assert("MD required → gated out", g({ required_credentials: ["md"] }).pass === false);
assert("bachelors required → passes", g({ required_credentials: ["bachelors"] }).pass === true);
assert("masters required → gated (only has bachelors)", g({ required_credentials: ["masters"] }).pass === false);
const phdCand = deriveCandidateQuals({ experiences: [], education: [{ degree: "PhD in Physics" }] });
assert("PhD holder passes masters requirement", hardGate({ facts: { required_credentials: ["masters"] } }, phdCand).pass === true);
assert("unknown credential strings ignored", g({ required_credentials: ["wizard"] }).pass === true);

// ---- years gates (candidate ≈ 7 yrs) ----
const yrs = cand.yearsExperience!;
assert("asks yrs-1 → clean pass, no chip", (() => { const r = g({ min_years_experience: yrs - 1 }); return r.pass && !("marginal" in r && r.marginal); })());
const marginal = g({ min_years_experience: yrs + 2 });
assert("asks yrs+2 → passes with penalty chip", marginal.pass === true && !!(marginal as { marginal?: unknown }).marginal);
assert("asks yrs+3 → gated out", g({ min_years_experience: yrs + 3 }).pass === false);
assert("no years on résumé → never year-gated", hardGate({ facts: { min_years_experience: 15 } }, { yearsExperience: null, credentials: new Set() }).pass === true);
assert("pre-gate-era row (no fields) → passes untouched", g({}).pass === true);

// ---- expanded taxonomy: licenses + new degrees ----
const lawyer = deriveCandidateQuals({
  experiences: [{ startDate: "2018" }],
  education: [{ degree: "LL.B, National Law School" }],
  certifications: [{ name: "Bar Council of India — admitted" }],
});
assert("LLB reads as jd", lawyer.credentials.has("jd"));
assert("bar admission detected from certifications", lawyer.credentials.has("bar"));
assert("lawyer passes a bar-required role", hardGate({ facts: { required_credentials: ["bar"] } }, lawyer).pass === true);
assert("engineer gated from bar-required role", g({ required_credentials: ["bar"] }).pass === false);

const accountant = deriveCandidateQuals({
  experiences: [],
  education: [{ degree: "B.Com" }],
  certifications: [{ name: "CPA", issuer: "AICPA" }, { name: "CFA Level II candidate" }],
});
assert("CPA detected", accountant.credentials.has("cpa"));
assert("CFA Level II candidate is NOT a charterholder", !accountant.credentials.has("cfa"));
assert("B.Com reads as bachelors", accountant.credentials.has("bachelors"));

const mbaHolder = deriveCandidateQuals({ experiences: [], education: [{ degree: "MBA, IIM Bangalore" }] });
assert("MBA satisfies masters requirement", hardGate({ facts: { required_credentials: ["masters"] } }, mbaHolder).pass === true);
assert("generic masters does NOT satisfy MBA requirement", hardGate({ facts: { required_credentials: ["mba"] } }, deriveCandidateQuals({ experiences: [], education: [{ degree: "M.Sc Physics" }] })).pass === false);
assert("MBBS reads as md", deriveCandidateQuals({ experiences: [], education: [{ degree: "MBBS" }] }).credentials.has("md"));
assert("nurse passes rn gate", hardGate({ facts: { required_credentials: ["rn"] } }, deriveCandidateQuals({ experiences: [], education: [], certifications: [{ name: "Registered Nurse license, State of NY" }] })).pass === true);
assert("alias 'bachelor's' resolves via ALIASES", g({ required_credentials: ["bachelor's"] }).pass === true);

console.log("\nall assertions passed ✓");
