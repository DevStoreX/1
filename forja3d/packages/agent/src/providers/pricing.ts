import type { Usage } from "./types.ts";

export interface TokenPrice {
  /** USD por millón de tokens de entrada */
  input: number;
  /** USD por millón de tokens de salida */
  output: number;
}

/** Precios públicos de referencia (USD / millón de tokens). Se pueden sobrescribir en Ajustes. */
export const CLAUDE_PRICES: Record<string, TokenPrice> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Búsqueda web del servidor de Claude: USD por búsqueda */
export const WEB_SEARCH_USD = 0.01;

export function costFromUsage(usage: Usage, price: TokenPrice | undefined): number {
  if (!price) return 0;
  const m = 1_000_000;
  return (
    (usage.inputTokens * price.input) / m +
    (usage.outputTokens * price.output) / m +
    ((usage.cacheReadTokens ?? 0) * price.input * 0.1) / m +
    ((usage.cacheWriteTokens ?? 0) * price.input * 1.25) / m +
    (usage.webSearches ?? 0) * WEB_SEARCH_USD
  );
}
