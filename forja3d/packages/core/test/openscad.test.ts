import { afterAll, describe, expect, it } from "vitest";
import { compileScad, shutdownCad } from "../src/cad/openscad.ts";
import { analyzeMesh, parseSTL } from "../src/geometry/index.ts";

afterAll(() => shutdownCad());

describe("OpenSCAD (WASM)", () => {
  it("compila una pieza con parámetros", async () => {
    const r = await compileScad(`ancho = 20; difference(){ cube([ancho, ancho, 10]); translate([ancho/2, ancho/2, -1]) cylinder(d=6, h=12, $fn=32); }`, {
      params: { ancho: 30 },
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const a = analyzeMesh(parseSTL(r.output!));
    expect(a.size[0]).toBeCloseTo(30, 3);
    expect(a.watertight).toBe(true);
    expect(a.volumeCm3).toBeCloseTo((30 * 30 * 10 - Math.PI * 9 * 10 * 0.99) / 1000, 1);
  });

  it("devuelve errores de sintaxis legibles", async () => {
    const r = await compileScad("cube(10) error aqui");
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/syntax error/i);
  });

  it("detecta resultados 2D", async () => {
    const r = await compileScad("square(10);");
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/2D|not a 3D|3D object/i);
  });

  it("corta bucles infinitos por tiempo", async () => {
    const r = await compileScad("function f(n) = f(n+1); x = f(0); cube(1);", { timeoutMs: 3000 });
    expect(r.ok).toBe(false);
  });

  it("soporta texto con fuentes incluidas", async () => {
    const r = await compileScad(`linear_extrude(2) text("Hola", size=8);`);
    expect(r.ok).toBe(true);
  });
});
