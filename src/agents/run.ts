/**
 * The runner. Wraps every agent invocation with observability (an `agent_runs`
 * row) and timing. This is the ONE place that records agent work — orchestration
 * elsewhere is just plain async functions calling `runAgent`.
 *
 * Observability is best-effort: a logging failure must never break the agent.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import type { Agent, AgentContext, AgentResult } from "./types";

export async function runAgent<I, O>(
  agent: Agent<I, O>,
  input: I,
  ctx: AgentContext,
): Promise<AgentResult<O>> {
  const started = Date.now();
  let runId: string | undefined;

  // Log every run, not just ones tied to a profile — worker/system calls
  // (job vectorization, etc.) have no profileId but still cost real tokens,
  // and the admin ROI view needs to see that spend too. `userId` is stashed in
  // meta so "worker" runs are still identifiable without a profile row.
  try {
    const [row] = await db
      .insert(agentRuns)
      .values({
        profileId: ctx.profileId ?? null,
        agent: agent.name,
        status: "running",
        meta: { userId: ctx.userId, ...ctx.meta },
      })
      .returning({ id: agentRuns.id });
    runId = row.id;
  } catch {
    /* observability must not break the main path */
  }

  try {
    const result = await agent.run(input, ctx);

    if (runId) {
      try {
        await db
          .update(agentRuns)
          .set({
            status: "success",
            model: result.usage?.model,
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            costUsd: result.usage?.costUsd != null ? String(result.usage.costUsd) : null,
            durationMs: Date.now() - started,
            finishedAt: new Date(),
            meta: { userId: ctx.userId, ...ctx.meta, ...result.meta },
          })
          .where(eq(agentRuns.id, runId));
      } catch {
        /* ignore */
      }
    }

    return result;
  } catch (err) {
    if (runId) {
      try {
        await db
          .update(agentRuns)
          .set({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - started,
            finishedAt: new Date(),
          })
          .where(eq(agentRuns.id, runId));
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}
