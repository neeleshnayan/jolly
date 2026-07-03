/**
 * The agent contract. An agent is a PURE unit of work: given an input and a
 * read-only context, it returns an output. It does NOT touch the database.
 * All persistence, source-stamping, and run-logging happen in the runner
 * (see run.ts). This is what makes agents testable and previewable
 * (produce-without-committing → the "auto-prepare, one-tap approve" flow).
 */

export interface AgentContext {
  userId: string;
  profileId?: string;
  meta?: Record<string, unknown>;
}

export interface AgentUsage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentResult<Output> {
  output: Output;
  usage?: AgentUsage;
  meta?: Record<string, unknown>;
}

export interface Agent<Input, Output> {
  name: string;
  run(input: Input, ctx: AgentContext): Promise<AgentResult<Output>>;
}
