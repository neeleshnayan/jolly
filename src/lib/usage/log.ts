/**
 * Spend log → agent_runs. The mentor turn (streamChat) and voice calls don't go
 * through runAgent, so their token/$ spend was invisible; this records it the
 * same way runAgent does. Fire-and-forget: a logging failure must NEVER break
 * the call (this runs on the live voice path).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, profiles } from "@/db/schema";
import type { Usage } from "@/llm";

export function logSpend(o: { userId?: string; agent: string; provider?: string; usage?: Usage | null; durationMs?: number }): void {
  void (async () => {
    try {
      let profileId: string | null = null;
      if (o.userId) {
        const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, o.userId)).limit(1);
        profileId = p?.id ?? null;
      }
      await db.insert(agentRuns).values({
        profileId,
        agent: o.agent,
        status: "success",
        model: o.usage?.model,
        inputTokens: o.usage?.inputTokens,
        outputTokens: o.usage?.outputTokens,
        costUsd: o.usage?.costUsd != null ? String(o.usage.costUsd) : null,
        durationMs: o.durationMs,
        finishedAt: new Date(),
        meta: { userId: o.userId, provider: o.provider },
      });
    } catch {
      /* observability must never break the request */
    }
  })();
}
