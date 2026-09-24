import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CameraMonitor, PrinterManager, Store, shutdownCad } from "@forja3d/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALL_TOOLS,
  AnthropicProvider,
  DEFAULT_SETTINGS,
  ModelService,
  OpenAICompatibleProvider,
  extractScadBlock,
  runAgent,
  toolJsonSchema,
  type AgentEvent,
  type ChatRequest,
  type ChatResponse,
  type LLMProvider,
  type ToolContext,
} from "../src/index.ts";

const SCAD = `// Ancho del soporte
ancho = 40; // [20:1:80]
/* [Hidden] */
$fn = 48;
difference() { cube([ancho, 20, 10]); translate([ancho/2, 10, -1]) cylinder(d = 5, h = 12); }`;

class ScriptedProvider implements LLMProvider {
  readonly id = "fake";
  readonly model = "fake-1";
  readonly supportsVision = true;
  readonly supportsWebSearch = false;
  requests: ChatRequest[] = [];
  constructor(private script: ((req: ChatRequest) => Omit<ChatResponse, "usage" | "costUsd" | "model">)[]) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(structuredClone({ ...req, onText: undefined, signal: undefined }));
    const next = this.script.shift();
    if (!next) throw new Error("script agotado");
    const r = next(req);
    for (const p of r.message.content) if (p.type === "text") req.onText?.(p.text);
    return { ...r, usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.001, model: this.model };
  }
}

let dir = "";
let ctx: ToolContext;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "forja-agent-"));
  const store = new Store(dir);
  const settings = { ...DEFAULT_SETTINGS };
  ctx = {
    store,
    models: new ModelService(store, async () => settings),
    printers: new PrinterManager(),
    monitor: new CameraMonitor(),
    settings,
    attachments: [],
    recordUsage: (e) => store.addUsage(e),
  };
});

afterAll(async () => {
  await shutdownCad();
  await rm(dir, { recursive: true, force: true });
});

