export interface Material {
  id: string;
  name: string;
  /** g/cm³ */
  density: number;
  /** Precio de referencia por kg (USD). Configurable por el usuario. */
  pricePerKg: number;
  nozzleC: [number, number];
  bedC: [number, number];
  difficulty: 1 | 2 | 3;
  /** Apto para usar con niños con supervisión (sin cámara cerrada ni vapores fuertes) */
  kidFriendly: boolean;
  notes: string;
}

export const MATERIALS: Record<string, Material> = {
  PLA: {
    id: "PLA", name: "PLA", density: 1.24, pricePerKg: 18, nozzleC: [190, 220], bedC: [50, 65], difficulty: 1, kidFriendly: true,
    notes: "El más fácil. Ideal para empezar, juguetes, prototipos y decoración. No resiste calor (>55 °C).",
  },
  PETG: {
    id: "PETG", name: "PETG", density: 1.27, pricePerKg: 20, nozzleC: [220, 250], bedC: [70, 85], difficulty: 2, kidFriendly: true,
    notes: "Más resistente y flexible que PLA; soporta agua y algo de calor. Bueno para piezas funcionales.",
  },
  TPU: {
    id: "TPU", name: "TPU (flexible)", density: 1.21, pricePerKg: 28, nozzleC: [210, 235], bedC: [40, 60], difficulty: 2, kidFriendly: true,
    notes: "Goma flexible: fundas, sellos, ruedas. Imprimir lento.",
  },
  ABS: {
    id: "ABS", name: "ABS", density: 1.04, pricePerKg: 20, nozzleC: [230, 260], bedC: [95, 110], difficulty: 3, kidFriendly: false,
    notes: "Resiste calor e impactos. Necesita cámara cerrada y ventilación (emite vapores).",
  },
  ASA: {
    id: "ASA", name: "ASA", density: 1.07, pricePerKg: 24, nozzleC: [235, 260], bedC: [90, 110], difficulty: 3, kidFriendly: false,
    notes: "Como ABS pero resistente al sol (UV). Ideal para exteriores. Requiere ventilación.",
  },
  PA: {
    id: "PA", name: "Nylon (PA)", density: 1.14, pricePerKg: 45, nozzleC: [250, 280], bedC: [70, 100], difficulty: 3, kidFriendly: false,
    notes: "Muy resistente al desgaste: engranajes y bisagras. Absorbe humedad, requiere secado.",
  },
  "PLA-CF": {
    id: "PLA-CF", name: "PLA con fibra de carbono", density: 1.3, pricePerKg: 35, nozzleC: [200, 230], bedC: [50, 65], difficulty: 2, kidFriendly: true,
    notes: "Rígido y con acabado mate. Requiere boquilla endurecida.",
  },
  PC: {
    id: "PC", name: "Policarbonato (PC)", density: 1.2, pricePerKg: 40, nozzleC: [260, 300], bedC: [100, 120], difficulty: 3, kidFriendly: false,
    notes: "Muy resistente al calor y a golpes. Difícil de imprimir.",
  },
};

export function getMaterial(id: string | undefined): Material {
  if (!id) return MATERIALS.PLA;
  const key = Object.keys(MATERIALS).find((k) => k.toLowerCase() === id.toLowerCase());
  return key ? MATERIALS[key] : MATERIALS.PLA;
}
