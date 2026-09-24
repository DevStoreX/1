import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { CameraMonitor, PrinterManager, Store, type ModelRecord, type PrinterConfig, type UsageEntry } from "@forja3d/core";
import {
  DEFAULT_SETTINGS,
  ModelService,
  SECRET_KEYS,
  createVisionFn,
  settingsFromEnv,
  type ForjaSettings,
  type ImagePart,
  type ToolContext,
} from "@forja3d/agent";

export interface RuntimeOptions {
  dataDir?: string;
  publicUrl?: string;
  env?: NodeJS.ProcessEnv;
}

export type ServerEvent =
  | { type: "camera_check"; printerId: string; check: unknown }
  | { type: "camera_paused"; printerId: string; check: unknown }
  | { type: "model"; model: ModelRecord };

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.FORJA_DATA_DIR ?? path.join(os.homedir(), ".forja3d");
}

/** Estado compartido por la API web, el chat y el servidor MCP. */
export class Runtime {
  readonly store: Store;
  readonly models: ModelService;
  readonly printers = new PrinterManager();
  readonly monitor = new CameraMonitor();
  readonly events = new EventEmitter();
  readonly publicUrl?: string;
  private envSettings: Partial<ForjaSettings>;

  constructor(opts: RuntimeOptions = {}) {
    const env = opts.env ?? process.env;
    this.store = new Store(opts.dataDir ?? defaultDataDir(env));
    this.publicUrl = opts.publicUrl ?? env.FORJA_PUBLIC_URL;
    this.envSettings = settingsFromEnv(env);
    this.models = new ModelService(this.store, () => this.settings());
    this.events.setMaxListeners(100);
    this.monitor.on("check", (printerId, check) => this.events.emit("event", { type: "camera_check", printerId, check } satisfies ServerEvent));
    this.monitor.on("paused", (printerId, check) => this.events.emit("event", { type: "camera_paused", printerId, check } satisfies ServerEvent));
    this.monitor.on("error", () => {});
  }

  /** Ajustes = valores por defecto + variables de entorno + lo guardado desde la interfaz */
  async settings(): Promise<ForjaSettings> {
    return this.store.getSettings<ForjaSettings>({ ...DEFAULT_SETTINGS, ...this.envSettings });
  }

  async updateSettings(patch: Record<string, unknown>): Promise<ForjaSettings> {
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS).concat(SECRET_KEYS as readonly string[], ["obicoUrl", "falKey", "hunyuanUrl", "openaiBaseUrl", "filamentPricePerKg"]));
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k)) continue;
      // Los secretos enmascarados ("abcd••••wxyz") no se sobrescriben
      if ((SECRET_KEYS as readonly string[]).includes(k) && typeof v === "string" && v.includes("••••")) continue;
      clean[k] = v === "" ? undefined : v;
    }
    await this.store.saveSettings(clean);
    return this.settings();
  }

  recordUsage = (entry: Omit<UsageEntry, "at">) => this.store.addUsage(entry);

  async toolContext(opts: { conversationId?: string; attachments?: ImagePart[]; onModel?: (m: ModelRecord) => void } = {}): Promise<ToolContext> {
    const settings = await this.settings();
    return {
      store: this.store,
      models: this.models,
      printers: this.printers,
      monitor: this.monitor,
      settings,
      vision: createVisionFn(settings, (costUsd, model) => void this.recordUsage({ kind: "vision", provider: settings.visionProvider, model, costUsd })),
      publicUrl: this.publicUrl,
      attachments: opts.attachments ?? [],
      conversationId: opts.conversationId,
      recordUsage: this.recordUsage,
      onModel: (m) => {
        opts.onModel?.(m);
        this.events.emit("event", { type: "model", model: m } satisfies ServerEvent);
      },
    };
  }

  async printerConfig(id: string): Promise<PrinterConfig | null> {
    return (await this.store.listPrinters()).find((p) => p.id === id) ?? null;
  }

  async close(): Promise<void> {
    this.monitor.stopAll();
    await this.printers.closeAll();
  }
}

const PRINTER_SECRETS = ["apiKey", "password", "accessCode"] as const;

export function maskPrinter(p: PrinterConfig): PrinterConfig & { hasSecrets: Record<string, boolean> } {
  const copy = { ...p } as PrinterConfig & { hasSecrets: Record<string, boolean> };
  copy.hasSecrets = {};
  for (const k of PRINTER_SECRETS) {
    copy.hasSecrets[k] = !!p[k];
    delete copy[k];
  }
  return copy;
}

/** Al editar desde la interfaz, un secreto vacío conserva el valor guardado. */
export function mergePrinterSecrets(incoming: Partial<PrinterConfig>, existing?: PrinterConfig | null): Partial<PrinterConfig> {
  const out = { ...incoming };
  for (const k of PRINTER_SECRETS) {
    if ((out[k] === undefined || out[k] === "") && existing?.[k]) out[k] = existing[k];
  }
  return out;
}