describe("herramientas", () => {
  it("todas tienen esquema JSON de tipo objeto", () => {
    for (const t of ALL_TOOLS) {
      const s = toolJsonSchema(t);
      expect(s.type, t.name).toBe("object");
      expect(s.$schema).toBeUndefined();
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(new Set(ALL_TOOLS.map((t) => t.name)).size).toBe(ALL_TOOLS.length);
  });
});

describe("bucle del agente", () => {
  it("crea un modelo con la herramienta, lo modifica y responde", async () => {
    const events: AgentEvent[] = [];
    let modelId = "";
    const provider = new ScriptedProvider([
      () => ({ stopReason: "tool_use", message: { role: "assistant", content: [{ type: "text", text: "Voy a diseñarlo." }, { type: "tool_call", id: "t1", name: "create_model", input: { name: "Soporte", scad_code: SCAD } }] } }),
      (req) => {
        const last = req.messages.at(-1)!;
        const result = last.content[0];
        expect(result.type).toBe("tool_result");
        const data = JSON.parse((result as { content: string }).content);
        modelId = data.model_id;
        expect(data.size_mm[0]).toBeCloseTo(40, 0);
        expect(data.parameters[0]).toMatchObject({ name: "ancho", value: 40, min: 20, max: 80 });
        return { stopReason: "tool_use", message: { role: "assistant", content: [{ type: "tool_call", id: "t2", name: "update_model", input: { model_id: modelId, parameters: { ancho: 60 } } }] } };
      },
      (req) => {
        const data = JSON.parse((req.messages.at(-1)!.content[0] as { content: string }).content);
        expect(data.size_mm[0]).toBeCloseTo(60, 0);
        expect(data.version).toBe(2);
        return { stopReason: "end_turn", message: { role: "assistant", content: [{ type: "text", text: "¡Listo! Tu soporte mide 60 mm." }] } };
      },
    ]);
    const r = await runAgent({ provider, history: [], user: { role: "user", content: [{ type: "text", text: "Hazme un soporte" }] }, tools: ALL_TOOLS, ctx, emit: (e) => events.push(e) });
    expect(r.stopReason).toBe("end_turn");
    expect(r.messages).toHaveLength(6);
    expect(r.costUsd).toBeCloseTo(0.003);
    expect(events.filter((e) => e.type === "model")).toHaveLength(2);
    expect(events.some((e) => e.type === "text" && e.delta.includes("Listo"))).toBe(true);
    expect((await ctx.store.getModel(modelId))!.values).toEqual({ ancho: 60 });
    expect((await ctx.store.usage()).entries.length).toBe(3);
  });

  it("devuelve errores de compilación y de validación como resultados de herramienta", async () => {
    const provider = new ScriptedProvider([
      () => ({ stopReason: "tool_use", message: { role: "assistant", content: [
        { type: "tool_call", id: "a", name: "create_model", input: { name: "Roto", scad_code: "cube(10) error" } },
        { type: "tool_call", id: "b", name: "create_model", input: { nombre: "sin campos" } },
        { type: "tool_call", id: "c", name: "no_existe", input: {} },
      ] } }),
      (req) => {
        const results = req.messages.at(-1)!.content as { type: string; isError?: boolean; content: string }[];
        expect(results).toHaveLength(3);
        expect(results.every((x) => x.type === "tool_result" && x.isError)).toBe(true);
        expect(results[0].content).toMatch(/syntax error/i);
        expect(results[1].content).toMatch(/Entrada no válida/);
        expect(results[2].content).toMatch(/no existe/);
        return { stopReason: "end_turn", message: { role: "assistant", content: [{ type: "text", text: "Hubo errores." }] } };
      },
    ]);
    const r = await runAgent({ provider, history: [], user: { role: "user", content: [{ type: "text", text: "x" }] }, tools: ALL_TOOLS, ctx, emit: () => {} });
    expect(r.stopReason).toBe("end_turn");
  });

  it("compila bloques ```openscad de modelos locales que no usan herramientas y les pide corregir errores", async () => {
    const events: AgentEvent[] = [];
    const provider = new ScriptedProvider([
      () => ({ stopReason: "end_turn", message: { role: "assistant", content: [{ type: "text", text: "Aquí está:\n```openscad\ncube(10) roto\n```" }] } }),
      (req) => {
        expect((req.messages.at(-1)!.content[0] as { text: string }).text).toMatch(/no compiló/);
        return { stopReason: "end_turn", message: { role: "assistant", content: [{ type: "text", text: "Corregido:\n```openscad\ncube([10, 20, 5]);\n```" }] } };
      },
    ]);
    const r = await runAgent({ provider, history: [], user: { role: "user", content: [{ type: "text", text: "un bloque" }] }, tools: ALL_TOOLS, ctx, emit: (e) => events.push(e) });
    expect(r.stopReason).toBe("end_turn");
    expect(events.filter((e) => e.type === "model")).toHaveLength(1);
  });

  it("detiene el agente al superar el presupuesto mensual", async () => {
    const provider = new ScriptedProvider([]);
    const events: AgentEvent[] = [];
    const r = await runAgent({ provider, history: [], user: { role: "user", content: [{ type: "text", text: "x" }] }, tools: ALL_TOOLS, ctx: { ...ctx, settings: { ...ctx.settings, monthlyBudgetUsd: 0.000001 } }, emit: (e) => events.push(e) });
    expect(r.stopReason).toBe("budget");
    expect(provider.requests).toHaveLength(0);
  });

  it("extrae el último bloque OpenSCAD", () => {
    expect(extractScadBlock("a```scad\ncube(1);\n```b```openscad\nsphere(2);\n```")).toBe("sphere(2);");
    expect(extractScadBlock("sin código")).toBeNull();
  });
});

describe("proveedor Anthropic", () => {
  function fakeClient(response: object) {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          stream(params: Record<string, unknown>) {
            calls.push(params);
            return { on() { return this; }, finalMessage: async () => response };
          },
        },
      },
    };
    return { client, calls };
  }

  it("configura pensamiento adaptativo, reserva del servidor, caché y herramientas con streaming", async () => {
    const { client, calls } = fakeClient({
      model: "claude-opus-5",
      stop_reason: "tool_use",
      content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Hola" }, { type: "tool_use", id: "tu1", name: "create_model", input: { name: "x" } }],
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 1 } },
    });
    const p = new AnthropicProvider({ model: "claude-opus-5", client: client as never });
    const r = await p.chat({ system: "S", messages: [{ role: "user", content: [{ type: "text", text: "hola" }, { type: "image", mime: "image/png", data: "AAAA" }] }], tools: [{ name: "create_model", description: "d", inputSchema: { type: "object", properties: {} } }], webSearch: true });
    const params = calls[0] as { thinking: unknown; betas: string[]; fallbacks: string; cache_control: unknown; tools: { eager_input_streaming?: boolean; type?: string }[]; output_config: { effort: string }; messages: { content: { type: string }[] }[] };
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.cache_control).toEqual({ type: "ephemeral" });
    expect(params.tools[0].eager_input_streaming).toBe(true);
    expect(params.tools[1].type).toBe("web_search_20260209");
    expect(params.output_config.effort).toBe("high");
    expect(params.messages[0].content.map((c) => c.type)).toEqual(["text", "image"]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.message.content.map((c) => c.type)).toEqual(["text", "tool_call"]);
    // 1000*5 + 500*25 + 2000*0.5 por millón + 1 búsqueda ($0.01)
    expect(r.costUsd).toBeCloseTo((1000 * 5 + 500 * 25 + 2000 * 0.5) / 1e6 + 0.01, 6);

    // En el siguiente turno reenvía el contenido nativo (con el bloque de pensamiento) sin cambios
    await p.chat({ system: "S", messages: [{ role: "user", content: [{ type: "text", text: "hola" }] }, r.message, { role: "user", content: [{ type: "tool_result", toolCallId: "tu1", content: "ok" }] }], tools: [] });
    const second = calls[1] as { messages: { role: string; content: { type: string }[] }[] };
    expect(second.messages[1].content[0].type).toBe("thinking");
    expect(second.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu1" });
  });

  it("Haiku no usa pensamiento adaptativo ni reserva", async () => {
    const { client, calls } = fakeClient({ model: "claude-haiku-4-5", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: 5 } });
    const p = new AnthropicProvider({ model: "claude-haiku-4-5", client: client as never });
    await p.chat({ system: "S", messages: [{ role: "user", content: [{ type: "text", text: "hola" }] }], tools: [], webSearch: true });
    const params = calls[0] as Record<string, unknown>;
    expect(params.thinking).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
    expect((params.tools as { type: string }[])[0].type).toBe("web_search_20250305");
  });
});

