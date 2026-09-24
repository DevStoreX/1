import { EventEmitter } from "node:events";
import type { PrinterConnector, PrinterStatus, Snapshot } from "../printers/types.ts";

export type Verdict = "ok" | "warning" | "failure" | "unknown";

export interface CameraCheck {
  at: string;
  verdict: Verdict;
  /** 0–1 */
  confidence: number;
  issues: string[];
  explanation: string;
  detector: string;
  costUsd?: number;
}

export interface FailureDetector {
  readonly name: string;
  check(snapshot: Snapshot, ctx: { printerName: string; status?: PrinterStatus; snapshotUrl?: string }): Promise<CameraCheck>;
}

/** Función de visión que provee el agente (Claude, un modelo local con visión, etc.). */
export type VisionFn = (image: Snapshot, prompt: string) => Promise<{ text: string; costUsd?: number }>;

export const FAILURE_PROMPT = `Eres un experto en impresión 3D FDM revisando la foto de la cámara de una impresora en funcionamiento.
Detecta fallos: "espagueti" (filamento enredado en el aire), pieza despegada o movida de la cama, bola/grumo de plástico en la boquilla,
desplazamiento de capas, impresión en el aire (sin pieza), atasco (no sale filamento), deformación (warping) severa, soportes caídos, humo o fuego.
Si la imagen está oscura, borrosa o no muestra la cama, usa "unknown".
Responde SOLO con JSON: {"verdict":"ok|warning|failure|unknown","confidence":0.0-1.0,"issues":["..."],"explanation":"frase corta en español"}`;

export function parseVerdictJson(text: string, detector: string, costUsd?: number): CameraCheck {
  const at = new Date().toISOString();
  const match = /\{[\s\S]*\}/.exec(text);
  try {
    const j = JSON.parse(match?.[0] ?? "{}");
    const verdict: Verdict = ["ok", "warning", "failure", "unknown"].includes(j.verdict) ? j.verdict : "unknown";
    const confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0));
    return {
      at,
      verdict,
      confidence,
      issues: Array.isArray(j.issues) ? j.issues.map(String).slice(0, 8) : [],
      explanation: String(j.explanation ?? "").slice(0, 400),
      detector,
      costUsd,
    };
  } catch {
    return { at, verdict: "unknown", confidence: 0, issues: [], explanation: "No se pudo interpretar la respuesta del modelo de visión.", detector, costUsd };
  }
}

export class VisionLLMDetector implements FailureDetector {
  readonly name = "vision-llm";
  constructor(private vision: VisionFn) {}
  async check(snapshot: Snapshot, ctx: { printerName: string; status?: PrinterStatus }): Promise<CameraCheck> {
    const progress = ctx.status?.progress != null ? ` Progreso: ${Math.round(ctx.status.progress * 100)}%.` : "";
    const { text, costUsd } = await this.vision(snapshot, `${FAILURE_PROMPT}\nImpresora: ${ctx.printerName}.${progress}`);
    return parseVerdictJson(text, this.name, costUsd);
  }
}

/**
 * Detector del proyecto abierto Obico (antes The Spaghetti Detective), auto-hospedado:
 * docker run -p 3333:3333 thespaghettidetective/ml_api
 * Es gratis y corre en CPU. Necesita una URL del snapshot accesible desde el contenedor.
 */
export class ObicoDetector implements FailureDetector {
  readonly name = "obico";
  constructor(private mlApiUrl: string, private fetchImpl: typeof fetch = fetch) {}
  async check(_snapshot: Snapshot, ctx: { printerName: string; snapshotUrl?: string }): Promise<CameraCheck> {
    const at = new Date().toISOString();
    if (!ctx.snapshotUrl) {
      return { at, verdict: "unknown", confidence: 0, issues: [], explanation: "Obico necesita FORJA_PUBLIC_URL para descargar la imagen.", detector: this.name };
    }
    const res = await this.fetchImpl(`${this.mlApiUrl.replace(/\/+$/, "")}/p/?img=${encodeURIComponent(ctx.snapshotUrl)}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Obico ml_api respondió HTTP ${res.status}`);
    const body = (await res.json()) as { detections?: [string, number, number[]][] };
    const best = Math.max(0, ...(body.detections ?? []).map((d) => d[1]));
    const verdict: Verdict = best >= 0.6 ? "failure" : best >= 0.35 ? "warning" : "ok";
    return {
      at,
      verdict,
      confidence: verdict === "ok" ? 1 - best : best,
      issues: verdict === "ok" ? [] : ["posible espagueti / fallo de impresión"],
      explanation: verdict === "ok" ? "Sin señales de fallo." : `Detección de fallo con confianza ${(best * 100).toFixed(0)}%.`,
      detector: this.name,
      costUsd: 0,
    };
  }
}

export interface MonitorOptions {
  intervalSec: number;
  autoPause: boolean;
  /** Fallos consecutivos necesarios para pausar (evita falsos positivos) */
  confirmations: number;
  minConfidence: number;
}

export interface MonitorState {
  running: boolean;
  options: MonitorOptions;
  history: CameraCheck[];
  consecutiveFailures: number;
  pausedByMonitor: boolean;
}

interface MonitorEntry {
  state: MonitorState;
  timer: NodeJS.Timeout;
  busy: boolean;
}

/**
 * Vigila la cámara mientras la impresora imprime. Si detecta un fallo confirmado varias
 * veces seguidas y `autoPause` está activo, pausa la impresión y emite el evento "paused".
 */
export class CameraMonitor extends EventEmitter {
  private entries = new Map<string, MonitorEntry>();

  start(
    printerId: string,
    deps: { connector: () => PrinterConnector; detector: () => FailureDetector; printerName: string; snapshotUrl?: string },
    options: Partial<MonitorOptions> = {},
  ): MonitorState {
    this.stop(printerId);
    const opts: MonitorOptions = { intervalSec: 60, autoPause: true, confirmations: 2, minConfidence: 0.6, ...options };
    opts.intervalSec = Math.max(10, opts.intervalSec);
    const state: MonitorState = { running: true, options: opts, history: [], consecutiveFailures: 0, pausedByMonitor: false };
    const entry: MonitorEntry = { state, busy: false, timer: setInterval(() => void tick(), opts.intervalSec * 1000) };
    entry.timer.unref?.();
    const tick = async () => {
      if (entry.busy) return;
      entry.busy = true;
      try {
        const connector = deps.connector();
        const status = await connector.status();
        if (status.state !== "printing") return;
        const snap = await connector.snapshot();
        if (!snap) return;
        const check = await deps.detector().check(snap, { printerName: deps.printerName, status, snapshotUrl: deps.snapshotUrl });
        state.history = [check, ...state.history].slice(0, 50);
        this.emit("check", printerId, check);
        if (check.verdict === "failure" && check.confidence >= opts.minConfidence) state.consecutiveFailures++;
        else state.consecutiveFailures = 0;
        if (opts.autoPause && state.consecutiveFailures >= opts.confirmations) {
          await connector.pause();
          state.pausedByMonitor = true;
          state.consecutiveFailures = 0;
          this.emit("paused", printerId, check);
        }
      } catch (e) {
        this.emit("error", printerId, e);
      } finally {
        entry.busy = false;
      }
    };
    this.entries.set(printerId, entry);
    return state;
  }

  stop(printerId: string): void {
    const e = this.entries.get(printerId);
    if (e) {
      clearInterval(e.timer);
      e.state.running = false;
      this.entries.delete(printerId);
    }
  }

  get(printerId: string): MonitorState | undefined {
    return this.entries.get(printerId)?.state;
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
  }
}
