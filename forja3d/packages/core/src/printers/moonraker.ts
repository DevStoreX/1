import { type FetchLike, HttpClient, fetchCameraUrl } from "./http.ts";
import { type PrinterConfig, type PrinterConnector, PrinterError, type PrinterState, type PrinterStatus, type Snapshot } from "./types.ts";

interface QueryResult {
  result: {
    status: {
      print_stats?: { state?: string; filename?: string; print_duration?: number; message?: string };
      display_status?: { progress?: number };
      virtual_sdcard?: { progress?: number };
      extruder?: { temperature?: number; target?: number };
      heater_bed?: { temperature?: number; target?: number };
    };
  };
}

/** Klipper vía Moonraker (Mainsail, Fluidd, Creality K1/K2 rooteadas, Elegoo Neptune 4...). */
export class MoonrakerConnector implements PrinterConnector {
  private http: HttpClient;
  constructor(readonly config: PrinterConfig, private fetchImpl?: FetchLike) {
    if (!config.url) throw new PrinterError("Moonraker necesita la URL (p. ej. http://192.168.1.60:7125)");
    this.http = new HttpClient({ baseUrl: config.url, headers: config.apiKey ? { "X-Api-Key": config.apiKey } : {}, fetchImpl });
  }

  async status(): Promise<PrinterStatus> {
    const q = await this.http.json<QueryResult>("GET", "/printer/objects/query?print_stats&display_status&virtual_sdcard&extruder&heater_bed");
    const s = q.result.status;
    const map: Record<string, PrinterState> = { standby: "idle", printing: "printing", paused: "paused", complete: "finished", cancelled: "idle", error: "error" };
    const state = map[s.print_stats?.state ?? ""] ?? "unknown";
    const progress = s.virtual_sdcard?.progress ?? s.display_status?.progress;
    const elapsed = s.print_stats?.print_duration;
    const timeLeft = progress && progress > 0.01 && elapsed ? (elapsed / progress) * (1 - progress) : undefined;
    return {
      online: true,
      state,
      progress,
      fileName: s.print_stats?.filename || undefined,
      elapsedSec: elapsed,
      timeLeftSec: timeLeft ? Math.round(timeLeft) : undefined,
      temps: {
        nozzle: s.extruder && { actual: s.extruder.temperature ?? 0, target: s.extruder.target },
        bed: s.heater_bed && { actual: s.heater_bed.temperature ?? 0, target: s.heater_bed.target },
      },
      message: s.print_stats?.message || undefined,
    };
  }

  async upload(fileName: string, data: Uint8Array, opts: { startPrint?: boolean } = {}): Promise<void> {
    const form = new FormData();
    form.append("file", new Blob([data.slice()]), fileName);
    form.append("root", "gcodes");
    if (opts.startPrint) form.append("print", "true");
    await this.http.request("POST", "/server/files/upload", { body: form, timeoutMs: 300_000 });
  }

  async start(fileName: string): Promise<void> {
    await this.http.request("POST", `/printer/print/start?filename=${encodeURIComponent(fileName)}`);
  }
  async pause(): Promise<void> {
    await this.http.request("POST", "/printer/print/pause");
  }
  async resume(): Promise<void> {
    await this.http.request("POST", "/printer/print/resume");
  }
  async cancel(): Promise<void> {
    await this.http.request("POST", "/printer/print/cancel");
  }

  async snapshot(): Promise<Snapshot | null> {
    if (this.config.cameraUrl) return fetchCameraUrl(this.config.cameraUrl, this.fetchImpl);
    const list = await this.http.json<{ result?: { webcams?: { snapshot_url?: string; enabled?: boolean }[] } }>("GET", "/server/webcams/list");
    const cam = list.result?.webcams?.find((w) => w.enabled !== false && w.snapshot_url);
    if (!cam?.snapshot_url) return null;
    const url = /^https?:/.test(cam.snapshot_url) ? cam.snapshot_url : new URL(cam.snapshot_url, this.config.url).toString();
    return fetchCameraUrl(url, this.fetchImpl);
  }
}
