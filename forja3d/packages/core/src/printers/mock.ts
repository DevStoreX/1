import { fetchCameraUrl } from "./http.ts";
import type { PrinterConfig, PrinterConnector, PrinterStatus, Snapshot } from "./types.ts";

/** Impresora simulada: sirve para probar la app sin hardware y en las pruebas automáticas. */
export class MockConnector implements PrinterConnector {
  private file?: string;
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private cancelled = false;
  readonly files = new Map<string, Uint8Array>();
  /** Duración simulada de cada impresión (s) */
  durationSec = 600;

  constructor(readonly config: PrinterConfig) {}

  async status(): Promise<PrinterStatus> {
    if (!this.file || this.cancelled) {
      return { online: true, state: "idle", temps: { nozzle: { actual: 26, target: 0 }, bed: { actual: 25, target: 0 } } };
    }
    const now = this.pausedAt || Date.now();
    const elapsed = (now - this.startedAt - this.pausedTotal) / 1000;
    const progress = Math.min(1, elapsed / this.durationSec);
    return {
      online: true,
      state: progress >= 1 ? "finished" : this.pausedAt ? "paused" : "printing",
      progress,
      fileName: this.file,
      elapsedSec: Math.round(elapsed),
      timeLeftSec: Math.max(0, Math.round(this.durationSec - elapsed)),
      temps: { nozzle: { actual: 219.6, target: 220 }, bed: { actual: 59.8, target: 60 } },
    };
  }

  async upload(fileName: string, data: Uint8Array, opts: { startPrint?: boolean } = {}): Promise<void> {
    this.files.set(fileName, data);
    if (opts.startPrint) await this.start(fileName);
  }
  async start(fileName: string): Promise<void> {
    this.file = fileName;
    this.startedAt = Date.now();
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.cancelled = false;
  }
  async pause(): Promise<void> {
    if (!this.pausedAt) this.pausedAt = Date.now();
  }
  async resume(): Promise<void> {
    if (this.pausedAt) {
      this.pausedTotal += Date.now() - this.pausedAt;
      this.pausedAt = 0;
    }
  }
  async cancel(): Promise<void> {
    this.cancelled = true;
  }
  async snapshot(): Promise<Snapshot | null> {
    return this.config.cameraUrl ? fetchCameraUrl(this.config.cameraUrl) : null;
  }
}
