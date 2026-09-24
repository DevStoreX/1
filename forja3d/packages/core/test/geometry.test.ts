import { describe, expect, it } from "vitest";
import {
  analyzeMesh,
  computeBBox,
  loadMesh,
  parseGLB,
  parseOBJ,
  parseSTL,
  placeOnBed,
  rotateMesh,
  scaleToLargestDimension,
  toBinarySTL,
  toGLB,
} from "../src/geometry/index.ts";
import { cube } from "./helpers.ts";

describe("STL", () => {
  it("escribe y lee STL binario sin pérdida", () => {
    const m = cube(20);
    const back = parseSTL(toBinarySTL(m));
    expect(Array.from(back.positions)).toEqual(Array.from(m.positions));
  });

  it("lee STL ASCII", () => {
    const text = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
    const m = parseSTL(new TextEncoder().encode(text));
    expect(m.positions.length).toBe(9);
  });
});

describe("análisis de imprimibilidad", () => {
  it("mide volumen, área y detecta malla cerrada", () => {
    const a = analyzeMesh(cube(10));
    expect(a.volumeCm3).toBeCloseTo(1, 5);
    expect(a.surfaceAreaCm2).toBeCloseTo(6, 5);
    expect(a.watertight).toBe(true);
    expect(a.inconsistentEdges).toBe(0);
    expect(a.invertedNormals).toBe(false);
    expect(a.needsSupports).toBe(false);
    expect(a.bedContactAreaCm2).toBeCloseTo(1, 5);
    expect(a.score).toBe(100);
  });

  it("detecta malla abierta", () => {
    const m = cube(10);
    const open = { positions: m.positions.slice(0, m.positions.length - 9) };
    const a = analyzeMesh(open);
    expect(a.watertight).toBe(false);
    expect(a.boundaryEdges).toBe(3);
    expect(a.issues.some((i) => i.code === "not_watertight")).toBe(true);
  });

  it("detecta voladizos en un cubo elevado", () => {
    const m = cube(10);
    const lifted = { positions: m.positions.map((v, i) => (i % 3 === 2 ? v + 5 : v)) };
    // añadimos un pilar fino en la base para que haya contacto con la cama
    const a = analyzeMesh({ positions: Float32Array.from([...cube(1).positions, ...lifted.positions]) });
    expect(a.overhang.areaCm2).toBeGreaterThan(0.9);
    expect(a.needsSupports).toBe(true);
  });

  it("comprueba si cabe en la impresora", () => {
    const big = scaleToLargestDimension(cube(10), 300);
    const a = analyzeMesh(big, { buildVolume: { x: 256, y: 256, z: 256 } });
    expect(a.fits?.fits).toBe(false);
    expect(a.issues.some((i) => i.code === "too_big" && i.level === "error")).toBe(true);
  });
});

describe("transformaciones", () => {
  it("apoya la pieza en la cama centrada", () => {
    const m = placeOnBed(rotateMesh(cube(10), [30, 0, 45]));
    const b = computeBBox(m);
    expect(b.min[2]).toBeCloseTo(0, 5);
    expect(b.min[0] + b.max[0]).toBeCloseTo(0, 4);
  });

  it("mantiene el volumen positivo al rotar", () => {
    const a = analyzeMesh(rotateMesh(cube(10), [90, 0, 0]));
    expect(a.invertedNormals).toBe(false);
    expect(a.volumeCm3).toBeCloseTo(1, 4);
  });
});

describe("GLB y OBJ", () => {
  it("ida y vuelta GLB", () => {
    const m = cube(7);
    const back = parseGLB(toGLB(m));
    expect(Array.from(back.positions)).toEqual(Array.from(m.positions));
  });

  it("loadMesh convierte GLB (Y-arriba) a Z-arriba y lo apoya en la cama", () => {
    // Una caja alta en Y (glTF) debe quedar alta en Z
    const tall = { positions: cube(10).positions.map((v, i) => (i % 3 === 1 ? v * 3 : v)) };
    const m = loadMesh(toGLB(tall), "x.glb");
    const b = computeBBox(m);
    expect(b.max[2] - b.min[2]).toBeCloseTo(30, 4);
    expect(b.min[2]).toBeCloseTo(0, 5);
    expect(analyzeMesh(m).invertedNormals).toBe(false);
  });

  it("lee OBJ con quads", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n`;
    expect(parseOBJ(obj).positions.length).toBe(18);
  });
});
