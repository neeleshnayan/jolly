import type { LLMProvider } from "./types";
import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";

/**
 * Select the provider via LLM_PROVIDER ("ollama" | "anthropic").
 * Defaults to anthropic (safe for prod); set LLM_PROVIDER=ollama for free local
 * dev. Later this can route by task — cheap local for high-volume steps, Claude
 * for user-facing quality.
 */
export function getProvider(): LLMProvider {
  const name = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  switch (name) {
    case "ollama":
      return ollamaProvider;
    case "anthropic":
      return anthropicProvider;
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${name}`);
  }
}

export * from "./types";
