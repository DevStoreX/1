import type { ModelRecord } from "@forja3d/core";
import { SYSTEM_PROMPT } from "./prompts.ts";
import type { ChatMessage, ContentPart, LLMProvider, StopReason } from "./providers/types.ts";
import { createModelTool, toolJsonSchema, type ForjaTool, type ToolContext, type ToolOutput } from "./tools/index.ts";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; isError: boolean; result: string }
  | { type: "model"; model: ModelRecord }
  | { type: "usage"; model: string; costUsd: number; totalCostUsd: number; inputTokens: number; outputTokens: number }
  | { type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { type: "done"; stopReason: StopReason | "max_steps" | "budget" | "error" };

export interface RunAgentOptions {
  provider: LLMProvider;
  history: ChatMessage[];
  user: ChatMessage;
  tools: ForjaTool[];
  ctx: ToolContext;
  emit: (e: AgentEvent) => void;
  maxSteps?: number;
  signal?: AbortSignal;
  webSearch?: boolean;
  system?: string;
}

export interface RunAgentResult {
  /** Mensajes nuevos (el de la persona incluido) para guardar en la conversación */
  messages: ChatMessage[];
  costUsd: number;
  stopReason: StopReason | "max_steps" | "budget" | "error";
}

const MAX_TOOL_OUTPUT = 30_000;
const MODEL_TOOLS = new Set(["create_model", "update_model", "generate_organic_mesh", "open_example"]);

async function runTool(tool: ForjaTool | undefined, name: string, input: unknown, ctx: ToolContext): Promise<ToolOutput> {
  if (!tool) return { content: `La herramienta ${name} no existe.`, isError: true };
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");
    return { content: `Entrada no válida para ${name}: ${issues}. Revisa los parámetros y vuelve a intentarlo.`, isError: true };
  }
  try {
    const out = await tool.run(parsed.data, ctx);
    return out.content.length > MAX_TOOL_OUTPUT ? { ...out, content: `${out.content.slice(0, MAX_TOOL_OUTPUT)}\n…(recortado)` } : out;
  } catch (e) {
    return { content: `Error ejecutando ${name}: ${(e as Error).message}`, isError: true };
  }
}

