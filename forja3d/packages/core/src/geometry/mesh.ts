/**
 * Malla en "sopa de triángulos": 9 floats por triángulo (x0,y0,z0,x1,y1,z1,x2,y2,z2).
 * Unidades: milímetros, eje Z hacia arriba (convención de impresión 3D).
 */
export interface Mesh {
  positions: Float32Array;
}

export type Vec3 = [number, number, number];

export interface BBox {
  min: Vec3;
  max: Vec3;
}

export function triangleCount(mesh: Mesh): number {
  return Math.floor(mesh.positions.length / 9);
}

export function computeBBox(mesh: Mesh): BBox {
  const p = mesh.positions;
  if (p.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export function bboxSize(b: BBox): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function mergeMeshes(meshes: Mesh[]): Mesh {
  const total = meshes.reduce((n, m) => n + m.positions.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const m of meshes) {
    out.set(m.positions, off);
    off += m.positions.length;
  }
  return { positions: out };
}

/** Aplica una matriz 4x4 en orden column-major (como glTF / three.js). */
export function transformMesh(mesh: Mesh, m: ArrayLike<number>): Mesh {
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  // Una matriz con determinante negativo invierte la orientación de los triángulos.
  const det =
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) flipWindingInPlace(out);
  return { positions: out };
}

export function flipWindingInPlace(p: Float32Array): void {
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = p[i + 3 + k];
      p[i + 3 + k] = p[i + 6 + k];
      p[i + 6 + k] = t;
    }
  }
}

export function translateMesh(mesh: Mesh, d: Vec3): Mesh {
  return transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d[0], d[1], d[2], 1]);
}

export function scaleMesh(mesh: Mesh, s: number | Vec3): Mesh {
  const [sx, sy, sz] = typeof s === "number" ? [s, s, s] : s;
  return transformMesh(mesh, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]);
}

/** Rotación en grados alrededor de los ejes X, Y, Z (aplicada en ese orden). */
export function rotateMesh(mesh: Mesh, deg: Vec3): Mesh {
  const [ax, ay, az] = deg.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  // R = Rz * Ry * Rx, column-major
  const m = [
    cz * cy, sz * cy, -sy, 0,
    cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, 0,
    cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx, 0,
    0, 0, 0, 1,
  ];
  return transformMesh(mesh, m);
}

/** Centra la pieza en XY y la apoya sobre la cama (z mínimo = 0). */
export function placeOnBed(mesh: Mesh): Mesh {
  const b = computeBBox(mesh);
  return translateMesh(mesh, [-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
}

/** Escala uniformemente para que la dimensión mayor mida `targetMm`. */
export function scaleToLargestDimension(mesh: Mesh, targetMm: number): Mesh {
  const size = bboxSize(computeBBox(mesh));
  const largest = Math.max(...size);
  if (largest <= 0) return mesh;
  return scaleMesh(mesh, targetMm / largest);
}

/** Convierte de Y-arriba (glTF, la mayoría de generadores IA) a Z-arriba. */
export function yUpToZUp(mesh: Mesh): Mesh {
  // (x, y, z) -> (x, -z, y): rotación de +90° en X
  return transformMesh(mesh, [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
}

export interface IndexedMesh {
  vertices: Float64Array;
  indices: Uint32Array;
}

/** Une vértices coincidentes (tolerancia en mm) para poder analizar topología. */
export function weldVertices(mesh: Mesh, tolerance = 1e-4): IndexedMesh {
  const p = mesh.positions;
  const n = p.length / 3;
  const inv = 1 / tolerance;
  const map = new Map<string, number>();
  const verts: number[] = [];
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = verts.length / 3;
      verts.push(x, y, z);
      map.set(key, idx);
    }
    indices[i] = idx;
  }
  return { vertices: Float64Array.from(verts), indices };
}

/** Elimina triángulos degenerados (área ~0 o vértices repetidos). */
export function removeDegenerate(mesh: Mesh, minArea = 1e-10): Mesh {
  const p = mesh.positions;
  const keep: number[] = [];
  for (let i = 0; i < p.length; i += 9) {
    if (triangleArea(p, i) > minArea) keep.push(i);
  }
  if (keep.length * 9 === p.length) return mesh;
  const out = new Float32Array(keep.length * 9);
  keep.forEach((src, j) => out.set(p.subarray(src, src + 9), j * 9));
  return { positions: out };
}

export function triangleArea(p: ArrayLike<number>, i: number): number {
  const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
  const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/** Normal unitaria del triángulo que empieza en el índice `i`. */
export function triangleNormal(p: ArrayLike<number>, i: number): Vec3 {
  const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
  const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
  return [cx / len, cy / len, cz / len];
}
