import { getMaterial } from "./materials.ts";
import { getPrinterProfile } from "./printer-profiles.ts";
import { round } from "./estimate.ts";

export interface CostInputs {
  grams: number;
  printSeconds: number;
  materialId?: string;
  printerId?: string;
  currency?: string;
  /** Precio del filamento por kg (en `currency`). Si falta, se usa el de referencia. */
  filamentPricePerKg?: number;
  /** Precio de la electricidad por kWh */
  electricityPerKwh?: number;
  /** Precio de la impresora (para el desgaste) */
  printerPrice?: number;
  /** Vida útil estimada de la impresora en horas de impresión */
  printerLifetimeHours?: number;
  /** Mantenimiento por hora (boquillas, correas, PEI...) */
  maintenancePerHour?: number;
  /** Minutos de trabajo humano (preparar, retirar soportes, lijar, empaquetar) */
  laborMinutes?: number;
  laborPerHour?: number;
  /** Porcentaje de impresiones fallidas a cubrir (0–100) */
  failureRatePercent?: number;
  packaging?: number;
  /** Comisión de la plataforma de venta (0–100) */
  platformFeePercent?: number;
  /** Impuestos sobre la venta (0–100) */
  taxPercent?: number;
  /** Margen de ganancia deseado sobre el costo (0–1000) */
  marginPercent?: number;
}

export interface CostBreakdown {
  currency: string;
  material: number;
  electricity: number;
  depreciation: number;
  maintenance: number;
  labor: number;
  failureBuffer: number;
  packaging: number;
  totalCost: number;
  /** Precio que cubre costos, comisiones e impuestos sin ganancia */
  breakEvenPrice: number;
  suggestedPrice: number;
  profit: number;
  tiers: { name: string; marginPercent: number; price: number }[];
  explanation: string[];
}

/** Precio de venta tal que, tras comisiones e impuestos, quede el costo más el margen. */
function priceFor(cost: number, marginPercent: number, feePercent: number, taxPercent: number): number {
  const net = 1 - feePercent / 100 - taxPercent / 100;
  return (cost * (1 + marginPercent / 100)) / Math.max(0.05, net);
}

export function calculateCost(input: CostInputs): CostBreakdown {
  const material = getMaterial(input.materialId);
  const printer = getPrinterProfile(input.printerId);
  const currency = input.currency ?? "USD";
  const hours = input.printSeconds / 3600;

  const pricePerKg = input.filamentPricePerKg ?? material.pricePerKg;
  const materialCost = (input.grams / 1000) * pricePerKg;
  const electricity = hours * (printer.watts / 1000) * (input.electricityPerKwh ?? 0.15);
  const depreciation = hours * ((input.printerPrice ?? printer.priceUsd) / (input.printerLifetimeHours ?? 5000));
  const maintenance = hours * (input.maintenancePerHour ?? 0.05);
  const labor = ((input.laborMinutes ?? 10) / 60) * (input.laborPerHour ?? 5);
  const packaging = input.packaging ?? 0;
  const base = materialCost + electricity + depreciation + maintenance;
  const failureBuffer = base * ((input.failureRatePercent ?? 10) / 100);
  const totalCost = base + failureBuffer + labor + packaging;

  const fee = input.platformFeePercent ?? 0;
  const tax = input.taxPercent ?? 0;
  const margin = input.marginPercent ?? 40;
  const suggestedPrice = priceFor(totalCost, margin, fee, tax);
  const breakEvenPrice = priceFor(totalCost, 0, fee, tax);

  const tiers = [
    { name: "Precio justo (amigos, escuelas)", marginPercent: 20 },
    { name: "Venta local", marginPercent: 60 },
    { name: "Tienda en línea", marginPercent: 120 },
  ].map((t) => ({ ...t, price: round(priceFor(totalCost, t.marginPercent, fee, tax)) }));

  const pct = (x: number) => (totalCost > 0 ? Math.round((x / totalCost) * 100) : 0);
  return {
    currency,
    material: round(materialCost, 3),
    electricity: round(electricity, 3),
    depreciation: round(depreciation, 3),
    maintenance: round(maintenance, 3),
    labor: round(labor, 3),
    failureBuffer: round(failureBuffer, 3),
    packaging: round(packaging, 3),
    totalCost: round(totalCost, 2),
    breakEvenPrice: round(breakEvenPrice, 2),
    suggestedPrice: round(suggestedPrice, 2),
    profit: round(suggestedPrice * (1 - fee / 100 - tax / 100) - totalCost, 2),
    tiers,
    explanation: [
      `Material: ${input.grams} g de ${material.name} a ${pricePerKg} ${currency}/kg (${pct(materialCost)}% del costo).`,
      `Máquina: ${round(hours, 2)} h de impresión (electricidad + desgaste + mantenimiento = ${pct(electricity + depreciation + maintenance)}%).`,
      `Trabajo humano: ${input.laborMinutes ?? 10} min (${pct(labor)}%).`,
      `Colchón por fallos: ${input.failureRatePercent ?? 10}% del costo de impresión.`,
      fee || tax ? `Comisiones ${fee}% e impuestos ${tax}% incluidos en el precio.` : "Sin comisiones ni impuestos configurados.",
    ],
  };
}
