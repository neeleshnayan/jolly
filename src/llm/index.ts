import type { LLMProvider } from "./types";
import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";
import { openrouterProvider } from "./openrouter";
import { cloudflareProvider } from "./cloudflare";

const PROVIDERS: Record<string, LLMProvider> = {
  ollama: ollamaProvider,
  anthropic: anthropicProvider,
  openrouter: openrouterProvider,
  cloudflare: cloudflareProvider,
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
  // Clean dev/prod demarcation: localhost → ollama (local, free); Cloudflare →
  // openrouter (no ollama in a Worker). DEPLOY_TARGET is the ONE switch; an
  // explicit LLM_PROVIDER / LLM_PROVIDER_<TASK> still overrides it.
  const envDefault = process.env.DEPLOY_TARGET === "cloudflare" ? "openrouter" : "ollama";
  const name = (specific ?? process.env.LLM_PROVIDER ?? envDefault).toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown LLM provider: ${name}`);
  return withLocalFallback(provider);
}

/**
 * Demo safety net: when a request/response task is routed to a cloud provider
 * (e.g. cover letters → OpenRouter), a network blip or outage would otherwise
 * throw and break the flow. Wrap extractStructured so it degrades to the local
 * model instead — best case frontier quality, worst case what we had before.
 * Streaming (the live voice mentor) is NOT wrapped: it stays local by config,
 * and a mid-stream swap can't be seamless anyway. Disable with
 * LLM_FALLBACK_LOCAL=false.
 */
function withLocalFallback(primary: LLMProvider): LLMProvider {
  // On Cloudflare there IS no local ollama (falling back to localhost:11434 gets a
  // CF 1003), so never wrap the fallback there — a primary failure must surface,
  // not chase an unreachable host. This is what broke "redesign with AI" on prod.
  if (primary.name === "ollama" || process.env.DEPLOY_TARGET === "cloudflare" || process.env.LLM_FALLBACK_LOCAL === "false") return primary;
  return {
    ...primary,
    async extractStructured(req) {
      try {
        return await primary.extractStructured(req);
      } catch (e) {
        console.warn(`[llm] ${primary.name} failed — falling back to local ollama:`, e instanceof Error ? e.message : e);
        // strip any cloud-specific model id so ollama uses its own default
        return ollamaProvider.extractStructured({ ...req, model: undefined });
      }
    },
  };
}

/** Explicit provider selection for A/B testing (e.g. the mentor-call debug
 *  toggle). Returns null for unknown names — callers fall back to getProvider. */
export function getProviderByName(name?: string | null): LLMProvider | null {
  return name ? (PROVIDERS[name.toLowerCase()] ?? null) : null;
}

export * from "./types";
