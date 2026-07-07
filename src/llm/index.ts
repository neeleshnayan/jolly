import type { LLMProvider } from "./types";
import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";
import { openrouterProvider } from "./openrouter";

const PROVIDERS: Record<string, LLMProvider> = {
  ollama: ollamaProvider,
  anthropic: anthropicProvider,
  openrouter: openrouterProvider,
};

/**
 * Select the LLM provider. `task` enables per-task routing so we can spend on
 * quality where it matters (the mentor) while keeping bulk work local + free:
 *   LLM_PROVIDER_MENTOR=openrouter   → mentor calls use OpenRouter
 * Falls back to LLM_PROVIDER, then "ollama". Nothing changes until those envs
 * are set, so the default stays local + free.
 */
export function getProvider(task?: string): LLMProvider {
  const specific = task ? process.env[`LLM_PROVIDER_${task.toUpperCase()}`] : undefined;
  const name = (specific ?? process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown LLM provider: ${name}`);
  return provider;
}

/** Explicit provider selection for A/B testing (e.g. the mentor-call debug
 *  toggle). Returns null for unknown names — callers fall back to getProvider. */
export function getProviderByName(name?: string | null): LLMProvider | null {
  return name ? (PROVIDERS[name.toLowerCase()] ?? null) : null;
}

export * from "./types";
