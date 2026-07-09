/**
 * Verify call continuity + the capability seam without a live call.
 *   npx tsx tools/test-continuity.ts
 * 1. buildMentorSystemPrompt with a synthetic returning-caller map (pure).
 * 2. capabilityBrief against the REAL ranked pool (read-only) — does naming a
 *    role from the user's matches produce a dossier?
 */
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') || v.startsWith("'")) {
      const q = v[0];
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      const hash = v.indexOf(" #");
      if (hash >= 0) v = v.slice(0, hash).trim();
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const assert = (name: string, cond: boolean) => {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`ok: ${name}`);
};

async function main() {
  loadEnvLocal();
  const { buildMentorSystemPrompt } = await import("@/agents/mentor/prompt");
  const { capabilityBrief } = await import("@/agents/mentor/capabilities");

  // ---- 1. continuity blocks (pure) ----
  const map = {
    profile: { fullName: "Test Person", headline: "PM" },
    experiences: [{ title: "PM", org: "Acme" }],
    insights: [{ dimension: "energizer", content: "building from zero", confidence: 0.8 }],
    probes: [],
    previousCalls: [{ summary: "We explored their pull toward founding; agreed to look at three product roles.", createdAt: new Date(Date.now() - 3 * 86400000) }],
    activity: [
      { company: "Anthropic", role: "Incident Response Manager", status: "interview", lastResult: null, appliedAt: new Date(Date.now() - 2 * 86400000) },
      { company: "Stripe", role: "PM", status: "ghosted", lastResult: "No response after interview", appliedAt: new Date(Date.now() - 9 * 86400000) },
    ],
    trajectory: [
      { period: "May 2026", line: "Wanted a FAANG title above all", kind: "goal" },
      { period: "Jun 2026", line: "Realized ownership matters more than compensation", kind: "value" },
      { period: "Jul 2026", line: "Applying to Series A companies with real scope", kind: "goal" },
    ],
  };
  const prompt = buildMentorSystemPrompt(map as never, [], 1100, { index: 0, asked: [] });
  assert("previous-calls block present", prompt.includes("YOUR PREVIOUS CALLS") && prompt.includes("pull toward founding"));
  assert("call number correct (call 2)", prompt.includes("this is call 2"));
  assert("activity block present", prompt.includes("WHAT THEY'VE DONE SINCE") && prompt.includes("interviewing"));
  assert("ghosting shown honestly", prompt.includes("no response"));
  assert("relative dates humanized", /\d+ days ago|yesterday|earlier today/.test(prompt));
  const fresh = buildMentorSystemPrompt({ ...map, previousCalls: [], activity: [], trajectory: [] } as never, [], 1100, { index: 0, asked: [] });
  assert("first call has NO continuity blocks", !fresh.includes("YOUR PREVIOUS CALLS") && !fresh.includes("DONE SINCE"));
  assert("growth arc present with ≥2 points", prompt.includes("THEIR GROWTH ARC") && prompt.includes("Wanted a FAANG title"));
  assert("arc coaches naming the shift", prompt.includes("NAME a shift"));
  assert("no arc on a fresh relationship", !fresh.includes("GROWTH ARC"));

  // trajectory derivation (pure): stance-ranked, adaptive granularity
  const { buildTrajectory } = await import("@/lib/mentor/trajectory");
  const multiMonth = buildTrajectory(
    [
      { dimension: "goal", content: "Wanted FAANG", createdAt: "2026-05-10" },
      { dimension: "value", content: "Ownership over comp", createdAt: "2026-06-12" },
      { dimension: "energizer", content: "weaker signal same month", createdAt: "2026-06-13" },
    ],
    [{ summary: "Explored Series A options. More detail here.", createdAt: "2026-07-01" }],
  );
  assert("one point per month, stance outranks energizer", multiMonth.length === 3 && multiMonth[1].line.includes("Ownership"));
  assert("months labeled across months", /May 2026/.test(multiMonth[0].period));
  const sameMonth = buildTrajectory(
    [
      { dimension: "goal", content: "A", createdAt: "2026-07-08" },
      { dimension: "value", content: "B", createdAt: "2026-07-09" },
    ],
    [],
  );
  assert("day granularity inside one month", sameMonth.length === 2 && /8 Jul/.test(sameMonth[0].period));

  // ---- 2. capability seam against the real pool (read-only) ----
  // dynamic: name the user's CURRENT top match, so the test survives pool churn
  const userId = "80f8584f-99b0-403e-82e5-fa4d1cee9eb2";
  const { rankMatches } = await import("@/lib/opportunities/recommend");
  const top = (await rankMatches(userId))[0];
  assert("ranked pool non-empty", !!top?.title);
  const brief = await capabilityBrief(userId, [
    { role: "assistant", content: "What's been on your mind?" },
    { role: "user", content: `I keep thinking about that ${top.title} role at ${top.company} — am I even ready for it?` },
  ]);
  assert("dossier fired on a named role", brief.includes("LIVE BRIEF"));
  assert("dossier names the role", brief.toLowerCase().includes((top.title ?? "").toLowerCase()));
  assert("dossier carries requirements", brief.includes("WHAT THE SCREEN ASKS FOR"));
  assert("dossier coaches prep", brief.includes("HOW TO PREP"));
  const silent = await capabilityBrief(userId, [{ role: "user", content: "I had a nice weekend with family." }]);
  assert("no dossier on small talk", silent === "");

  console.log("\nall assertions passed ✓");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
