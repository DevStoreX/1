import {
  type BBox,
  type Mesh,
  type Vec3,
  bboxSize,
  computeBBox,
  triangleArea,
  triangleNormal,
  weldVertices,
} from "./mesh.ts";

export type IssueLevel = "error" | "warning" | "info";

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface BuildVolume {
  x: number;
  y: number;
  z: number;
}

export interface AnalysisOptions {
  /** Ángulo (desde la vertical) a partir del cual una cara necesita soporte. Por defecto 45°. */
  overhangAngleDeg?: number;
  /** Volumen de impresión para comprobar si la pieza cabe. */
  buildVolume?: BuildVolume;
}

export interface MeshAnalysis {
  triangles: number;
  bbox: BBox;
  /** Tamaño en mm [x, y, z] */
  size: Vec3;
  volumeCm3: number;
  surfaceAreaCm2: number;
  /** Área de caras mayormente horizontales (techos y suelos), cm² */
  horizontalAreaCm2: number;
  /** Área de caras mayormente verticales (paredes), cm² */
  verticalAreaCm2: number;
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  invertedNormals: boolean;
  overhang: {
    areaCm2: number;
    percent: number;
    /** Altura media (mm) de las caras en voladizo: sirve para estimar soportes */
    meanHeightMm: number;
  };
  bedContactAreaCm2: number;
  needsSupports: boolean;
  fits?: { buildVolume: BuildVolume; fits: boolean; fitsRotated: boolean };
  /** Puntuación orientativa de imprimibilidad 0-100 */
  score: number;
  issues: Issue[];
}

