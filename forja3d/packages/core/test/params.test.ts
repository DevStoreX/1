import { describe, expect, it } from "vitest";
import { coerceParams, parseScadParameters, toScadLiteral } from "../src/cad/params.ts";

const SRC = `
// Ancho total de la pieza
ancho = 40; // [10:1:120]
alto = 12.5; // [5:30]
forma = "redonda"; // [redonda, cuadrada]
agujeros = 3; // [2:Dos, 3:Tres, 4:Cuatro]
con_logo = true;
offset = [1, 2, 3];
calculado = ancho * 2;

/* [Avanzado] */
tolerancia = 0.2; // holgura de encaje

/* [Hidden] */
$fn = 64;

module pieza() { interno = 5; cube([ancho, ancho, alto]); }
pieza();
`;

describe("parámetros customizer", () => {
  const params = parseScadParameters(SRC);

  it("lee números con rango y descripción", () => {
    const ancho = params.find((p) => p.name === "ancho")!;
    expect(ancho).toMatchObject({ type: "number", value: 40, min: 10, step: 1, max: 120, description: "Ancho total de la pieza" });
    expect(params.find((p) => p.name === "alto")).toMatchObject({ min: 5, max: 30 });
  });

  it("lee listas desplegables, booleanos y vectores", () => {
    expect(params.find((p) => p.name === "forma")!.options?.map((o) => o.value)).toEqual(["redonda", "cuadrada"]);
    expect(params.find((p) => p.name === "agujeros")!.options).toEqual([
      { value: 2, label: "Dos" }, { value: 3, label: "Tres" }, { value: 4, label: "Cuatro" },
    ]);
    expect(params.find((p) => p.name === "con_logo")!.value).toBe(true);
    expect(params.find((p) => p.name === "offset")!.value).toEqual([1, 2, 3]);
  });

  it("ignora expresiones, grupo Hidden y variables dentro de módulos", () => {
    const names = params.map((p) => p.name);
    expect(names).not.toContain("calculado");
    expect(names).not.toContain("$fn");
    expect(names).not.toContain("interno");
    expect(params.find((p) => p.name === "tolerancia")).toMatchObject({ group: "Avanzado", description: "holgura de encaje" });
  });

  it("serializa literales de forma segura", () => {
    expect(toScadLiteral('ho"la')).toBe('"ho\\"la"');
    expect(toScadLiteral([1, 2])).toBe("[1,2]");
    expect(toScadLiteral(false)).toBe("false");
    expect(() => coerceParams(params, { "a;b": 1 })).toThrow();
    expect(coerceParams(params, { ancho: "55" })).toEqual({ ancho: 55 });
  });
});