describe("proveedor compatible (Ollama, LM Studio...)", () => {
  it("interpreta el streaming con llamadas a herramientas", async () => {
    const sse = [
      { choices: [{ delta: { content: "Voy " } }] },
      { choices: [{ delta: { content: "a diseñar." } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "create_model", arguments: '{"name":"Cla' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 've","scad_code":"cube(1);"}' } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } },
    ].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    let sentBody: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const p = new OpenAICompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "qwen3:8b", fetchImpl, price: { input: 1, output: 2 } });
    let streamed = "";
    const r = await p.chat({
      system: "S",
      messages: [
        { role: "user", content: [{ type: "text", text: "hola" }] },
        { role: "assistant", content: [{ type: "tool_call", id: "old", name: "list_models", input: {} }] },
        { role: "user", content: [{ type: "tool_result", toolCallId: "old", content: "[]" }] },
      ],
      tools: [{ name: "create_model", description: "d", inputSchema: { type: "object" } }],
      onText: (d) => (streamed += d),
    });
    expect(streamed).toBe("Voy a diseñar.");
    expect(r.stopReason).toBe("tool_use");
    expect(r.message.content[1]).toEqual({ type: "tool_call", id: "c1", name: "create_model", input: { name: "Clave", scad_code: "cube(1);" } });
    expect(r.costUsd).toBeCloseTo((1000 * 1 + 100 * 2) / 1e6);
    const msgs = sentBody.messages as { role: string }[];
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
  });
});
