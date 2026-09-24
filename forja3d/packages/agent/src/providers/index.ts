import type { ForjaSettings, ProviderKind } from "../settings.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import type { LLMProvider } from "./types.ts";

export * from "./types.ts";
export * from "./pricing.ts";
export { AnthropicProvider, OpenAICompatibleProvider };

export function createProvider(settings: ForjaSettings, override?: { provider?: ProviderKind; model?: string }): LLMProvider {
  const kind = override?.provider ?? settings.provider;
  const model = override?.model ?? settings.model;
  const customPrice = { input: settings.customPriceInput, output: settings.customPriceOutput };
  switch (kind) {
    case "anthropic":
      return new AnthropicProvider({ model, apiKey: settings.anthropicApiKey, effort: settings.effort });
    case "ollama":
      return new OpenAICompatibleProvider({ id: "ollama", baseUrl: `${settings.ollamaUrl.replace(/\/+$/, "")}/v1`, model, price: { input: 0, output: 0 } });
    case "openai-compatible":
      if (!settings.openaiBaseUrl) throw new Error("Configura la URL base del proveedor compatible (Ajustes → Proveedor)");
      return new OpenAICompatibleProvider({ baseUrl: settings.openaiBaseUrl, model, apiKey: settings.openaiApiKey, price: customPrice });
    default:
      throw new Error(`Proveedor desconocido: ${kind}`);
  }
}

/** ¿Hay credenciales suficientes para usar este proveedor? */
export function providerReady(settings: ForjaSettings, kind: ProviderKind = settings.provider): { ready: boolean; reason?: string } {
  if (kind === "anthropic" && !settings.anthropicApiKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { ready: false, reason: "Falta la clave de API de Anthropic (Ajustes → Proveedor de IA)." };
  }
  if (kind === "openai-compatible" && !settings.openaiBaseUrl) return { ready: false, reason: "Falta la URL del proveedor compatible." };
  return { ready: true };
}
