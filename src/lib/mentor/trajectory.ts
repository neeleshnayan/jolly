/**
 * The growth trajectory — the memory that makes drizzle magical.
 * Not chat history: EVOLUTION. "May: wanted FAANG → June: realized ownership
 * mattered more → July: applied to Series A companies." Derived from what we
 * already store (dated insights + approved call recaps), zero new writes,
 * fully recomputable — the arc is an interpretation, never a second source
 * of truth.
 *
 * One milestone per month: the strongest stance-signal of that month
 * (aspiration > value > goal > energizer > call recap's opening thought).
 */

export type TrajectoryPoint = { period: string; line: string; kind: string };

type DatedInsight = { dimension: string; content: string; createdAt: Date | string };
type DatedCall = { summary: string; createdAt: Date | string };

const STANCE_RANK: Record<string, number> = { aspiration: 5, value: 4, goal: 3, energizer: 2, pattern: 1 };

const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

export function buildTrajectory(insights: DatedInsight[], calls: DatedCall[]): TrajectoryPoint[] {
  type Candidate = { at: number; line: string; kind: string; rank: number };
  const byPeriod = new Map<string, Candidate>();

  // adaptive granularity: a relationship in its first month grows day by day;
  // month buckets would hide the arc exactly when it's forming
  const allDates = [...insights.map((i) => new Date(i.createdAt)), ...calls.map((c) => new Date(c.createdAt))];
  const months = new Set(allDates.map((d) => `${d.getFullYear()}-${d.getMonth()}`));
  const periodOf = (d: Date | string) => {
    const date = new Date(d);
    return months.size >= 2
      ? date.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
      : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  const consider = (period: string, c: Candidate) => {
    const cur = byPeriod.get(period);
    // stronger stance wins; same rank → the more recent voice of that month
    if (!cur || c.rank > cur.rank || (c.rank === cur.rank && c.at > cur.at)) byPeriod.set(period, c);
  };

  for (const i of insights) {
    const rank = STANCE_RANK[i.dimension] ?? 0;
    if (!rank || !i.content?.trim()) continue;
    consider(periodOf(i.createdAt), { at: new Date(i.createdAt).getTime(), line: clip(i.content.trim()), kind: i.dimension, rank });
  }
  for (const c of calls) {
    const first = (c.summary ?? "").split(/(?<=[.!?])\s+/)[0]?.trim();
    if (!first) continue;
    // a recap is the fallback voice of a month — below any real stance insight
    consider(periodOf(c.createdAt), { at: new Date(c.createdAt).getTime(), line: clip(first), kind: "conversation", rank: 0.5 });
  }

  return [...byPeriod.entries()]
    .map(([period, c]) => ({ period, line: c.line, kind: c.kind, at: c.at }))
    .sort((a, b) => a.at - b.at)
    .slice(-6) // the recent arc; ancient history lives in the full map
    .map(({ period, line, kind }) => ({ period, line, kind }));
}