/** Extrae el último bloque ```openscad del texto (para modelos locales que no usan herramientas). */
export function extractScadBlock(text: string): string | null {
  const blocks = [...text.matchAll(/```(?:openscad|scad)\s*\n([\s\S]*?)```/gi)];
  return blocks.length ? blocks[blocks.length - 1][1].trim() : null;
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { provider, ctx, emit } = opts;
  const maxSteps = opts.maxSteps ?? 16;
  const toolsByName = new Map(opts.tools.map((t) => [t.name, t]));
  const specs = opts.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: toolJsonSchema(t) }));
  const newMessages: ChatMessage[] = [opts.user];
  const all = () => [...opts.history, ...newMessages];
  let total = 0;
  let modelToolUsed = false;
  let fallbackAttempts = 0;

  // El callback onModel del contexto también avisa a la interfaz
  const toolCtx: ToolContext = {
    ...ctx,
    onModel: (m) => {
      ctx.onModel?.(m);
      emit({ type: "model", model: m });
    },
  };

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) return { messages: newMessages, costUsd: total, stopReason: "error" };
    const budget = ctx.settings.monthlyBudgetUsd;
    if (budget > 0) {
      const usage = await ctx.store.usage();
      if (usage.last30dUsd >= budget) {
        emit({ type: "notice", level: "warning", message: `Se alcanzó el límite de gasto de ${budget} USD en los últimos 30 días. Súbelo en Ajustes o usa un modelo local gratuito.` });
        emit({ type: "done", stopReason: "budget" });
        return { messages: newMessages, costUsd: total, stopReason: "budget" };
      }
    }

    const res = await provider.chat({
      system: opts.system ?? SYSTEM_PROMPT,
      messages: all(),
      tools: specs,
      onText: (delta) => emit({ type: "text", delta }),
      signal: opts.signal,
      webSearch: opts.webSearch && provider.supportsWebSearch,
    });
    total += res.costUsd;
    await ctx.recordUsage?.({
      kind: "llm",
      provider: provider.id,
      model: res.model,
      inputTokens: res.usage.inputTokens + (res.usage.cacheReadTokens ?? 0) + (res.usage.cacheWriteTokens ?? 0),
      outputTokens: res.usage.outputTokens,
      costUsd: res.costUsd,
      conversationId: ctx.conversationId,
    });
    emit({ type: "usage", model: res.model, costUsd: res.costUsd, totalCostUsd: total, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens });
    newMessages.push(res.message);

    const calls = res.message.content.filter((p): p is Extract<ContentPart, { type: "tool_call" }> => p.type === "tool_call");

    if (res.stopReason === "refusal") {
      emit({ type: "notice", level: "warning", message: "El modelo declinó esta petición." });
      emit({ type: "done", stopReason: "refusal" });
      return { messages: newMessages, costUsd: total, stopReason: "refusal" };
    }
    if (res.stopReason === "pause_turn") continue;
    if (res.stopReason === "max_tokens" && calls.length) {
      emit({ type: "notice", level: "error", message: "La respuesta se cortó por longitud antes de terminar una herramienta. Pide una pieza más simple o divide la tarea." });
      emit({ type: "done", stopReason: "max_tokens" });
      return { messages: newMessages, costUsd: total, stopReason: "max_tokens" };
    }

    if (calls.length === 0) {
      // Respaldo para modelos locales: si escribió OpenSCAD sin usar herramientas, lo compilamos.
      const text = res.message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
      const scad = !res.message.native && !modelToolUsed ? extractScadBlock(text) : null;
      if (scad && fallbackAttempts < 3) {
        fallbackAttempts++;
        const id = `auto_${step}`;
        emit({ type: "tool_start", id, name: "create_model", input: { name: "Diseño", scad_code: scad } });
        const out = await runTool(createModelTool as ForjaTool, "create_model", { name: "Diseño", scad_code: scad }, toolCtx);
        emit({ type: "tool_end", id, name: "create_model", isError: !!out.isError, result: out.content });
        if (!out.isError) {
          modelToolUsed = true;
          res.message.content.push({ type: "text", text: "\n\n(Forja compiló el código automáticamente.)" });
        } else if (step + 1 < maxSteps) {
          newMessages.push({ role: "user", content: [{ type: "text", text: `[Forja] Tu código OpenSCAD no compiló:\n${out.content}\nCorrígelo y responde con el código completo en un bloque \`\`\`openscad.` }] });
          continue;
        }
      }
      emit({ type: "done", stopReason: res.stopReason });
      return { messages: newMessages, costUsd: total, stopReason: res.stopReason };
    }

    const results = await Promise.all(
      calls.map(async (call) => {
        emit({ type: "tool_start", id: call.id, name: call.name, input: call.input });
        const out = await runTool(toolsByName.get(call.name), call.name, call.input, toolCtx);
        if (MODEL_TOOLS.has(call.name) && !out.isError) modelToolUsed = true;
        emit({ type: "tool_end", id: call.id, name: call.name, isError: !!out.isError, result: out.content });
        return { type: "tool_result" as const, toolCallId: call.id, content: out.content, isError: out.isError, images: out.images };
      }),
    );
    // Todos los resultados en un único mensaje (así el modelo sigue usando herramientas en paralelo)
    newMessages.push({ role: "user", content: results });
  }

  emit({ type: "notice", level: "warning", message: "Se alcanzó el máximo de pasos para una respuesta. Escribe «continúa» para seguir." });
  emit({ type: "done", stopReason: "max_steps" });
  return { messages: newMessages, costUsd: total, stopReason: "max_steps" };
}
