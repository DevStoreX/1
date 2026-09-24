import type { BuildVolume } from "../geometry/analyze.ts";

export interface PrinterProfile {
  id: string;
  name: string;
  buildVolume: BuildVolume;
  /** Caudal volumétrico medio efectivo durante toda la impresión (mm³/s), incluye paredes lentas y viajes */
  avgFlowMm3s: number;
  /** Segundos extra por capa (cambio de capa, retracciones, limpieza) */
  secondsPerLayer: number;
  /** Consumo eléctrico medio (W) */
  watts: number;
  /** Precio aproximado de la impresora (USD), para calcular desgaste */
  priceUsd: number;
  /** Conector recomendado */
  connector: "bambu" | "moonraker" | "octoprint" | "prusalink" | "none";
  enclosed: boolean;
}

export const PRINTER_PROFILES: PrinterProfile[] = [
  { id: "bambu-a1-mini", name: "Bambu Lab A1 mini", buildVolume: { x: 180, y: 180, z: 180 }, avgFlowMm3s: 9, secondsPerLayer: 3, watts: 80, priceUsd: 250, connector: "bambu", enclosed: false },
  { id: "bambu-a1", name: "Bambu Lab A1", buildVolume: { x: 256, y: 256, z: 256 }, avgFlowMm3s: 10, secondsPerLayer: 3, watts: 95, priceUsd: 400, connector: "bambu", enclosed: false },
  { id: "bambu-p1s", name: "Bambu Lab P1S / P2S", buildVolume: { x: 256, y: 256, z: 256 }, avgFlowMm3s: 12, secondsPerLayer: 3, watts: 110, priceUsd: 600, connector: "bambu", enclosed: true },
  { id: "bambu-x1c", name: "Bambu Lab X1 Carbon", buildVolume: { x: 256, y: 256, z: 256 }, avgFlowMm3s: 13, secondsPerLayer: 3, watts: 120, priceUsd: 1200, connector: "bambu", enclosed: true },
  { id: "bambu-h2d", name: "Bambu Lab H2D", buildVolume: { x: 325, y: 320, z: 325 }, avgFlowMm3s: 14, secondsPerLayer: 3, watts: 200, priceUsd: 2000, connector: "bambu", enclosed: true },
  { id: "prusa-mk4s", name: "Prusa MK4S", buildVolume: { x: 250, y: 210, z: 220 }, avgFlowMm3s: 9, secondsPerLayer: 3, watts: 90, priceUsd: 800, connector: "prusalink", enclosed: false },
  { id: "prusa-core-one", name: "Prusa CORE One", buildVolume: { x: 250, y: 220, z: 270 }, avgFlowMm3s: 11, secondsPerLayer: 3, watts: 110, priceUsd: 1200, connector: "prusalink", enclosed: true },
  { id: "prusa-mini", name: "Prusa MINI+", buildVolume: { x: 180, y: 180, z: 180 }, avgFlowMm3s: 5, secondsPerLayer: 4, watts: 60, priceUsd: 460, connector: "prusalink", enclosed: false },
  { id: "creality-k1", name: "Creality K1 / K1C", buildVolume: { x: 220, y: 220, z: 250 }, avgFlowMm3s: 11, secondsPerLayer: 3, watts: 120, priceUsd: 400, connector: "moonraker", enclosed: true },
  { id: "creality-k2-plus", name: "Creality K2 Plus", buildVolume: { x: 350, y: 350, z: 350 }, avgFlowMm3s: 13, secondsPerLayer: 3, watts: 250, priceUsd: 1200, connector: "moonraker", enclosed: true },
  { id: "creality-ender3-v3", name: "Creality Ender-3 V3 / V3 SE", buildVolume: { x: 220, y: 220, z: 250 }, avgFlowMm3s: 6, secondsPerLayer: 4, watts: 110, priceUsd: 200, connector: "octoprint", enclosed: false },
  { id: "elegoo-neptune4", name: "Elegoo Neptune 4 / 4 Pro", buildVolume: { x: 225, y: 225, z: 265 }, avgFlowMm3s: 8, secondsPerLayer: 3, watts: 120, priceUsd: 250, connector: "moonraker", enclosed: false },
  { id: "anycubic-kobra3", name: "Anycubic Kobra 3", buildVolume: { x: 250, y: 250, z: 260 }, avgFlowMm3s: 8, secondsPerLayer: 3, watts: 120, priceUsd: 300, connector: "none", enclosed: false },
  { id: "voron-2.4", name: "Voron 2.4 (350)", buildVolume: { x: 350, y: 350, z: 340 }, avgFlowMm3s: 14, secondsPerLayer: 3, watts: 200, priceUsd: 1500, connector: "moonraker", enclosed: true },
  { id: "generic", name: "Impresora genérica (220×220×250)", buildVolume: { x: 220, y: 220, z: 250 }, avgFlowMm3s: 6, secondsPerLayer: 4, watts: 120, priceUsd: 300, connector: "none", enclosed: false },
];

export function getPrinterProfile(id: string | undefined): PrinterProfile {
  return PRINTER_PROFILES.find((p) => p.id === id) ?? PRINTER_PROFILES[PRINTER_PROFILES.length - 1];
}
