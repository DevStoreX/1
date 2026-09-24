import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shutdownCad } from "@forja3d/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { Runtime } from "../src/runtime.ts";

let dir = "";
let rt: Runtime;
let app: ReturnType<typeof createApp>;
let fakeLLM: Server;
let llmUrl = "";
const llmRequests: { messages: { role: string; content: unknown }[] }[] = [];

const SCAD = `// Diámetro del agujero
agujero = 8; // [3:0.5:20]
/* [Hidden] */
$fn = 40;
difference() { cylinder(d = agujero + 10, h = 5); translate([0, 0, -1]) cylinder(d = agujero, h = 7); }`;

function sse(chunks: object[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "forja-server-"));
  rt = new Runtime({ dataDir: dir, publicUrl: "http://forja.test", env: {} });
  app = createApp(rt);
  // Proveedor de IA falso compatible con /chat/completions
  fakeLLM = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      llmRequests.push(parsed);
      const hasToolResult = parsed.messages.some((m: { role: string }) => m.role === "tool");
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (!hasToolResult) {
        res.end(sse([
          { choices: [{ delta: { content: "Diseñando tu arandela. " } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call1", function: { name: "create_model", arguments: JSON.stringify({ name: "Arandela", scad_code: SCAD }) } }] }, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 500, completion_tokens: 80 } },
        ]));
      } else {
        res.end(sse([{ choices: [{ delta: { content: "¡Lista tu arandela!" }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } }]));
      }
    });
  });
  await new Promise<void>((r) => fakeLLM.listen(0, "127.0.0.1", () => r()));
  const addr = fakeLLM.address() as { port: number };
  llmUrl = `http://127.0.0.1:${addr.port}/v1`;
});

afterAll(async () => {
  fakeLLM.close();
  await rt.close();
  await shutdownCad();
  await rm(dir, { recursive: true, force: true });
});

