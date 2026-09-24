import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GEN3D_PROVIDERS, MATERIALS, PRINTER_PROFILES, searchModels, slicerAvailable } from "@forja3d/core";
import { MODEL_PRESETS, CLAUDE_PRICES, providerReady, publicSettings } from "@forja3d/agent";
import type { Runtime, ServerEvent } from "../runtime.ts";

export const VERSION = "0.1.0";

export function settingsRoutes(rt: Runtime) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, name: "Forja3D", version: VERSION }));

  app.get("/settings", async (c) => {
    const s = await rt.settings();
    return c.json({
      settings: publicSettings(s),
      ready: providerReady(s),
      presets: MODEL_PRESETS,
      prices: CLAUDE_PRICES,
      materials: Object.values(MATERIALS),
      printerProfiles: PRINTER_PROFILES,
      gen3dProviders: GEN3D_PROVIDERS,
      slicer: slicerAvailable(),
      version: VERSION,
    });
  });

  app.put("/settings", async (c) => {
    const patch = await c.req.json<Record<string, unknown>>();
    const s = await rt.updateSettings(patch);
    return c.json({ settings: publicSettings(s), ready: providerReady(s) });
  });

  app.get("/usage", async (c) => c.json(await rt.store.usage()));

  app.get("/search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ error: "Falta q" }, 400);
    const s = await rt.settings();
    return c.json(await searchModels(q, { thingiverseToken: s.thingiverseToken }));
  });

  /** Notificaciones en vivo (cámara, modelos nuevos creados por MCP...) */
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const onEvent = (e: ServerEvent) => void stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      rt.events.on("event", onEvent);
      stream.onAbort(() => {
        rt.events.off("event", onEvent);
      });
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "{}" });
        await stream.sleep(25_000);
      }
      rt.events.off("event", onEvent);
    }),
  );

  return app;
}
