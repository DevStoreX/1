export type ProviderKind = "anthropic" | "ollama" | "openai-compatible";

export interface ModelPreset {
  id: string;
  label: string;
  provider: ProviderKind;
  model: string;
  description: string;
}

/** Atajos para elegir calidad y costo con un clic. */
export const MODEL_PRESETS: ModelPreset[] = [
  { id: "max", label: "Máxima calidad", provider: "anthropic", model: "claude-opus-5", description: "Claude Opus 5: el mejor diseñando piezas complejas. ~$5/$25 por millón de tokens." },
  { id: "balanced", label: "Equilibrado", provider: "anthropic", model: "claude-sonnet-5", description: "Claude Sonnet 5: muy buen diseño a menos de la mitad del costo." },
  { id: "cheap", label: "Económico", provider: "anthropic", model: "claude-haiku-4-5", description: "Claude Haiku 4.5: rápido y barato para piezas sencillas y preguntas." },
  { id: "local", label: "Gratis (en tu computadora)", provider: "ollama", model: "qwen3:8b", description: "Modelo abierto con Ollama. Costo $0; la calidad depende de tu equipo." },
];

export interface ForjaSettings {
  language: "es" | "en";
  kidMode: boolean;
  provider: ProviderKind;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  anthropicApiKey?: string;
  ollamaUrl: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  /** Precio por millón de tokens para proveedores genéricos (0 = gratis/local) */
  customPriceInput: number;
  customPriceOutput: number;
  webSearch: boolean;
  /** Detector de la cámara: "vision" usa el modelo de visión; "obico" el servidor ML gratuito */
  cameraDetector: "vision" | "obico";
  visionProvider: ProviderKind;
  visionModel: string;
  obicoUrl?: string;
  falKey?: string;
  hunyuanUrl?: string;
  thingiverseToken?: string;
  currency: string;
  defaultMaterial: string;
  defaultPrinterProfile: string;
  filamentPricePerKg?: number;
  electricityPerKwh: number;
  laborPerHour: number;
  marginPercent: number;
  platformFeePercent: number;
  /** Límite de gasto mensual en IA (USD). 0 = sin límite. */
  monthlyBudgetUsd: number;
}

export const DEFAULT_SETTINGS: ForjaSettings = {
  language: "es",
  kidMode: false,
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  ollamaUrl: "http://localhost:11434",
  customPriceInput: 0,
  customPriceOutput: 0,
  webSearch: true,
  cameraDetector: "vision",
  visionProvider: "anthropic",
  visionModel: "claude-haiku-4-5",
  currency: "USD",
  defaultMaterial: "PLA",
  defaultPrinterProfile: "bambu-a1",
  electricityPerKwh: 0.15,
  laborPerHour: 5,
  marginPercent: 40,
  platformFeePercent: 0,
  monthlyBudgetUsd: 0,
};

/** Campos secretos: nunca se devuelven completos al navegador. */
export const SECRET_KEYS = ["anthropicApiKey", "openaiApiKey", "falKey", "thingiverseToken"] as const;

/** Lee la configuración del entorno (útil en Docker y en el servidor MCP). */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<ForjaSettings> {
  const s: Partial<ForjaSettings> = {};
  if (env.FORJA_PROVIDER) s.provider = env.FORJA_PROVIDER as ProviderKind;
  if (env.FORJA_MODEL) s.model = env.FORJA_MODEL;
  if (env.ANTHROPIC_API_KEY) s.anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (env.OLLAMA_URL) s.ollamaUrl = env.OLLAMA_URL;
  if (env.OPENAI_BASE_URL) s.openaiBaseUrl = env.OPENAI_BASE_URL;
  if (env.OPENAI_API_KEY) s.openaiApiKey = env.OPENAI_API_KEY;
  if (env.FAL_KEY) s.falKey = env.FAL_KEY;
  if (env.HUNYUAN3D_URL) s.hunyuanUrl = env.HUNYUAN3D_URL;
  if (env.THINGIVERSE_TOKEN) s.thingiverseToken = env.THINGIVERSE_TOKEN;
  if (env.OBICO_ML_URL) s.obicoUrl = env.OBICO_ML_URL;
  if (env.FORJA_CURRENCY) s.currency = env.FORJA_CURRENCY;
  return s;
}

export function maskSecret(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return v.length <= 8 ? "••••" : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

export function publicSettings(s: ForjaSettings): Omit<ForjaSettings, (typeof SECRET_KEYS)[number]> & { secrets: Record<string, string | undefined> } {
  const copy: Record<string, unknown> = { ...s };
  const secrets: Record<string, string | undefined> = {};
  for (const k of SECRET_KEYS) {
    secrets[k] = maskSecret(s[k]);
    delete copy[k];
  }
  return { ...(copy as Omit<ForjaSettings, (typeof SECRET_KEYS)[number]>), secrets };
}