const json = (method: string, body?: unknown) => ({ method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("API", () => {
  it("responde salud y ajustes sin exponer secretos", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
    let r = await app.request("/api/settings", json("PUT", { anthropicApiKey: "sk-ant-1234567890abcdef", currency: "COP", noExiste: 1 }));
    let body = await r.json();
    expect(body.settings.secrets.anthropicApiKey).toBe("sk-a••••cdef");
    expect(body.settings.anthropicApiKey).toBeUndefined();
    expect(body.settings.currency).toBe("COP");
    expect(body.settings.noExiste).toBeUndefined();
    // Reenviar el valor enmascarado no borra el secreto
    await app.request("/api/settings", json("PUT", { anthropicApiKey: "sk-a••••cdef" }));
    expect((await rt.settings()).anthropicApiKey).toBe("sk-ant-1234567890abcdef");
    r = await app.request("/api/settings");
    body = await r.json();
    expect(body.presets.length).toBeGreaterThanOrEqual(4);
    expect(body.materials.length).toBeGreaterThan(4);
  });

  it("crea, modifica, estima y descarga un modelo OpenSCAD", async () => {
    let r = await app.request("/api/models", json("POST", { name: "Arandela", scad_code: SCAD }));
    expect(r.status).toBe(200);
    const { model, estimate } = await r.json();
    expect(model.parameters[0].name).toBe("agujero");
    expect(model.analysis.watertight).toBe(true);
    expect(estimate.grams).toBeGreaterThan(0);

    r = await app.request(`/api/models/${model.id}`, json("PATCH", { values: { agujero: 12 } }));
    const patched = await r.json();
    expect(patched.model.analysis.size[0]).toBeCloseTo(22, 0);

    r = await app.request(`/api/models/${model.id}/files/model.stl?download=1`);
    expect(r.headers.get("content-disposition")).toContain('filename="Arandela.stl"');
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(84);

    r = await app.request(`/api/models/${model.id}`);
    expect((await r.json()).source).toContain("agujero");

    r = await app.request(`/api/models/${model.id}/estimate`, json("POST", { material: "PETG", infillPercent: 50 }));
    expect((await r.json()).estimate.materialId).toBe("PETG");

    r = await app.request("/api/models", json("POST", { scad_code: "cube(" }));
    expect(r.status).toBe(422);
  });

  it("importa STL y adjunta G-code laminado", async () => {
    const created = await (await app.request("/api/models", json("POST", { name: "Base", scad_code: "cube([20,20,2]);" }))).json();
    const stl = await (await app.request(`/api/models/${created.model.id}/files/model.stl`)).arrayBuffer();
    const form = new FormData();
    form.append("file", new File([stl], "pieza.stl"));
    form.append("targetSizeMm", "40");
    let r = await app.request("/api/models/import", { method: "POST", body: form });
    const imported = await r.json();
    expect(imported.model.kind).toBe("mesh");
    expect(Math.max(...imported.model.analysis.size)).toBeCloseTo(40, 3);

    const g = new FormData();
    g.append("file", new File(["; generated by PrusaSlicer 2.8\n; estimated printing time (normal mode) = 12m 30s\n; filament used [g] = 2.5\nG28\n"], "pieza.gcode"));
    r = await app.request(`/api/models/${imported.model.id}/sliced`, { method: "POST", body: g });
    const sliced = await r.json();
    expect(sliced.info).toMatchObject({ printSeconds: 750, filamentGrams: 2.5 });
    expect(sliced.model.files).toContain("print.gcode");
  });

  it("gestiona impresoras (simulada) y envía un trabajo", async () => {
    let r = await app.request("/api/printers", json("POST", { name: "", kind: "mock" }));
    expect(r.status).toBe(400);
    r = await app.request("/api/printers", json("POST", { name: "Oficina", kind: "octoprint", url: "http://octo", apiKey: "secreta" }));
    const octo = await r.json();
    expect(octo.apiKey).toBeUndefined();
    expect(octo.hasSecrets.apiKey).toBe(true);
    // Editar sin reenviar la clave la conserva
    await app.request("/api/printers", json("POST", { ...octo, name: "Oficina 2", apiKey: "" }));
    expect((await rt.printerConfig(octo.id))!.apiKey).toBe("secreta");

    r = await app.request("/api/printers", json("POST", { name: "Demo", kind: "mock" }));
    const mock = await r.json();
    const models = await (await app.request("/api/models")).json();
    const withGcode = models.find((m: { kind: string }) => m.kind === "mesh");
    r = await app.request(`/api/printers/${mock.id}/send`, json("POST", { modelId: withGcode.id, start: true }));
    expect(r.status).toBe(200);
    r = await app.request(`/api/printers/${mock.id}/status`);
    expect((await r.json()).state).toBe("printing");
    r = await app.request(`/api/printers/${mock.id}/pause`, { method: "POST" });
    expect(r.status).toBe(200);
    expect((await (await app.request(`/api/printers/${mock.id}/status`)).json()).state).toBe("paused");
    r = await app.request(`/api/printers/${mock.id}/snapshot`);
    expect(r.status).toBe(404);
    expect((await app.request(`/api/printers/${mock.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("calcula precios", async () => {
    const r = await app.request("/api/price", json("POST", { grams: 50, printSeconds: 7200, marginPercent: 100 }));
    const body = await r.json();
    expect(body.currency).toBe("COP");
    expect(body.suggestedPrice).toBeCloseTo(body.totalCost * 2, 1);
  });

  it("devuelve enlaces de búsqueda", async () => {
    const r = await app.request("/api/search?q=porta%20llaves");
    expect((await r.json()).links[0].url).toContain("porta%20llaves");
  });
});

describe("chat con el agente (SSE)", () => {
  it("avisa si el proveedor no está configurado", async () => {
    await rt.updateSettings({ provider: "openai-compatible", openaiBaseUrl: "" });
    const r = await app.request("/api/chat", json("POST", { message: "hola" }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("provider_not_ready");
  });

  it("transmite texto, herramientas y el modelo creado, y guarda la conversación", async () => {
    await rt.updateSettings({ provider: "openai-compatible", openaiBaseUrl: llmUrl, model: "fake", customPriceInput: 1, customPriceOutput: 2 });
    const r = await app.request("/api/chat", json("POST", { message: "Necesito una arandela para un tornillo de 8 mm" }));
    expect(r.status).toBe(200);
    const text = await r.text();
    const events = text.split("\n\n").filter(Boolean).map((block) => {
      const ev = /event: (.+)/.exec(block)?.[1];
      const data = /data: (.+)/.exec(block)?.[1];
      return { ev, data: data ? JSON.parse(data) : null };
    });
    const types = events.map((e) => e.ev);
    expect(types[0]).toBe("conversation");
    expect(types).toContain("tool_start");
    expect(types).toContain("model");
    expect(types.at(-1)).toBe("done");
    const model = events.find((e) => e.ev === "model")!.data.model;
    expect(model.name).toBe("Arandela");
    const reply = events.filter((e) => e.ev === "text").map((e) => e.data.delta).join("");
    expect(reply).toContain("¡Lista tu arandela!");
    // El contexto de la app viaja en el mensaje de la persona
    expect(JSON.stringify(llmRequests[0].messages[1])).toContain("Contexto de la app");

    const convId = events[0].data.id;
    const conv = await (await app.request(`/api/conversations/${convId}`)).json();
    expect(conv.messages).toHaveLength(4);
    expect(conv.costUsd).toBeGreaterThan(0);
    const usage = await (await app.request("/api/usage")).json();
    expect(usage.byKind.llm).toBeGreaterThan(0);
  });
});

describe("MCP por HTTP", () => {
  const rpc = async (method: string, params: unknown, id = 1) => {
    const r = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return { status: r.status, body: await r.json() };
  };

  it("inicializa, lista herramientas y crea un modelo", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("forja3d");
    expect(init.body.result.instructions).toContain("OpenSCAD");

    const list = await rpc("tools/list", {}, 2);
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("create_model");
    expect(names).toContain("send_to_printer");
    const create = list.body.result.tools.find((t: { name: string }) => t.name === "create_model");
    expect(create.inputSchema.required).toContain("scad_code");

    const call = await rpc("tools/call", { name: "create_model", arguments: { name: "Llavero", scad_code: 'linear_extrude(3) text("FORJA", size=8);' } }, 3);
    expect(call.body.result.isError).toBeFalsy();
    const data = JSON.parse(call.body.result.content[0].text);
    expect(data.viewer_url).toBe(`http://forja.test/#/model/${data.model_id}`);
    expect(data.stl_url).toContain("/files/model.stl");
  });
});

describe("autenticación opcional", () => {
  it("exige token cuando está configurado", async () => {
    const secured = createApp(rt, { token: "t0k3n" });
    expect((await secured.request("/api/settings")).status).toBe(401);
    expect((await secured.request("/api/settings", { headers: { authorization: "Bearer t0k3n" } })).status).toBe(200);
    expect((await secured.request("/api/health")).status).toBe(200);
    expect((await secured.request("/mcp", { method: "POST" })).status).toBe(401);
  });
});
