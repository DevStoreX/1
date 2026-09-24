import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generate3D } from "../src/gen3d/index.ts";
import { toGLB } from "../src/geometry/index.ts";
import { searchLinks, searchModels } from "../src/search/index.ts";
import { Store } from "../src/store/index.ts";
import { cube } from "./helpers.ts";

describe("generación 3D con fal.ai", () => {
  it("encola, consulta y descarga la malla de TRELLIS", async () => {
    const glb = toGLB(cube(10));
    let polls = 0;
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "https://queue.fal.run/fal-ai/trellis") {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Key k");
        expect(JSON.parse(String(init?.body)).image_url).toBe("https://img/x.png");
        return Response.json({ request_id: "r1", status_url: "https://queue.fal.run/fal-ai/trellis/requests/r1/status", response_url: "https://queue.fal.run/fal-ai/trellis/requests/r1" });
      }
      if (url.endsWith("/status")) return Response.json({ status: ++polls < 2 ? "IN_PROGRESS" : "COMPLETED" });
      if (url.endsWith("/requests/r1")) return Response.json({ model_mesh: { url: "https://cdn/x.glb" } });
      if (url === "https://cdn/x.glb") return new Response(glb);
      return new Response("?", { status: 404 });
    }) as typeof fetch;
    const r = await generate3D({ provider: "fal-trellis", image: "https://img/x.png" }, { falKey: "k", fetchImpl, pollMs: 1 });
    expect(r.costUsd).toBeCloseTo(0.02);
    expect(Array.from(r.glb)).toEqual(Array.from(glb));
    expect(polls).toBe(2);
  });

  it("pide la clave si falta", async () => {
    await expect(generate3D({ provider: "fal-trellis", image: "https://x" }, {})).rejects.toThrow(/FAL_KEY/);
  });
});

describe("búsqueda", () => {
  it("genera enlaces de búsqueda codificados", () => {
    const links = searchLinks("soporte celular");
    expect(links.find((l) => l.source === "Printables")!.url).toContain("soporte%20celular");
    expect(links.length).toBeGreaterThanOrEqual(6);
  });

  it("devuelve enlaces aunque Thingiverse falle", async () => {
    const r = await searchModels("clip", { thingiverseToken: "t", fetchImpl: (async () => new Response("", { status: 500 })) as unknown as typeof fetch });
    expect(r.results).toEqual([]);
    expect(r.errors[0]).toMatch(/500/);
    expect(r.links.length).toBeGreaterThan(0);
  });
});

describe("almacenamiento local", () => {
  let dir = "";
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("guarda modelos, impresoras, ajustes y consumo", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "forja-test-"));
    const s = new Store(dir);
    const m = await s.createModel({ name: "Clip", kind: "scad", origin: "test", files: { "source.scad": "cube(1);", "model.stl": new Uint8Array([1, 2]) } });
    expect((await s.getModel(m.id))!.name).toBe("Clip");
    expect(Array.from((await s.readModelFile(m.id, "model.stl"))!)).toEqual([1, 2]);
    expect(await s.readModelFile(m.id, "../settings.json")).toBeNull();
    const u = await s.updateModel(m.id, { name: "Clip v2" }, { "model.stl": new Uint8Array([3]) });
    expect(u.version).toBe(2);
    expect((await s.listModels())).toHaveLength(1);

    const p = await s.savePrinter({ name: "A1", kind: "bambu", host: "1.2.3.4", serial: "S", accessCode: "C" });
    expect((await s.listPrinters())[0].id).toBe(p.id);
    await s.deletePrinter(p.id);
    expect(await s.listPrinters()).toEqual([]);

    await s.saveSettings({ provider: "ollama" });
    expect(await s.getSettings({ provider: "anthropic", kidMode: false })).toEqual({ provider: "ollama", kidMode: false });

    await Promise.all([1, 2, 3].map((i) => s.addUsage({ kind: "llm", provider: "x", costUsd: i })));
    expect((await s.usage()).totalUsd).toBe(6);
  });
});
