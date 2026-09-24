import { type FetchLike, HttpClient, fetchCameraUrl } from "./http.ts";
import { type PrinterConfig, type PrinterConnector, PrinterError, type PrinterState, type PrinterStatus, type Snapshot } from "./types.ts";

interface PrusaStatus {
  printer?: { state?: string; temp_nozzle?: number; target_nozzle?: number; temp_bed?: number; target_bed?: number };
  job?: { id?: number; progress?: number; time_remaining?: number; time_printing?: number };
}

/** Prusa MK4/MK4S, CORE One, MINI, XL con PrusaLink (API v1). */
export class PrusaLinkConnector implements PrinterConnector {
  private http: HttpClient;
  constructor(readonly config: PrinterConfig, private fetchImpl?: FetchLike) {
    if (!config.url) throw new PrinterError("PrusaLink necesita la URL (p. ej. http://192.168.1.70)");
    this.http = new HttpClient({
      baseUrl: config.url,
      headers: config.apiKey ? { "X-Api-Key": config.apiKey } : {},
      digest: config.password ? { username: config.username ?? "maker", password: config.password } : undefined,
      fetchImpl,
    });
  }

  private async raw(): Promise<PrusaStatus> {
    return this.http.json<PrusaStatus>("GET", "/api/v1/status");
  }

  async status(): Promise<PrinterStatus> {
    const s = await this.raw();
    const map: Record<string, PrinterState> = {
      IDLE: "idle", READY: "idle", BUSY: "busy", PRINTING: "printing", PAUSED: "paused",
      FINISHED: "finished", STOPPED: "idle", ERROR: "error", ATTENTION: "error",
    };
    return {
      online: true,
      state: map[s.printer?.state ?? ""] ?? "unknown",
      progress: s.job?.progress != null ? s.job.progress / 100 : undefined,
      timeLeftSec: s.job?.time_remaining,
      elapsedSec: s.job?.time_printing,
      temps: {
        nozzle: s.printer?.temp_nozzle != null ? { actual: s.printer.temp_nozzle, target: s.printer.target_nozzle } : undefined,
        bed: s.printer?.temp_bed != null ? { actual: s.printer.temp_bed, target: s.printer.target_bed } : undefined,
      },
      message: s.printer?.state === "ATTENTION" ? "La impresora requiere atención" : undefined,
    };
  }

  private async jobId(): Promise<number> {
    const id = (await this.raw()).job?.id;
    if (id == null) throw new PrinterError("No hay ninguna impresión en curso");
    return id;
  }

  async upload(fileName: string, data: Uint8Array, opts: { startPrint?: boolean } = {}): Promise<void> {
    const storage = this.config.storage ?? "usb";
    await this.http.request("PUT", `/api/v1/files/${storage}/${encodeURIComponent(fileName)}`, {
      body: new Blob([data.slice()]),
      headers: { "Content-Type": "application/octet-stream", "Print-After-Upload": opts.startPrint ? "?1" : "?0", Overwrite: "?1" },
      timeoutMs: 300_000,
    });
  }

  async start(fileName: string): Promise<void> {
    const storage = this.config.storage ?? "usb";
    await this.http.request("POST", `/api/v1/files/${storage}/${encodeURIComponent(fileName)}`);
  }
  async pause(): Promise<void> {
    await this.http.request("PUT", `/api/v1/job/${await this.jobId()}/pause`);
  }
  async resume(): Promise<void> {
    await this.http.request("PUT", `/api/v1/job/${await this.jobId()}/resume`);
  }
  async cancel(): Promise<void> {
    await this.http.request("DELETE", `/api/v1/job/${await this.jobId()}`);
  }
  async snapshot(): Promise<Snapshot | null> {
    return this.config.cameraUrl ? fetchCameraUrl(this.config.cameraUrl, this.fetchImpl) : null;
  }
}
