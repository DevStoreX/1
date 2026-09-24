import {
  GEN3D_PROVIDERS,
  MATERIALS,
  PRINTER_PROFILES,
  calculateCost,
  formatDuration,
  generate3D,
  searchModels,
  sliceStl,
  slicerAvailable,
  type Gen3DProviderId,
  type PrinterConfig,
} from "@forja3d/core";
import { z } from "zod";
import { summarizeModel } from "../models.ts";
import { createDetector } from "../vision.ts";
import { type ForjaTool, type ToolContext, fail, ok } from "./types.ts";

export * from "./types.ts";

function tool<S extends z.ZodType>(t: ForjaTool<S>): ForjaTool<S> {
  return t;
}

const paramValue = z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]);

async function findPrinter(ctx: ToolContext, id: string): Promise<PrinterConfig | null> {
  const list = await ctx.store.listPrinters();
  return list.find((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase()) ?? null;
}

function compileFailure(errors: string, warnings: string[] = []): string {
  return [
    "La compilación de OpenSCAD falló. Corrige el código y vuelve a llamar a la herramienta.",
    errors,
    warnings.length ? `Advertencias:\n${warnings.slice(0, 8).join("\n")}` : "",
    "Recuerda: un solo objeto 3D, sin include/use externos (salvo MCAD), text() usa fuentes Liberation.",
  ].filter(Boolean).join("\n\n");
}

export const createModelTool = tool({
  name: "create_model",
  description:
    "Diseña una pieza nueva escribiendo código OpenSCAD paramétrico. La compila a STL (motor Manifold), la analiza (malla cerrada, voladizos, si cabe en la impresora) y estima filamento y tiempo. Si falla devuelve los errores del compilador para que los corrijas. La app muestra el modelo 3D y los parámetros como controles deslizantes.",
  schema: z.object({
    name: z.string().describe("Nombre corto de la pieza, en el idioma de la persona"),
    description: z.string().optional().describe("Qué hace la pieza y cómo se usa (1-2 frases)"),
    scad_code: z.string().describe("Código OpenSCAD completo con los parámetros Customizer al inicio"),
  }),
  async run(input, ctx) {
    const r = await ctx.models.createFromScad({ name: input.name, description: input.description, source: input.scad_code, origin: "agent" });
    if (!r.ok) return fail(compileFailure(r.error ?? "Error desconocido", r.compile?.warnings));
    ctx.onModel?.(r.model!);
    return ok({ ...summarizeModel(r.model!, r.estimate), compile_ms: r.compile?.ms, echo: r.compile?.echo.slice(0, 10) });
  },
});

export const updateModelTool = tool({
  name: "update_model",
  description:
    "Modifica una pieza existente: cambia valores de sus parámetros (rápido, sin reescribir código) o reemplaza su código OpenSCAD. Crea una nueva versión del mismo modelo.",
  schema: z.object({
    model_id: z.string(),
    parameters: z.record(z.string(), paramValue).optional().describe("Nuevos valores, p. ej. {\"ancho\": 60}"),
    scad_code: z.string().optional().describe("Código OpenSCAD completo nuevo (solo si cambia el diseño)"),
    name: z.string().optional(),
  }),
  async run(input, ctx) {
    if (!input.parameters && !input.scad_code && !input.name) return fail("Indica parameters, scad_code o name");
    const r = await ctx.models.updateScad(input.model_id, { source: input.scad_code, values: input.parameters, name: input.name });
    if (!r.ok) return fail(r.compile ? compileFailure(r.error ?? "", r.compile.warnings) : r.error ?? "Error");
    ctx.onModel?.(r.model!);
    return ok(summarizeModel(r.model!, r.estimate));
  },
});

export const getModelTool = tool({
  name: "get_model",
  description: "Devuelve los datos de un modelo guardado, incluido su código OpenSCAD, para poder modificarlo.",
  schema: z.object({ model_id: z.string() }),
  async run(input, ctx) {
    const rec = await ctx.store.getModel(input.model_id);
    if (!rec) return fail(`No existe el modelo ${input.model_id}`);
    const src = await ctx.store.readModelFile(rec.id, "source.scad");
    return ok({ ...summarizeModel(rec), description: rec.description, scad_code: src ? new TextDecoder().decode(src) : undefined });
  },
});

export const listModelsTool = tool({
  name: "list_models",
  description: "Lista los modelos guardados más recientes.",
  schema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  async run(input, ctx) {
    const list = await ctx.store.listModels();
    return ok(list.slice(0, input.limit ?? 15).map((m) => ({ model_id: m.id, name: m.name, kind: m.kind, updated: m.updatedAt, origin: m.origin })));
  },
});

export const analyzeModelTool = tool({
  name: "analyze_model",
  description:
    "Analiza la imprimibilidad de un modelo para un perfil de impresora concreto y estima gramos y tiempo con los ajustes indicados.",
  schema: z.object({
    model_id: z.string(),
    printer_profile: z.string().optional().describe(`Perfil: ${PRINTER_PROFILES.map((p) => p.id).join(", ")}`),
    material: z.string().optional().describe(`Material: ${Object.keys(MATERIALS).join(", ")}`),
    infill_percent: z.number().min(0).max(100).optional(),
    layer_height_mm: z.number().min(0.04).max(0.6).optional(),
    rescale_largest_dimension_mm: z.number().positive().optional().describe("Solo para mallas importadas: escala la pieza para que su lado mayor mida esto"),
  }),
  async run(input, ctx) {
    if (input.rescale_largest_dimension_mm) {
      const r = await ctx.models.rescaleMesh(input.model_id, input.rescale_largest_dimension_mm);
      if (!r.ok) return fail(r.error!);
      ctx.onModel?.(r.model!);
    }
    const res = await ctx.models.reanalyze(input.model_id, input.printer_profile);
    if (!res) return fail(`No existe el modelo ${input.model_id}`);
    const est = await ctx.models.estimateFor(res.analysis, {
      printerProfile: input.printer_profile,
      material: input.material,
      infillPercent: input.infill_percent,
      layerHeightMm: input.layer_height_mm,
    });
    return ok({ ...summarizeModel({ ...res.model, analysis: res.analysis }, est), overhang: res.analysis.overhang, bed_contact_cm2: res.analysis.bedContactAreaCm2, support_grams: est.supportGrams });
  },
});

export const estimatePriceTool = tool({
  name: "estimate_price",
  description:
    "Calcula el costo real de imprimir (material, electricidad, desgaste, trabajo, fallos) y un precio de venta justo con comisiones e impuestos. Usa model_id o indica gramos y horas.",
  schema: z.object({
    model_id: z.string().optional(),
    grams: z.number().positive().optional(),
    print_hours: z.number().positive().optional(),
    material: z.string().optional(),
    printer_profile: z.string().optional(),
    quantity: z.number().int().min(1).max(10000).optional(),
    currency: z.string().optional(),
    filament_price_per_kg: z.number().positive().optional(),
    electricity_per_kwh: z.number().min(0).optional(),
    labor_minutes: z.number().min(0).optional(),
    labor_per_hour: z.number().min(0).optional(),
    platform_fee_percent: z.number().min(0).max(60).optional(),
    tax_percent: z.number().min(0).max(60).optional(),
    margin_percent: z.number().min(0).max(1000).optional(),
    packaging: z.number().min(0).optional(),
  }),
  async run(input, ctx) {
    const s = ctx.settings;
    let grams = input.grams;
    let seconds = input.print_hours ? input.print_hours * 3600 : undefined;
    if (input.model_id) {
      const res = await ctx.models.reanalyze(input.model_id, input.printer_profile);
      if (!res) return fail(`No existe el modelo ${input.model_id}`);
      const est = await ctx.models.estimateFor(res.analysis, { printerProfile: input.printer_profile, material: input.material });
      grams ??= est.grams;
      seconds ??= est.printSeconds;
    }
    if (!grams || !seconds) return fail("Necesito model_id o bien grams y print_hours");
    const qty = input.quantity ?? 1;
    const cost = calculateCost({
      grams,
      printSeconds: seconds,
      materialId: input.material ?? s.defaultMaterial,
      printerId: input.printer_profile ?? s.defaultPrinterProfile,
      currency: input.currency ?? s.currency,
      filamentPricePerKg: input.filament_price_per_kg ?? s.filamentPricePerKg,
      electricityPerKwh: input.electricity_per_kwh ?? s.electricityPerKwh,
      laborMinutes: input.labor_minutes,
      laborPerHour: input.labor_per_hour ?? s.laborPerHour,
      platformFeePercent: input.platform_fee_percent ?? s.platformFeePercent,
      taxPercent: input.tax_percent,
      marginPercent: input.margin_percent ?? s.marginPercent,
      packaging: input.packaging,
    });
    return ok({ per_unit: cost, quantity: qty, total_price: Math.round(cost.suggestedPrice * qty * 100) / 100, print_time: formatDuration(seconds), grams });
  },
});

export const searchModelsTool = tool({
  name: "search_models",
  description:
    "Busca si ya existen modelos para imprimir de un objeto o invento (Printables, MakerWorld, Thingiverse, Thangs, Cults3D...) y en patentes. Devuelve enlaces de búsqueda directa y, si hay token, resultados de Thingiverse. Respeta las licencias de los diseños ajenos.",
  schema: z.object({ query: z.string().describe("Términos de búsqueda, mejor en inglés para más resultados") }),
  async run(input, ctx) {
    const r = await searchModels(input.query, { thingiverseToken: ctx.settings.thingiverseToken });
    return ok(r);
  },
});

export const generateMeshTool = tool({
  name: "generate_organic_mesh",
  description:
    `Genera una malla 3D orgánica (figura, personaje, animal, escultura) desde la última imagen adjunta o desde un texto, usando modelos abiertos a precio de costo. NO la uses para piezas funcionales con medidas (usa create_model). Proveedores: ${GEN3D_PROVIDERS.map((p) => `${p.id} (~$${p.costUsd})`).join(", ")}. Avisa del costo antes de usarla.`,
  schema: z.object({
    name: z.string(),
    prompt: z.string().optional().describe("Descripción visual del objeto, en inglés, si no hay imagen"),
    use_attached_image: z.boolean().optional().describe("Usar la imagen más reciente que adjuntó la persona"),
    provider: z.enum(["fal-trellis", "fal-hunyuan3d", "hunyuan3d-local"]).optional(),
    target_height_mm: z.number().min(5).max(400).optional().describe("Tamaño final del lado mayor en mm (por defecto 60)"),
  }),
  async run(input, ctx) {
    const s = ctx.settings;
    const provider: Gen3DProviderId = input.provider ?? (s.hunyuanUrl ? "hunyuan3d-local" : "fal-trellis");
    const att = input.use_attached_image ? ctx.attachments[0] : undefined;
    if (input.use_attached_image && !att) return fail("No hay ninguna imagen adjunta en la conversación.");
    if (!att && !input.prompt) return fail("Necesito una imagen adjunta o un prompt.");
    try {
      const r = await generate3D(
        { provider, image: att ? `data:${att.mime};base64,${att.data}` : undefined, prompt: input.prompt },
        { falKey: s.falKey, hunyuanUrl: s.hunyuanUrl },
      );
      await ctx.recordUsage?.({ kind: "gen3d", provider, costUsd: r.costUsd, conversationId: ctx.conversationId, note: input.name });
      const imported = await ctx.models.importMesh({
        name: input.name,
        data: r.glb,
        fileName: "gen.glb",
        origin: `gen3d:${provider}`,
        description: input.prompt,
        targetSizeMm: input.target_height_mm ?? 60,
        extraFiles: { "source.glb": r.glb },
      });
      if (!imported.ok) return fail(imported.error!);
      ctx.onModel?.(imported.model!);
      return ok({ ...summarizeModel(imported.model!, imported.estimate), cost_usd: r.costUsd, seconds: Math.round(r.seconds) });
    } catch (e) {
      return fail(`No se pudo generar la malla: ${(e as Error).message}`);
    }
  },
});

export const listPrintersTool = tool({
  name: "list_printers",
  description: "Lista las impresoras conectadas y su estado actual (temperaturas, progreso).",
  schema: z.object({}),
  async run(_input, ctx) {
    const list = await ctx.store.listPrinters();
    const out = await Promise.all(
      list.map(async (p) => {
        try {
          return { printer_id: p.id, name: p.name, kind: p.kind, profile: p.profileId, status: await ctx.printers.get(p).status() };
        } catch (e) {
          return { printer_id: p.id, name: p.name, kind: p.kind, status: { online: false, state: "offline", message: (e as Error).message } };
        }
      }),
    );
    return ok(out.length ? out : "No hay impresoras configuradas. La persona puede añadirlas en la pestaña Impresoras.");
  },
});

export const printerControlTool = tool({
  name: "printer_control",
  description:
    "Controla una impresora: pause, resume o cancel. Para cancel, pide antes confirmación explícita a la persona y envía confirmed=true.",
  schema: z.object({
    printer_id: z.string(),
    action: z.enum(["pause", "resume", "cancel"]),
    confirmed: z.boolean().optional(),
  }),
  async run(input, ctx) {
    const cfg = await findPrinter(ctx, input.printer_id);
    if (!cfg) return fail(`No existe la impresora ${input.printer_id}`);
    if (input.action === "cancel" && !input.confirmed) return fail("Cancelar una impresión no se puede deshacer: pide confirmación a la persona y repite con confirmed=true.");
    const c = ctx.printers.get(cfg);
    await c[input.action]();
    return ok({ done: true, action: input.action, status: await c.status().catch(() => undefined) });
  },
});

export const sendToPrinterTool = tool({
  name: "send_to_printer",
  description:
    "Envía un modelo a una impresora. Usa el G-code/3MF laminado guardado en el modelo o, si hay laminador configurado, lamina el STL. Solo inicia la impresión (start=true) si la persona lo pidió expresamente.",
  schema: z.object({ printer_id: z.string(), model_id: z.string(), start: z.boolean().optional() }),
  async run(input, ctx) {
    const cfg = await findPrinter(ctx, input.printer_id);
    if (!cfg) return fail(`No existe la impresora ${input.printer_id}`);
    const rec = await ctx.store.getModel(input.model_id);
    if (!rec) return fail(`No existe el modelo ${input.model_id}`);
    const sliced = rec.files.find((f) => /\.(gcode|bgcode|3mf)$/i.test(f) && f !== "source.glb");
    let fileName: string;
    let data: Uint8Array | null;
    if (sliced) {
      fileName = `${rec.name.replace(/[^\w-]+/g, "_").slice(0, 40)}_${rec.id}.${sliced.split(".").slice(1).join(".")}`;
      data = await ctx.store.readModelFile(rec.id, sliced);
    } else if (slicerAvailable()) {
      const stl = await ctx.store.readModelFile(rec.id, "model.stl");
      const r = await sliceStl(stl!);
      if (!r.ok) return fail(`El laminado falló:\n${r.log.slice(-10).join("\n")}`);
      fileName = `${rec.name.replace(/[^\w-]+/g, "_").slice(0, 40)}_${rec.id}.gcode`;
      data = r.gcode!;
      await ctx.store.updateModel(rec.id, {}, { "print.gcode": data });
    } else {
      return fail(
        "Este modelo aún no está laminado y no hay laminador configurado. Pide a la persona que descargue el STL, lo lamine (Bambu Studio, OrcaSlicer, PrusaSlicer o Cura) y suba el G-code/3MF en la pestaña del modelo; luego vuelve a enviarlo.",
      );
    }
    if (!data) return fail("No se encontró el archivo laminado");
    const c = ctx.printers.get(cfg);
    await c.upload(fileName, data, { startPrint: !!input.start });
    return ok({ uploaded: fileName, started: !!input.start });
  },
});

export const checkCameraTool = tool({
  name: "check_camera",
  description:
    "Toma una foto de la cámara de la impresora y la revisa con IA para detectar fallos (espagueti, pieza despegada, grumos). Devuelve el veredicto y la imagen. Cuesta ~$0.001–0.01 por revisión con modelos de visión (gratis con Obico).",
  schema: z.object({ printer_id: z.string() }),
  async run(input, ctx) {
    const cfg = await findPrinter(ctx, input.printer_id);
    if (!cfg) return fail(`No existe la impresora ${input.printer_id}`);
    const c = ctx.printers.get(cfg);
    const snap = await c.snapshot().catch((e: Error) => {
      throw new Error(`No se pudo obtener la imagen: ${e.message}`);
    });
    if (!snap) return fail("Esta impresora no tiene cámara configurada (añade cameraUrl en sus ajustes).");
    if (!ctx.vision) return fail("No hay modelo de visión configurado");
    const detector = createDetector(ctx.settings, ctx.vision);
    const status = await c.status().catch(() => undefined);
    const check = await detector.check(snap, { printerName: cfg.name, status, snapshotUrl: ctx.publicUrl ? `${ctx.publicUrl}/api/printers/${cfg.id}/snapshot` : undefined });
    return ok({ ...check, status }, [{ type: "image", mime: snap.mime, data: Buffer.from(snap.data).toString("base64") }]);
  },
});

export const cameraMonitorTool = tool({
  name: "set_camera_monitor",
  description:
    "Activa o desactiva la vigilancia automática de la cámara durante la impresión. Si detecta un fallo confirmado dos veces seguidas y auto_pause=true, pausa la impresora.",
  schema: z.object({
    printer_id: z.string(),
    enabled: z.boolean(),
    interval_sec: z.number().int().min(10).max(3600).optional(),
    auto_pause: z.boolean().optional(),
  }),
  async run(input, ctx) {
    const cfg = await findPrinter(ctx, input.printer_id);
    if (!cfg) return fail(`No existe la impresora ${input.printer_id}`);
    if (!input.enabled) {
      ctx.monitor.stop(cfg.id);
      return ok({ enabled: false });
    }
    if (!ctx.vision) return fail("No hay modelo de visión configurado");
    const vision = ctx.vision;
    const settings = ctx.settings;
    const state = ctx.monitor.start(
      cfg.id,
      {
        connector: () => ctx.printers.get(cfg),
        detector: () => createDetector(settings, vision),
        printerName: cfg.name,
        snapshotUrl: ctx.publicUrl ? `${ctx.publicUrl}/api/printers/${cfg.id}/snapshot` : undefined,
      },
      { intervalSec: input.interval_sec, autoPause: input.auto_pause },
    );
    const perHour = settings.cameraDetector === "obico" ? 0 : (3600 / state.options.intervalSec) * 0.002;
    return ok({ enabled: true, ...state.options, estimated_cost_per_hour_usd: Math.round(perHour * 1000) / 1000 });
  },
});

export const referenceTool = tool({
  name: "reference_data",
  description: "Datos de referencia: materiales (temperaturas, dificultad, aptos para niños) y perfiles de impresoras (volumen de impresión).",
  schema: z.object({ topic: z.enum(["materials", "printers"]) }),
  async run(input) {
    if (input.topic === "materials") return ok(Object.values(MATERIALS));
    return ok(PRINTER_PROFILES.map((p) => ({ id: p.id, name: p.name, build_volume_mm: p.buildVolume, enclosed: p.enclosed, connector: p.connector })));
  },
});

export const ALL_TOOLS: ForjaTool[] = [
  createModelTool,
  updateModelTool,
  getModelTool,
  listModelsTool,
  analyzeModelTool,
  estimatePriceTool,
  searchModelsTool,
  generateMeshTool,
  listPrintersTool,
  printerControlTool,
  sendToPrinterTool,
  checkCameraTool,
  cameraMonitorTool,
  referenceTool,
] as ForjaTool[];

/** Esquema JSON de la herramienta (sin la clave $schema, que la API no necesita). */
export function toolJsonSchema(t: ForjaTool): Record<string, unknown> {
  const schema = z.toJSONSchema(t.schema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
