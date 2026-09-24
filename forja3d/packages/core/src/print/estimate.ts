import type { MeshAnalysis } from "../geometry/analyze.ts";
import { getMaterial } from "./materials.ts";
import { getPrinterProfile } from "./printer-profiles.ts";

export interface SliceSettings {
  layerHeightMm?: number;
  nozzleMm?: number;
  /** 0–100 */
  infillPercent?: number;
  wallLoops?: number;
  topBottomLayers?: number;
  supports?: "auto" | "on" | "off";
  filamentDiameterMm?: number;
}

export interface PrintEstimate {
  materialId: string;
  printerId: string;
  grams: number;
  filamentMeters: number;
  supportGrams: number;
  printSeconds: number;
  layers: number;
  settings: Required<SliceSettings>;
  /** Estimación geométrica: ±25 % frente a un laminador real */
  accuracy: string;
}

export function estimatePrint(
  analysis: MeshAnalysis,
  opts: { materialId?: string; printerId?: string; settings?: SliceSettings } = {},
): PrintEstimate {
  const material = getMaterial(opts.materialId);
  const printer = getPrinterProfile(opts.printerId);
  const s: Required<SliceSettings> = {
    layerHeightMm: 0.2,
    nozzleMm: 0.4,
    infillPercent: 15,
    wallLoops: 2,
    topBottomLayers: 4,
    supports: "auto",
    filamentDiameterMm: 1.75,
    // Ignoramos los valores undefined para no pisar los valores por defecto
    ...Object.fromEntries(Object.entries(opts.settings ?? {}).filter(([, v]) => v !== undefined && v !== null)),
  };
  const lineWidth = s.nozzleMm * 1.125;
  const wallThickness = s.wallLoops * lineWidth; // mm
  const topBottomThickness = s.topBottomLayers * s.layerHeightMm; // mm

  const volumeMm3 = analysis.volumeCm3 * 1000;
  // Carcasa: paredes verticales + capas superiores e inferiores (cada cara horizontal es techo o suelo)
  const shellMm3 = Math.min(
    volumeMm3,
    analysis.verticalAreaCm2 * 100 * wallThickness + analysis.horizontalAreaCm2 * 100 * topBottomThickness,
  );
  const interiorMm3 = Math.max(0, volumeMm3 - shellMm3);
  const partMm3 = shellMm3 + interiorMm3 * (s.infillPercent / 100);

  const useSupports = s.supports === "on" || (s.supports === "auto" && analysis.needsSupports);
  // Soportes: columna bajo el área en voladizo con ~15 % de densidad
  const supportMm3 = useSupports ? analysis.overhang.areaCm2 * 100 * analysis.overhang.meanHeightMm * 0.15 : 0;

  const totalMm3 = partMm3 + supportMm3;
  const grams = (totalMm3 / 1000) * material.density;
  const filamentArea = Math.PI * (s.filamentDiameterMm / 2) ** 2;
  const filamentMeters = totalMm3 / filamentArea / 1000;

  const layers = Math.max(1, Math.ceil(analysis.size[2] / s.layerHeightMm));
  // Materiales difíciles se imprimen más lento
  const flow = printer.avgFlowMm3s * (material.difficulty === 3 ? 0.8 : material.id === "TPU" ? 0.4 : 1);
  // Capas finas = más líneas por volumen; ajustamos respecto a 0.2 mm
  const layerFactor = Math.max(0.6, Math.min(2.5, 0.2 / s.layerHeightMm));
  const printSeconds = (totalMm3 / flow) * Math.sqrt(layerFactor) + layers * printer.secondsPerLayer + 180;

  return {
    materialId: material.id,
    printerId: printer.id,
    grams: round(grams, 1),
    filamentMeters: round(filamentMeters, 2),
    supportGrams: round((supportMm3 / 1000) * material.density, 1),
    printSeconds: Math.round(printSeconds),
    layers,
    settings: s,
    accuracy: "Estimación geométrica ±25 %. Para el dato exacto, lamina el modelo.",
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
