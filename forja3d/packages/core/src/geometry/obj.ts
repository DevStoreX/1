import type { Mesh } from "./mesh.ts";

/** Lector OBJ mínimo: vértices y caras (triangula polígonos en abanico). */
export function parseOBJ(text: string): Mesh {
  const verts: number[] = [];
  const out: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      verts.push(Number(x), Number(y), Number(z));
    } else if (line.startsWith("f ")) {
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((tok) => {
          const i = parseInt(tok.split("/")[0], 10);
          return i < 0 ? verts.length / 3 + i : i - 1;
        });
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const vi of [idx[0], idx[k], idx[k + 1]]) {
          out.push(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
        }
      }
    }
  }
  return { positions: Float32Array.from(out) };
}
