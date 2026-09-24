import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { compileScad, parseScadParameters, shutdownCad } from "../src/cad/index.ts";
import { analyzeMesh, parseSTL } from "../src/geometry/index.ts";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples");
const files = readdirSync(dir).filter((f) => f.endsWith(".scad"));

afterAll(() => shutdownCad());

describe("ejemplos OpenSCAD", () => {
  it.each(files)("%s compila, es cerrado y no necesita soportes", async (file) => {
    const src = readFileSync(path.join(dir, file), "utf8");
    expect(parseScadParameters(src).length).toBeGreaterThanOrEqual(4);
    const r = await compileScad(src);
    expect(r.errors).toEqual([]);
    const a = analyzeMesh(parseSTL(r.output!), { buildVolume: { x: 256, y: 256, z: 256 } });
    expect(a.watertight).toBe(true);
    expect(a.needsSupports, `${file}: ${a.overhang.percent.toFixed(1)}% voladizos`).toBe(false);
    expect(a.fits?.fits).toBe(true);
  });
});
