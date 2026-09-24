import { costFromUsage, type TokenPrice } from "./pricing.ts";
import type { ChatMessage, ChatRequest, ChatResponse, ContentPart, LLMProvider, StopReason } from "./types.ts";

/**
 * Cliente genérico de "chat completions" para modelos que NO son de Anthropic:
 * Ollama y LM Studio (gratis, en tu computadora), OpenRouter, DeepSeek, Groq, etc.
 */
export interface OpenAICompatibleOptions {
  id?: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  price?: TokenPrice;
  supportsVision?: boolean;
  fetchImpl?: typeof fetch;
}

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly model: string;
  readonly supportsVision: boolean;
  readonly supportsWebSearch = false;

  constructor(private opts: OpenAICompatibleOptions) {
    this.id = opts.id ?? "openai-compatible";
    this.model = opts.model;
    this.supportsVision = opts.supportsVision ?? true;
  }

  private toWire(system: string, messages: ChatMessage[]): WireMessage[] {
    const out: WireMessage[] = [{ role: "system", content: system }];
    for (const m of messages) {
      if (m.role === "assistant") {
        const text = m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
        const calls = m.content.filter((p): p is Extract<ContentPart, { type: "tool_call" }> => p.type === "tool_call");
        out.push({
          role: "assistant",
          content: text || null,
          tool_calls: calls.length ? calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) : undefined,
        });
        continue;
      }
      const parts: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [];
      for (const p of m.content) {
        if (p.type === "tool_result") {
          out.push({ role: "tool", tool_call_id: p.toolCallId, content: (p.isError ? "ERROR: " : "") + p.content });
          if (p.images?.length && this.supportsVision) {
            parts.push({ type: "text", text: "Imagen devuelta por la herramienta:" });
            for (const img of p.images) parts.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.data}` } });
          }
        } else if (p.type === "text") parts.push({ type: "text", text: p.text });
        else if (p.type === "image" && this.supportsVision) parts.push({ type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data}` } });
      }
      if (parts.length) {
        const onlyText = parts.every((p) => p.type === "text");
        out.push({ role: "user", content: onlyText ? parts.map((p) => (p as { text: string }).text).join("\n") : parts });
      }
    }
    return out;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const f = this.opts.fetchImpl ?? fetch;
    const body = {
      model: this.model,
      messages: this.toWire(req.system, req.messages),
      tools: req.tools.length
        ? req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
        : undefined,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: req.maxTokens ?? 8192,
    };
    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    let res: Response;
    try {
      res = await f(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new Error(`No se pudo conectar con ${this.opts.baseUrl} (${(e as Error).message}). ¿Está en marcha${this.id === "ollama" ? " Ollama (ollama serve)" : " el servidor"}?`);
    }
    if (!res.ok || !res.body) {
      throw new Error(`${this.id} respondió HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
    }

    let text = "";
    const calls: { id: string; name: string; args: string }[] = [];
    let finish = "";
    let usage = { inputTokens: 0, outputTokens: 0 };
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = res.body.getReader();
    const handle = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let chunk: {
        choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      for (const choice of chunk.choices ?? []) {
        const d = choice.delta ?? {};
        if (d.content) {
          text += d.content;
          req.onText?.(d.content);
        }
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? calls.length;
          calls[i] ??= { id: tc.id ?? `call_${i}_${Date.now()}`, name: "", args: "" };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name) calls[i].name += tc.function.name;
          if (tc.function?.arguments) calls[i].args += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
    }
    if (buffer) handle(buffer);

    const content: ContentPart[] = [];
    if (text) content.push({ type: "text", text });
    for (const c of calls.filter(Boolean)) {
      let input: unknown = {};
      try {
        input = c.args ? JSON.parse(c.args) : {};
      } catch {
        input = { __invalid_json: c.args };
      }
      content.push({ type: "tool_call", id: c.id, name: c.name, input });
    }
    const hasCalls = content.some((p) => p.type === "tool_call");
    const stopReason: StopReason = hasCalls ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end_turn";
    return {
      message: { role: "assistant", content },
      stopReason,
      usage,
      costUsd: costFromUsage(usage, this.opts.price),
      model: this.model,
    };
  }
}
