/**
 * Demo mentors — realistic mock data so Mentor Connect demos with a living
 * circle instead of an empty state. Idempotent (keyed on demo emails);
 * `--remove` cleans every trace.
 *   npx tsx tools/seed-demo-mentors.ts          # seed
 *   npx tsx tools/seed-demo-mentors.ts --remove # clean up
 *
 * Transitions are chosen to overlap a founder/fintech edge (the canonical
 * demo profile) so matching visibly works: banking→founder, fintech→PM,
 * consulting→product, engineer→founder, marketing→growth.
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

const DEMO_MENTORS = [
  {
    email: "demo+arjun@drizzle.local",
    fullName: "Arjun Mehta",
    headline: "Founder & CEO at Finlayer (ex-Goldman Sachs)",
    location: "Bengaluru, India",
    mentor: {
      headline: "Banker → fintech founder, twice",
      journey: "My path: Analyst at Goldman Sachs → VP at Razorpay → Founder & CEO at Finlayer. Left banking after six years for the zero-to-one life — happy to talk honestly about what that jump costs and pays.",
      expertise: ["fintech", "payments", "fundraising", "zero-to-one", "b2b sales"],
      transitions: [
        { from: "Analyst at Goldman Sachs", to: "VP Product at Razorpay" },
        { from: "VP Product at Razorpay", to: "Founder & CEO at Finlayer" },
      ],
      languages: "English, Hindi",
      timezone: "IST",
      availability: "part-time",
      feeHr: null, // founding mentor
    },
  },
  {
    email: "demo+priya@drizzle.local",
    fullName: "Priya Raghavan",
    headline: "Product Lead at Stripe (ex-McKinsey)",
    location: "London, UK",
    mentor: {
      headline: "Consultant → PM at a payments giant",
      journey: "My path: Associate at McKinsey → PM at Flipkart → Product Lead at Stripe. The consulting-to-product jump is the one everyone asks me about — there is a playbook.",
      expertise: ["product management", "payments", "strategy", "interviews", "case to PM"],
      transitions: [
        { from: "Associate at McKinsey", to: "Product Manager at Flipkart" },
        { from: "Product Manager at Flipkart", to: "Product Lead at Stripe" },
      ],
      languages: "English, Tamil",
      timezone: "GMT",
      availability: "occasionally",
      feeHr: 4000,
    },
  },
  {
    email: "demo+dev@drizzle.local",
    fullName: "Dev Sharma",
    headline: "CTO at Loopwork (ex-Google)",
    location: "Bengaluru, India",
    mentor: {
      headline: "Staff engineer → startup CTO",
      journey: "My path: SWE at Google → Staff Engineer at Google → CTO at Loopwork. Engineering leadership at a 40-person startup is a different sport from big tech — I coach that switch.",
      expertise: ["engineering leadership", "architecture", "hiring", "ai infra", "startup engineering"],
      transitions: [
        { from: "Staff Engineer at Google", to: "CTO at Loopwork" },
      ],
      languages: "English, Hindi",
      timezone: "IST",
      availability: "open",
      feeHr: null,
    },
  },
  {
    email: "demo+sana@drizzle.local",
    fullName: "Sana Kapoor",
    headline: "VP Growth at Meesho (ex-Unilever)",
    location: "Bengaluru, India",
    mentor: {
      headline: "Brand marketing → startup growth",
      journey: "My path: Brand Manager at Unilever → Growth Lead at Cred → VP Growth at Meesho. FMCG discipline plus startup speed is a rare mix — I help marketers make the leap.",
      expertise: ["growth", "marketing", "brand", "consumer", "retention"],
      transitions: [
        { from: "Brand Manager at Unilever", to: "Growth Lead at Cred" },
        { from: "Growth Lead at Cred", to: "VP Growth at Meesho" },
      ],
      languages: "English, Hindi",
      timezone: "IST",
      availability: "part-time",
      feeHr: 3000,
    },
  },
  {
    email: "demo+james@drizzle.local",
    fullName: "James Okafor",
    headline: "Design Director at Monzo (ex-agency)",
    location: "London, UK",
    mentor: {
      headline: "Agency designer → fintech design leadership",
      journey: "My path: Designer at a London agency → Senior Product Designer at Monzo → Design Director at Monzo. In-house product design is a craft change, not just a title change.",
      expertise: ["product design", "design systems", "fintech ux", "portfolio reviews", "design leadership"],
      transitions: [
        { from: "Designer at Huge London", to: "Senior Product Designer at Monzo" },
        { from: "Senior Product Designer at Monzo", to: "Design Director at Monzo" },
      ],
      languages: "English",
      timezone: "GMT",
      availability: "occasionally",
      feeHr: 60,
    },
  },
];

async function main() {
  loadEnvLocal();
  const { db } = await import("@/db");
  const { profiles, mentorProfiles } = await import("@/db/schema");
  const { eq, like } = await import("drizzle-orm");
  const { randomUUID } = await import("node:crypto");

  if (process.argv.includes("--remove")) {
    const demos = await db.select({ id: profiles.id, email: profiles.email }).from(profiles).where(like(profiles.email, "demo+%@drizzle.local"));
    for (const d of demos) {
      await db.delete(profiles).where(eq(profiles.id, d.id)); // mentor_profiles cascade
      console.log(`- removed ${d.email}`);
    }
    console.log(`Removed ${demos.length} demo mentor(s).`);
    process.exit(0);
  }

  for (const m of DEMO_MENTORS) {
    const [existing] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, m.email)).limit(1);
    let profileId = existing?.id;
    if (!profileId) {
      const [p] = await db
        .insert(profiles)
        .values({ userId: randomUUID(), email: m.email, fullName: m.fullName, headline: m.headline, location: m.location })
        .returning({ id: profiles.id });
      profileId = p.id;
    }
    await db
      .insert(mentorProfiles)
      .values({ profileId, ...m.mentor, contactEmail: m.email, active: true })
      .onConflictDoUpdate({ target: mentorProfiles.profileId, set: { ...m.mentor, contactEmail: m.email, active: true, updatedAt: new Date() } });
    console.log(`+ ${m.fullName} — ${m.mentor.headline}`);
  }
  console.log(`\nSeeded ${DEMO_MENTORS.length} demo mentors. Remove with: npx tsx tools/seed-demo-mentors.ts --remove`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