export function analyzeMesh(mesh: Mesh, opts: AnalysisOptions = {}): MeshAnalysis {
  const p = mesh.positions;
  const triangles = Math.floor(p.length / 9);
  const bbox = computeBBox(mesh);
  const size = bboxSize(bbox);
  const minZ = bbox.min[2];
  const overhangCos = Math.cos(((opts.overhangAngleDeg ?? 45) * Math.PI) / 180);

  let volume6 = 0;
  let area = 0, horizontal = 0, vertical = 0;
  let overhangArea = 0, overhangHeightWeighted = 0;
  let bedArea = 0;

  for (let i = 0; i < triangles * 9; i += 9) {
    const a = triangleArea(p, i);
    if (a === 0) continue;
    area += a;
    // Volumen con signo (teorema de la divergencia)
    volume6 +=
      p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) -
      p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) +
      p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
    const n = triangleNormal(p, i);
    if (Math.abs(n[2]) > 0.7071) horizontal += a;
    else vertical += a;
    const zMax = Math.max(p[i + 2], p[i + 5], p[i + 8]);
    const zMean = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
    const onBed = zMax - minZ < 0.05;
    if (onBed && n[2] < -0.99) bedArea += a;
    // Cara hacia abajo con ángulo más plano que el umbral y que no toca la cama
    if (!onBed && -n[2] > overhangCos) {
      overhangArea += a;
      overhangHeightWeighted += a * (zMean - minZ);
    }
  }

  let volume = volume6 / 6;
  const invertedNormals = volume < 0;
  volume = Math.abs(volume);

  // Topología: cada arista debe estar compartida por exactamente 2 triángulos con orientación opuesta
  const { indices } = weldVertices(mesh);
  const edges = new Map<string, number>(); // clave "a,b" (a<b) -> conteo con signo codificado
  const forward = new Map<string, number>();
  for (let t = 0; t < triangles; t++) {
    const tri = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      if (a < b) forward.set(key, (forward.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0;
  for (const [key, count] of edges) {
    if (count === 1) boundaryEdges++;
    else if (count > 2) nonManifoldEdges++;
    else if ((forward.get(key) ?? 0) !== 1) inconsistentEdges++;
  }
  const watertight = triangles > 0 && boundaryEdges === 0 && nonManifoldEdges === 0;

  const issues: Issue[] = [];
  const toCm2 = (mm2: number) => mm2 / 100;
  const overhangPercent = area > 0 ? (overhangArea / area) * 100 : 0;
  const needsSupports = overhangPercent > 1 && toCm2(overhangArea) > 0.5;

  if (triangles === 0) {
    issues.push({ level: "error", code: "empty", message: "La malla está vacía." });
  }
  if (!watertight && triangles > 0) {
    issues.push({
      level: "error",
      code: "not_watertight",
      message: `La malla no es cerrada (${boundaryEdges} bordes abiertos, ${nonManifoldEdges} aristas no-manifold). El laminador puede fallar o reparar mal la pieza.`,
    });
  }
  if (inconsistentEdges > 0) {
    issues.push({
      level: "warning",
      code: "inconsistent_normals",
      message: `${inconsistentEdges} aristas con orientación inconsistente (normales volteadas).`,
    });
  }
  if (invertedNormals && watertight) {
    issues.push({ level: "warning", code: "inverted", message: "Las normales apuntan hacia adentro (malla invertida)." });
  }
  const minDim = Math.min(...size);
  if (triangles > 0 && minDim < 0.8) {
    issues.push({
      level: "warning",
      code: "too_thin",
      message: `La pieza mide solo ${minDim.toFixed(2)} mm en su lado más delgado; con boquilla 0.4 mm se recomienda ≥ 0.8 mm.`,
    });
  }
  if (triangles > 0 && Math.max(...size) < 2) {
    issues.push({ level: "warning", code: "tiny", message: "La pieza es diminuta (< 2 mm). ¿Quizás está en metros o pulgadas?" });
  }
  if (needsSupports) {
    issues.push({
      level: "warning",
      code: "overhangs",
      message: `${overhangPercent.toFixed(1)}% de la superficie tiene voladizos de más de ${opts.overhangAngleDeg ?? 45}°: necesitará soportes o rotarla.`,
    });
  }
  const bedCm2 = toCm2(bedArea);
  if (triangles > 0 && bedCm2 < 0.5 && size[2] > 10) {
    issues.push({
      level: "warning",
      code: "small_base",
      message: `Base de apoyo pequeña (${bedCm2.toFixed(2)} cm²) para una pieza de ${size[2].toFixed(0)} mm de alto: usa brim o reorienta.`,
    });
  }

  let fits: MeshAnalysis["fits"];
  if (opts.buildVolume) {
    const bv = opts.buildVolume;
    const fitsDirect = size[0] <= bv.x && size[1] <= bv.y && size[2] <= bv.z;
    const sortedPart = [...size].sort((a, b) => a - b);
    const sortedBed = [bv.x, bv.y, bv.z].sort((a, b) => a - b);
    const fitsRotated = sortedPart.every((d, i) => d <= sortedBed[i]);
    fits = { buildVolume: bv, fits: fitsDirect, fitsRotated };
    if (!fitsDirect) {
      issues.push({
        level: fitsRotated ? "warning" : "error",
        code: "too_big",
        message: fitsRotated
          ? "No cabe en esta orientación, pero sí rotándola."
          : `No cabe en el volumen de impresión (${bv.x}×${bv.y}×${bv.z} mm): escálala o divídela en partes.`,
      });
    }
  }

  let score = 100;
  for (const is of issues) score -= is.level === "error" ? 35 : is.level === "warning" ? 10 : 0;
  score = Math.max(0, Math.min(100, score));

  return {
    triangles,
    bbox,
    size,
    volumeCm3: volume / 1000,
    surfaceAreaCm2: toCm2(area),
    horizontalAreaCm2: toCm2(horizontal),
    verticalAreaCm2: toCm2(vertical),
    watertight,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    invertedNormals,
    overhang: {
      areaCm2: toCm2(overhangArea),
      percent: overhangPercent,
      meanHeightMm: overhangArea > 0 ? overhangHeightWeighted / overhangArea : 0,
    },
    bedContactAreaCm2: bedCm2,
    needsSupports,
    fits,
    score,
    issues,
  };
}
