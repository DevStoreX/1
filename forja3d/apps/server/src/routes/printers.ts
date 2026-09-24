import { Hono } from "hono";
import { createConnector, type PrinterConfig, type PrinterKind } from "@forja3d/core";
import { createDetector, sendToPrinterTool } from "@forja3d/agent";
import { maskPrinter, mergePrinterSecrets, type Runtime } from "../runtime.ts";

const KINDS: PrinterKind[] = ["octoprint", "moonraker", "prusalink", "bambu", "mock"];

function validate(p: Partial<PrinterConfig>): string | null {
  if (!p.name?.trim()) return "Ponle un nombre a la impresora";
  if (!p.kind || !KINDS.includes(p.kind)) return "Tipo de impresora no válido";
  if (["octoprint", "moonraker", "prusalink"].includes(p.kind) && !/^https?:\/\//.test(p.url ?? "")) return "La URL debe empezar por http:// o https://";
  if (p.kind === "bambu" && (!p.host || !p.serial || !p.accessCode)) return "Bambu Lab necesita IP, número de serie y código de acceso";
  if (p.cameraUrl && !/^https?:\/\//.test(p.cameraUrl)) return "La URL de la cámara debe empezar por http:// o https://";
  return null;
}

export function printerRoutes(rt: Runtime) {
  const app = new Hono();

  const get = async (id: string) => {
    const cfg = await rt.printerConfig(id);
    return cfg ? { cfg, conn: rt.printers.get(cfg) } : null;
  };

  app.get("/printers", async (c) => c.json((await rt.store.listPrinters()).map(maskPrinter)));

  app.post("/printers", async (c) => {
    const body = await c.req.json<Partial<PrinterConfig>>();
    const existing = body.id ? await rt.printerConfig(body.id) : null;
    const merged = mergePrinterSecrets(body, existing);
    const err = validate(merged);
    if (err) return c.json({ error: err }, 400);
    const saved = await rt.store.savePrinter(merged as PrinterConfig);
    return c.json(maskPrinter(saved));
  });

  app.post("/printers/test", async (c) => {
    const body = await c.req.json<Partial<PrinterConfig>>();
    const existing = body.id ? await rt.printerConfig(body.id) : null;
    const merged = { ...mergePrinterSecrets(body, existing), id: body.id ?? "test" } as PrinterConfig;
    const err = validate(merged);
    if (err) return c.json({ ok: false, error: err }, 400);
    const conn = createConnector(merged);
    try {
      const status = await conn.status();
      return c.json({ ok: status.online, status });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message });
    } finally {
      await conn.close?.();
    }
  });

  app.delete("/printers/:id", async (c) => {
    const id = c.req.param("id");
    rt.monitor.stop(id);
    await rt.printers.remove(id);
    await rt.store.deletePrinter(id);
    return c.json({ ok: true });
  });

  app.get("/printers/:id/status", async (c) => {
    const p = await get(c.req.param("id"));
    if (!p) return c.json({ error: "Impresora no encontrada" }, 404);
    try {
      return c.json({ ...(await p.conn.status()), monitor: rt.monitor.get(p.cfg.id) ?? null });
    } catch (e) {
      return c.json({ online: false, state: "offline", message: (e as Error).message, monitor: rt.monitor.get(p.cfg.id) ?? null });
    }
  });

  app.post("/printers/:id/:action{pause|resume|cancel}", async (c) => {
    const p = await get(c.req.param("id"));
    if (!p) return c.json({ error: "Impresora no encontrada" }, 404);
    const action = c.req.param("action") as "pause" | "resume" | "cancel";
    try {
      await p.conn[action]();
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.post("/printers/:id/send", async (c) => {
    const body = await c.req.json<{ modelId: string; start?: boolean }>();
    const ctx = await rt.toolContext();
    const out = await sendToPrinterTool.run({ printer_id: c.req.param("id"), model_id: body.modelId, start: body.start }, ctx).catch((e: Error) => ({ content: e.message, isError: true }));
    return out.isError ? c.json({ error: out.content }, 400) : c.json(JSON.parse(out.content));
  });

  app.get("/printers/:id/snapshot", async (c) => {
    const p = await get(c.req.param("id"));
    if (!p) return c.json({ error: "Impresora no encontrada" }, 404);
    try {
      const snap = await p.conn.snapshot();
      if (!snap) return c.json({ error: "Sin cámara configurada" }, 404);
      return c.body(snap.data.slice().buffer, 200, { "Content-Type": snap.mime, "Cache-Control": "no-store" });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.post("/printers/:id/check", async (c) => {
    const p = await get(c.req.param("id"));
    if (!p) return c.json({ error: "Impresora no encontrada" }, 404);
    try {
      const snap = await p.conn.snapshot();
      if (!snap) return c.json({ error: "Sin cámara configurada" }, 404);
      const ctx = await rt.toolContext();
      const detector = createDetector(ctx.settings, ctx.vision!);
      const status = await p.conn.status().catch(() => undefined);
      const check = await detector.check(snap, { printerName: p.cfg.name, status, snapshotUrl: rt.snapshotUrlFor(p.cfg.id) });
      return c.json(check);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.get("/printers/:id/monitor", async (c) => c.json(rt.monitor.get(c.req.param("id")) ?? { running: false }));

  app.post("/printers/:id/monitor", async (c) => {
    const p = await get(c.req.param("id"));
    if (!p) return c.json({ error: "Impresora no encontrada" }, 404);
    const body = await c.req.json<{ enabled: boolean; intervalSec?: number; autoPause?: boolean }>();
    if (!body.enabled) {
      rt.monitor.stop(p.cfg.id);
      return c.json({ running: false });
    }
    const ctx = await rt.toolContext();
    const state = rt.monitor.start(
      p.cfg.id,
      {
        connector: () => rt.printers.get(p.cfg),
        detector: () => createDetector(ctx.settings, ctx.vision!),
        printerName: p.cfg.name,
        snapshotUrl: rt.snapshotUrlFor(p.cfg.id),
      },
      { intervalSec: body.intervalSec, autoPause: body.autoPause },
    );
    return c.json(state);
  });

  return app;
}
