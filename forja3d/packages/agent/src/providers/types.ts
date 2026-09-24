export interface ImagePart {
  type: "image";
  mime: string;
  /** base64 sin prefijo data: */
  data: string;
}

export type ContentPart =
  | { type: "text"; text: string }
  | ImagePart
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean; images?: ImagePart[] };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentPart[];
  /**
   * Contenido nativo del proveedor (bloques de pensamiento, fallbacks, búsquedas web...).
   * Se reenvía sin cambios cuando se sigue usando el mismo proveedor y modelo.
   */
  native?: { provider: string; model: string; content: unknown };
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
  /** Permite al modelo buscar en la web (si el proveedor lo soporta) */
  webSearch?: boolean;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "other";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearches?: number;
}

export interface ChatResponse {
  message: ChatMessage;
  stopReason: StopReason;
  usage: Usage;
  costUsd: number;
  model: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  readonly supportsVision: boolean;
  readonly supportsWebSearch: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export function textOf(msg: ChatMessage): string {
  return msg.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("");
}
