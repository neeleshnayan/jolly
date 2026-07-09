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
  };
  const prompt = buildMentorSystemPrompt(map as never, [], 1100, { index: 0, asked: [] });
  assert("previous-calls block present", prompt.includes("YOUR PREVIOUS CALLS") && prompt.includes("pull toward founding"));
  assert("call number correct (call 2)", prompt.includes("this is call 2"));
  assert("activity block present", prompt.includes("WHAT THEY'VE DONE SINCE") && prompt.includes("interviewing"));
  assert("ghosting shown honestly", prompt.includes("no response"));
  assert("relative dates humanized", /\d+ days ago|yesterday|earlier today/.test(prompt));
  const fresh = buildMentorSystemPrompt({ ...map, previousCalls: [], activity: [] } as never, [], 1100, { index: 0, asked: [] });
  assert("first call has NO continuity blocks", !fresh.includes("YOUR PREVIOUS CALLS") && !fresh.includes("DONE SINCE"));

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
