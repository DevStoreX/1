import { Hono } from "hono";
import { GEN3D_PROVIDERS, calculateCost, generate3D, parseGcodeInfo, type CostInputs, type Gen3DProviderId } from "@forja3d/core";
import { summarizeModel } from "@forja3d/agent";
import type { Runtime } from "../runtime.ts";

const MIME: Record<string, string> = {
  stl: "model/stl",
  scad: "text/plain; charset=utf-8",
  glb: "model/gltf-binary",
  gcode: "text/plain; charset=utf-8",
  bgcode: "application/octet-stream",
  "3mf": "model/3mf",
  json: "application/json",
};

const MAX_UPLOAD = 150 * 1024 * 1024;

export function modelRoutes(rt: Runtime) {
  const app = new Hono();

  app.get("/models", async (c) => {
    const list = await rt.store.listModels();
    return c.json(list.map((m) => ({ id: m.id, name: m.name, kind: m.kind, origin: m.origin, updatedAt: m.updatedAt, version: m.version, size: m.analysis?.size, score: m.analysis?.score })));
  });

  app.get("/models/:id", async (c) => {
    const rec = await rt.store.getModel(c.req.param("id"));
    if (!rec) return c.json({ error: "Modelo no encontrado" }, 404);
    const src = rec.kind === "scad" ? await rt.store.readModelFile(rec.id, "source.scad") : null;
    const analysis = rec.analysis ? await rt.models.estimateFor(rec.analysis) : undefined;
    return c.json({ ...rec, source: src ? new TextDecoder().decode(src) : undefined, estimate: analysis });
  });

  app.get("/models/:id/files/:name", async (c) => {
    const { id, name } = c.req.param();
    const data = await rt.store.readModelFile(id, name);
    if (!data) return c.json({ error: "Archivo no encontrado" }, 404);
    const rec = await rt.store.getModel(id);
    const ext = name.split(".").pop()!.toLowerCase();
    const headers: Record<string, string> = { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" };
    if (c.req.query("download")) {
      const base = (rec?.name ?? "modelo").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "modelo";
      headers["Content-Disposition"] = `attachment; filename="${base}.${name.split(".").slice(1).join(".")}"`;
    }
    return c.body(data.slice().buffer, 200, headers);
  });

  app.post("/models", async (c) => {
    const body = await c.req.json<{ name?: string; scad_code?: string; values?: Record<string, unknown>; description?: string }>();
    if (!body.scad_code) return c.json({ error: "Falta scad_code" }, 400);
    const r = await rt.models.createFromScad({ name: body.name ?? "Modelo", source: body.scad_code, values: body.values, description: body.description, origin: "editor" });
    if (!r.ok) return c.json({ error: r.error, log: r.compile?.log }, 422);
    return c.json({ model: r.model, estimate: r.estimate, log: r.compile?.log, ms: r.compile?.ms });
  });

  app.patch("/models/:id", async (c) => {
    const body = await c.req.json<{ name?: string; scad_code?: string; values?: Record<string, unknown> }>();
    const r = await rt.models.updateScad(c.req.param("id"), { source: body.scad_code, values: body.values, name: body.name });
    if (!r.ok) return c.json({ error: r.error, log: r.compile?.log }, r.compile ? 422 : 404);
    return c.json({ model: r.model, estimate: r.estimate, ms: r.compile?.ms });
  });

  app.delete("/models/:id", async (c) => {
    await rt.store.deleteModel(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/models/import", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "Falta el archivo" }, 400);
    if (file.size > MAX_UPLOAD) return c.json({ error: "Archivo demasiado grande" }, 413);
    const target = Number(form.get("targetSizeMm")) || undefined;
    try {
      const r = await rt.models.importMesh({
        name: String(form.get("name") || file.name.replace(/\.[^.]+$/, "")),
        data: new Uint8Array(await file.arrayBuffer()),
        fileName: file.name,
        origin: "upload",
        targetSizeMm: target,
      });
      if (!r.ok) return c.json({ error: r.error }, 422);
      return c.json({ model: r.model, estimate: r.estimate });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 422);
    }
  });

  app.post("/models/:id/sliced", async (c) => {
    const id = c.req.param("id");
    const rec = await rt.store.getModel(id);
    if (!rec) return c.json({ error: "Modelo no encontrado" }, 404);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "Falta el archivo" }, 400);
    const lower = file.name.toLowerCase();
    const ext = lower.endsWith(".gcode.3mf") ? "gcode.3mf" : lower.split(".").pop()!;
    if (!["gcode", "bgcode", "3mf", "gcode.3mf"].includes(ext)) return c.json({ error: "Sube un .gcode, .bgcode o .3mf laminado" }, 400);
    const data = new Uint8Array(await file.arrayBuffer());
    const info = ext === "gcode" ? parseGcodeInfo(new TextDecoder().decode(data)) : undefined;
    // Solo guardamos un archivo laminado por modelo
    const files = rec.files.filter((f) => !/^print\./.test(f));
    const updated = await rt.store.updateModel(id, { files }, { [`print.${ext}`]: data });
    return c.json({ model: updated, info });
  });

  app.post("/models/:id/rescale", async (c) => {
    const body = await c.req.json<{ targetSizeMm?: number }>();
    const size = Number(body.targetSizeMm);
    if (!(size >= 1 && size <= 2000)) return c.json({ error: "Tamaño no válido" }, 400);
    const r = await rt.models.rescaleMesh(c.req.param("id"), size);
    if (!r.ok) return c.json({ error: r.error }, 404);
    return c.json({ model: r.model, estimate: r.estimate });
  });

  app.post("/models/:id/estimate", async (c) => {
    const body = await c.req.json<{ printerProfile?: string; material?: string; infillPercent?: number; layerHeightMm?: number }>().catch(() => ({}));
    const res = await rt.models.reanalyze(c.req.param("id"), (body as { printerProfile?: string }).printerProfile);
    if (!res) return c.json({ error: "Modelo no encontrado" }, 404);
    const estimate = await rt.models.estimateFor(res.analysis, body);
    return c.json({ analysis: res.analysis, estimate, summary: summarizeModel({ ...res.model, analysis: res.analysis }, estimate) });
  });

  app.post("/price", async (c) => {
    const body = await c.req.json<CostInputs>();
    if (!(body.grams > 0) || !(body.printSeconds > 0)) return c.json({ error: "Indica gramos y tiempo" }, 400);
    const s = await rt.settings();
    return c.json(
      calculateCost({
        currency: s.currency,
        electricityPerKwh: s.electricityPerKwh,
        laborPerHour: s.laborPerHour,
        marginPercent: s.marginPercent,
        platformFeePercent: s.platformFeePercent,
        filamentPricePerKg: s.filamentPricePerKg,
        materialId: s.defaultMaterial,
        printerId: s.defaultPrinterProfile,
        ...body,
      }),
    );
  });

  app.post("/generate3d", async (c) => {
    const body = await c.req.json<{ provider?: Gen3DProviderId; prompt?: string; image?: string; name?: string; targetSizeMm?: number }>();
    const s = await rt.settings();
    const provider = body.provider ?? (s.hunyuanUrl ? "hunyuan3d-local" : "fal-trellis");
    if (!GEN3D_PROVIDERS.some((p) => p.id === provider)) return c.json({ error: "Proveedor desconocido" }, 400);
    try {
      const r = await generate3D({ provider, prompt: body.prompt, image: body.image }, { falKey: s.falKey, hunyuanUrl: s.hunyuanUrl });
      await rt.recordUsage({ kind: "gen3d", provider, costUsd: r.costUsd, note: body.name });
      const imported = await rt.models.importMesh({
        name: body.name || body.prompt?.slice(0, 40) || "Figura",
        data: r.glb,
        fileName: "gen.glb",
        origin: `gen3d:${provider}`,
        description: body.prompt,
        targetSizeMm: body.targetSizeMm ?? 60,
        extraFiles: { "source.glb": r.glb },
      });
      if (!imported.ok) return c.json({ error: imported.error }, 422);
      return c.json({ model: imported.model, estimate: imported.estimate, costUsd: r.costUsd });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  return app;
}
