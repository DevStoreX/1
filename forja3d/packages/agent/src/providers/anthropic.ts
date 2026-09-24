import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_PRICES, costFromUsage, type TokenPrice } from "./pricing.ts";
import type { ChatMessage, ChatRequest, ChatResponse, ContentPart, LLMProvider, StopReason } from "./types.ts";

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaToolUnion = Anthropic.Beta.Messages.BetaToolUnion;

/** Modelos con pensamiento adaptativo y control de esfuerzo */
const ADAPTIVE = /^claude-(fable-5|mythos-5|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)/;
/** Modelos que admiten la búsqueda web con filtrado dinámico */
const WEB_SEARCH_DYNAMIC = /^claude-(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|fable-5)/;
/** Modelos con clasificadores de seguridad: activamos la reserva del servidor por defecto */
const SERVER_FALLBACK = /^claude-(opus-5|fable-5)/;

export interface AnthropicProviderOptions {
  model: string;
  apiKey?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  price?: TokenPrice;
  client?: Anthropic;
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly model: string;
  readonly supportsVision = true;
  readonly supportsWebSearch = true;
  private client: Anthropic;
  private useFallbacks: boolean;

  constructor(private opts: AnthropicProviderOptions) {
    this.model = opts.model;
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.useFallbacks = SERVER_FALLBACK.test(opts.model);
  }

  private toParam(msg: ChatMessage): BetaMessageParam {
    if (msg.role === "assistant" && msg.native?.provider === this.id && msg.native.model === this.model) {
      return { role: "assistant", content: msg.native.content as BetaContentBlockParam[] };
    }
    const content: BetaContentBlockParam[] = [];
    for (const part of msg.content) content.push(...this.partToBlocks(part));
    if (content.length === 0) content.push({ type: "text", text: "…" });
    return { role: msg.role, content };
  }

  private partToBlocks(part: ContentPart): BetaContentBlockParam[] {
    switch (part.type) {
      case "text":
        return part.text ? [{ type: "text", text: part.text }] : [];
      case "image":
        return [{ type: "image", source: { type: "base64", media_type: part.mime as "image/jpeg", data: part.data } }];
      case "tool_call":
        return [{ type: "tool_use", id: part.id, name: part.name, input: part.input as Record<string, unknown> }];
      case "tool_result": {
        const inner: ({ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } })[] = [
          { type: "text", text: part.content || "(sin salida)" },
        ];
        for (const img of part.images ?? []) inner.push({ type: "image", source: { type: "base64", media_type: img.mime as "image/jpeg", data: img.data } });
        return [{ type: "tool_result", tool_use_id: part.toolCallId, content: inner, is_error: part.isError }];
      }
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const tools: BetaToolUnion[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    if (req.webSearch) {
      tools.push(
        WEB_SEARCH_DYNAMIC.test(this.model)
          ? { type: "web_search_20260209", name: "web_search", max_uses: 5 }
          : { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      );
    }
    const params: BetaParams = {
      model: this.model,
      max_tokens: req.maxTokens ?? 32_000,
      system: req.system,
      messages: req.messages.map((m) => this.toParam(m)),
      tools,
      cache_control: { type: "ephemeral" },
    };
    if (ADAPTIVE.test(this.model)) {
      params.thinking = { type: "adaptive" };
      params.output_config = { effort: this.opts.effort ?? "high" };
    }
    if (this.useFallbacks) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    let message: Anthropic.Beta.Messages.BetaMessage | undefined;
    for (let attempt = 0; !message; attempt++) {
      const stream = this.client.beta.messages.stream(params, { signal: req.signal });
      if (req.onText) stream.on("text", (d) => req.onText!(d));
      try {
        message = await stream.finalMessage();
      } catch (err) {
        // Si la cuenta no admite la reserva del servidor, reintentamos sin ella.
        if (err instanceof Anthropic.BadRequestError && this.useFallbacks && /fallback/i.test(err.message)) {
          this.useFallbacks = false;
          delete params.betas;
          delete params.fallbacks;
          continue;
        }
        // Una entrada de herramienta con JSON ilegible (streaming ansioso): reintentamos el turno.
        if (err instanceof Anthropic.APIError || attempt >= 2) throw err;
      }
    }

    const content: ContentPart[] = [];
    for (const block of message.content) {
      if (block.type === "text") content.push({ type: "text", text: block.text });
      else if (block.type === "tool_use") content.push({ type: "tool_call", id: block.id, name: block.name, input: block.input });
    }
    const map: Record<string, StopReason> = { end_turn: "end_turn", tool_use: "tool_use", max_tokens: "max_tokens", refusal: "refusal", pause_turn: "pause_turn" };
    const u = message.usage;
    const usage = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      webSearches: u.server_tool_use?.web_search_requests ?? 0,
    };
    // La reserva puede haber respondido con otro modelo: cobramos según el que respondió.
    const servedBy = message.model ?? this.model;
    return {
      message: { role: "assistant", content, native: { provider: this.id, model: this.model, content: message.content } },
      stopReason: map[message.stop_reason ?? ""] ?? "other",
      usage,
      costUsd: costFromUsage(usage, this.opts.price ?? CLAUDE_PRICES[servedBy] ?? CLAUDE_PRICES[this.model]),
      model: servedBy,
    };
  }
}
