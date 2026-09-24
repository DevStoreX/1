import {
  type CompileResult,
  type MeshAnalysis,
  type ModelRecord,
  type ParamValue,
  type PrintEstimate,
  type Store,
  analyzeMesh,
  coerceParams,
  compileScad,
  estimatePrint,
  formatDuration,
  getPrinterProfile,
  loadMesh,
  parseSTL,
  parseScadParameters,
  scaleToLargestDimension,
  placeOnBed,
  toBinarySTL,
} from "@forja3d/core";
import type { ForjaSettings } from "./settings.ts";

export interface ModelResult {
  ok: boolean;
  model?: ModelRecord;
  compile?: CompileResult;
  estimate?: PrintEstimate;
  error?: string;
}

/** Lógica de modelos compartida por el agente, la API REST y el servidor MCP. */
export class ModelService {
  constructor(private store: Store, private settings: () => Promise<ForjaSettings>) {}

  private async analyze(stl: Uint8Array, printerProfile?: string): Promise<MeshAnalysis> {
    const s = await this.settings();
    const profile = getPrinterProfile(printerProfile ?? s.defaultPrinterProfile);
    return analyzeMesh(parseSTL(stl), { buildVolume: profile.buildVolume });
  }

  async estimateFor(analysis: MeshAnalysis, opts: { printerProfile?: string; material?: string; infillPercent?: number; layerHeightMm?: number } = {}): Promise<PrintEstimate> {
    const s = await this.settings();
    return estimatePrint(analysis, {
      printerId: opts.printerProfile ?? s.defaultPrinterProfile,
      materialId: opts.material ?? s.defaultMaterial,
      settings: { infillPercent: opts.infillPercent, layerHeightMm: opts.layerHeightMm },
    });
  }

  async createFromScad(input: { name: string; description?: string; source: string; values?: Record<string, unknown>; origin: string }): Promise<ModelResult> {
    const parameters = parseScadParameters(input.source);
    const values = coerceParams(parameters, input.values ?? {});
    const compile = await compileScad(input.source, { params: values });
    if (!compile.ok) return { ok: false, compile, error: compile.errors.join("\n") };
    const analysis = await this.analyze(compile.output!);
    const model = await this.store.createModel({
      name: input.name,
      kind: "scad",
      origin: input.origin,
      description: input.description,
      parameters,
      values,
      analysis,
      files: { "source.scad": input.source, "model.stl": compile.output! },
    });
    return { ok: true, model, compile, estimate: await this.estimateFor(analysis) };
  }

  async updateScad(id: string, input: { source?: string; values?: Record<string, unknown>; name?: string }): Promise<ModelResult> {
    const rec = await this.store.getModel(id);
    if (!rec) return { ok: false, error: `No existe el modelo ${id}` };
    if (rec.kind !== "scad") return { ok: false, error: "Este modelo es una malla importada: no tiene parámetros editables. Crea un modelo OpenSCAD nuevo." };
    const source = input.source ?? new TextDecoder().decode((await this.store.readModelFile(id, "source.scad")) ?? new Uint8Array());
    const parameters = parseScadParameters(source);
    // Conservamos los valores anteriores que sigan existiendo
    const previous: Record<string, ParamValue> = {};
    for (const [k, v] of Object.entries(rec.values ?? {})) if (parameters.some((p) => p.name === k)) previous[k] = v;
    const values = { ...previous, ...coerceParams(parameters, input.values ?? {}) };
    const compile = await compileScad(source, { params: values });
    if (!compile.ok) return { ok: false, compile, error: compile.errors.join("\n") };
    const analysis = await this.analyze(compile.output!);
    const model = await this.store.updateModel(
      id,
      { parameters, values, analysis, ...(input.name ? { name: input.name } : {}) },
      { "source.scad": source, "model.stl": compile.output! },
    );
    return { ok: true, model, compile, estimate: await this.estimateFor(analysis) };
  }

  async importMesh(input: { name: string; data: Uint8Array; fileName?: string; origin: string; description?: string; targetSizeMm?: number; extraFiles?: Record<string, Uint8Array> }): Promise<ModelResult> {
    let mesh = loadMesh(input.data, input.fileName);
    if (input.targetSizeMm) mesh = placeOnBed(scaleToLargestDimension(mesh, input.targetSizeMm));
    if (mesh.positions.length === 0) return { ok: false, error: "El archivo no contiene triángulos" };
    const stl = toBinarySTL(mesh);
    const analysis = await this.analyze(stl);
    const model = await this.store.createModel({
      name: input.name,
      kind: "mesh",
      origin: input.origin,
      description: input.description,
      analysis,
      files: { "model.stl": stl, ...(input.extraFiles ?? {}) },
    });
    return { ok: true, model, estimate: await this.estimateFor(analysis) };
  }

  async rescaleMesh(id: string, targetSizeMm: number): Promise<ModelResult> {
    const rec = await this.store.getModel(id);
    const stl = await this.store.readModelFile(id, "model.stl");
    if (!rec || !stl) return { ok: false, error: `No existe el modelo ${id}` };
    if (rec.kind === "scad") return { ok: false, error: "Los modelos OpenSCAD se escalan cambiando sus parámetros (update_model)." };
    const mesh = placeOnBed(scaleToLargestDimension(parseSTL(stl), targetSizeMm));
    const out = toBinarySTL(mesh);
    const analysis = await this.analyze(out);
    const model = await this.store.updateModel(id, { analysis }, { "model.stl": out });
    return { ok: true, model, estimate: await this.estimateFor(analysis) };
  }

  async reanalyze(id: string, printerProfile?: string): Promise<{ analysis: MeshAnalysis; model: ModelRecord } | null> {
    const rec = await this.store.getModel(id);
    const stl = await this.store.readModelFile(id, "model.stl");
    if (!rec || !stl) return null;
    return { analysis: await this.analyze(stl, printerProfile), model: rec };
  }
}

/** Resumen compacto para el modelo de lenguaje (menos tokens = menos costo). */
export function summarizeModel(model: ModelRecord, estimate?: PrintEstimate): Record<string, unknown> {
  const a = model.analysis;
  return {
    model_id: model.id,
    name: model.name,
    version: model.version,
    kind: model.kind,
    size_mm: a ? a.size.map((v) => Math.round(v * 10) / 10) : undefined,
    volume_cm3: a ? Math.round(a.volumeCm3 * 100) / 100 : undefined,
    triangles: a?.triangles,
    watertight: a?.watertight,
    needs_supports: a?.needsSupports,
    fits_printer: a?.fits ? a.fits.fits || (a.fits.fitsRotated ? "rotándola" : false) : undefined,
    printability_score: a?.score,
    issues: a?.issues.map((i) => `${i.level}: ${i.message}`),
    parameters: model.parameters?.map((p) => ({
      name: p.name,
      value: model.values?.[p.name] ?? p.value,
      ...(p.min !== undefined ? { min: p.min, max: p.max } : {}),
      ...(p.options ? { options: p.options.map((o) => o.value) } : {}),
      ...(p.description ? { description: p.description } : {}),
    })),
    estimate: estimate && {
      grams: estimate.grams,
      time: formatDuration(estimate.printSeconds),
      material: estimate.materialId,
      printer: estimate.printerId,
      note: estimate.accuracy,
    },
  };
}
