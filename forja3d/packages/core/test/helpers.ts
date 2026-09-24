import type { Mesh } from "../src/geometry/index.ts";

/** Cubo cerrado de lado `s` con normales hacia afuera (12 triángulos). */
export function cube(s = 10): Mesh {
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ];
  const f = [
    [0, 2, 1], [0, 3, 2], // abajo
    [4, 5, 6], [4, 6, 7], // arriba
    [0, 1, 5], [0, 5, 4], // frente
    [1, 2, 6], [1, 6, 5], // derecha
    [2, 3, 7], [2, 7, 6], // atrás
    [3, 0, 4], [3, 4, 7], // izquierda
  ];
  return { positions: Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i]))) };
}
