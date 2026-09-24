import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MeshAnalysis } from "../geometry/analyze.ts";
import type { ParamValue, ScadParameter } from "../cad/params.ts";
import type { PrinterConfig } from "../printers/types.ts";

export interface ModelRecord {
  id: string;
  name: string;
  kind: "scad" | "mesh";
  createdAt: string;
  updatedAt: string;
  /** Origen: "agent", "upload", "gen3d:fal-trellis", "mcp"... */
  origin: string;
  description?: string;
  parameters?: ScadParameter[];
  values?: Record<string, ParamValue>;
  analysis?: MeshAnalysis;
  /** Archivos guardados junto al modelo */
  files: string[];
  version: number;
}

export interface UsageEntry {
  at: string;
  kind: "llm" | "gen3d" | "vision" | "search";
  provider: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  conversationId?: string;
  note?: string;
}

const SAFE_FILE = /^[\w.-]+$/;

export function newId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Almacenamiento local en archivos JSON: sin base de datos que instalar. */
export class Store {
  private locks = new Map<string, Promise<unknown>>();

  constructor(readonly dir: string) {}

  private p(...parts: string[]): string {
    return path.join(this.dir, ...parts);
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next.catch(() => {}));
    return next;
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file);
  }

  // ---------- Modelos ----------
  async createModel(input: {
    name: string;
    kind: ModelRecord["kind"];
    origin: string;
    description?: string;
    parameters?: ScadParameter[];
    values?: Record<string, ParamValue>;
    analysis?: MeshAnalysis;
    files: Record<string, Uint8Array | string>;
  }): Promise<ModelRecord> {
    const id = newId();
    const now = new Date().toISOString();
    const rec: ModelRecord = {
      id,
      name: input.name.slice(0, 120) || "Modelo",
      kind: input.kind,
      origin: input.origin,
      description: input.description,
      parameters: input.parameters,
      values: input.values,
      analysis: input.analysis,
      createdAt: now,
      updatedAt: now,
      files: Object.keys(input.files),
      version: 1,
    };
    await mkdir(this.p("models", id), { recursive: true });
    for (const [name, data] of Object.entries(input.files)) await this.writeModelFile(id, name, data);
    await this.writeJson(this.p("models", id, "meta.json"), rec);
    return rec;
  }

  async getModel(id: string): Promise<ModelRecord | null> {
    if (!SAFE_FILE.test(id)) return null;
    return this.readJson<ModelRecord | null>(this.p("models", id, "meta.json"), null);
  }

  async listModels(): Promise<ModelRecord[]> {
    let ids: string[] = [];
    try {
      ids = await readdir(this.p("models"));
    } catch {
      return [];
    }
    const recs = await Promise.all(ids.map((id) => this.getModel(id)));
    return recs.filter((r): r is ModelRecord => !!r).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateModel(id: string, patch: Partial<Omit<ModelRecord, "id" | "createdAt">>, files: Record<string, Uint8Array | string> = {}): Promise<ModelRecord> {
    return this.withLock(`model:${id}`, async () => {
      const rec = await this.getModel(id);
      if (!rec) throw new Error(`Modelo ${id} no encontrado`);
      for (const [name, data] of Object.entries(files)) await this.writeModelFile(id, name, data);
      const next: ModelRecord = {
        ...rec,
        ...patch,
        files: [...new Set([...rec.files, ...Object.keys(files)])],
        updatedAt: new Date().toISOString(),
        version: rec.version + 1,
      };
      await this.writeJson(this.p("models", id, "meta.json"), next);
      return next;
    });
  }

  private async writeModelFile(id: string, name: string, data: Uint8Array | string): Promise<void> {
    if (!SAFE_FILE.test(name)) throw new Error(`Nombre de archivo no válido: ${name}`);
    await writeFile(this.p("models", id, name), data);
  }

  async readModelFile(id: string, name: string): Promise<Uint8Array | null> {
    if (!SAFE_FILE.test(id) || !SAFE_FILE.test(name)) return null;
    try {
      return new Uint8Array(await readFile(this.p("models", id, name)));
    } catch {
      return null;
    }
  }

  async deleteModel(id: string): Promise<void> {
    if (!SAFE_FILE.test(id)) return;
    await rm(this.p("models", id), { recursive: true, force: true });
  }

  // ---------- Impresoras ----------
  async listPrinters(): Promise<PrinterConfig[]> {
    return this.readJson<PrinterConfig[]>(this.p("printers.json"), []);
  }

  async savePrinter(cfg: Omit<PrinterConfig, "id"> & { id?: string }): Promise<PrinterConfig> {
    return this.withLock("printers", async () => {
      const list = await this.listPrinters();
      const full: PrinterConfig = { ...cfg, id: cfg.id ?? newId() } as PrinterConfig;
      const i = list.findIndex((p) => p.id === full.id);
      if (i >= 0) list[i] = full;
      else list.push(full);
      await this.writeJson(this.p("printers.json"), list);
      return full;
    });
  }

  async deletePrinter(id: string): Promise<void> {
    await this.withLock("printers", async () => {
      const list = (await this.listPrinters()).filter((p) => p.id !== id);
      await this.writeJson(this.p("printers.json"), list);
    });
  }

  // ---------- Ajustes ----------
  async getSettings<T extends object>(defaults: T): Promise<T> {
    const saved = await this.readJson<Partial<T>>(this.p("settings.json"), {});
    return { ...defaults, ...saved };
  }

  async saveSettings<T extends object>(patch: Partial<T>): Promise<void> {
    await this.withLock("settings", async () => {
      const saved = await this.readJson<Record<string, unknown>>(this.p("settings.json"), {});
      await this.writeJson(this.p("settings.json"), { ...saved, ...patch });
    });
  }

  // ---------- Conversaciones ----------
  async getConversation<T>(id: string): Promise<T | null> {
    if (!SAFE_FILE.test(id)) return null;
    return this.readJson<T | null>(this.p("conversations", `${id}.json`), null);
  }

  async saveConversation(id: string, data: unknown): Promise<void> {
    if (!SAFE_FILE.test(id)) throw new Error("id de conversación no válido");
    await this.withLock(`conv:${id}`, () => this.writeJson(this.p("conversations", `${id}.json`), data));
  }

  async listConversations<T extends { id: string; updatedAt?: string }>(): Promise<T[]> {
    let files: string[] = [];
    try {
      files = await readdir(this.p("conversations"));
    } catch {
      return [];
    }
    const all: (T | null)[] = await Promise.all(
      files.filter((f) => f.endsWith(".json")).map((f) => this.readJson<T | null>(this.p("conversations", f), null)),
    );
    const found = all.filter((c): c is T => c !== null);
    return found.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  // ---------- Consumo (transparencia de costos) ----------
  async addUsage(entry: Omit<UsageEntry, "at">): Promise<void> {
    await this.withLock("usage", async () => {
      const list = await this.readJson<UsageEntry[]>(this.p("usage.json"), []);
      list.push({ at: new Date().toISOString(), ...entry });
      await this.writeJson(this.p("usage.json"), list.slice(-5000));
    });
  }

  async usage(): Promise<{ totalUsd: number; byKind: Record<string, number>; last30dUsd: number; entries: UsageEntry[] }> {
    const list = await this.readJson<UsageEntry[]>(this.p("usage.json"), []);
    const since = Date.now() - 30 * 86400_000;
    const byKind: Record<string, number> = {};
    let total = 0, last30 = 0;
    for (const e of list) {
      total += e.costUsd;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + e.costUsd;
      if (Date.parse(e.at) >= since) last30 += e.costUsd;
    }
    return { totalUsd: total, byKind, last30dUsd: last30, entries: list.slice(-100).reverse() };
  }
}
