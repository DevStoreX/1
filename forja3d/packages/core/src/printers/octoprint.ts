import { type FetchLike, HttpClient, fetchCameraUrl } from "./http.ts";
import { type PrinterConfig, type PrinterConnector, PrinterError, type PrinterState, type PrinterStatus, type Snapshot } from "./types.ts";

interface OctoJob {
  state?: string;
  job?: { file?: { name?: string } };
  progress?: { completion?: number | null; printTime?: number | null; printTimeLeft?: number | null };
}
interface OctoPrinter {
  state?: { text?: string; flags?: Record<string, boolean> };
  temperature?: { tool0?: { actual: number; target: number }; bed?: { actual: number; target: number }; chamber?: { actual: number; target: number } };
}

/** OctoPrint: https://docs.octoprint.org/en/master/api/ */
export class OctoPrintConnector implements PrinterConnector {
  private http: HttpClient;
  constructor(readonly config: PrinterConfig, fetchImpl?: FetchLike) {
    if (!config.url) throw new PrinterError("OctoPrint necesita la URL (p. ej. http://octopi.local)");
    this.http = new HttpClient({ baseUrl: config.url, headers: config.apiKey ? { "X-Api-Key": config.apiKey } : {}, fetchImpl });
  }

  async status(): Promise<PrinterStatus> {
    const job = await this.http.json<OctoJob>("GET", "/api/job");
    let printer: OctoPrinter = {};
    try {
      printer = await this.http.json<OctoPrinter>("GET", "/api/printer");
    } catch (e) {
      // 409 = impresora no conectada a OctoPrint
      if ((e as PrinterError).status === 409) return { online: false, state: "offline", message: "OctoPrint no está conectado a la impresora" };
      throw e;
    }
    const f = printer.state?.flags ?? {};
    let state: PrinterState = "unknown";
    if (f.error || f.closedOrError) state = "error";
    else if (f.paused || f.pausing) state = "paused";
    else if (f.printing || f.cancelling) state = "printing";
    else if (f.ready || f.operational) state = "idle";
    const t = printer.temperature ?? {};
    return {
      online: true,
      state,
      progress: job.progress?.completion != null ? job.progress.completion / 100 : undefined,
      fileName: job.job?.file?.name ?? undefined,
      timeLeftSec: job.progress?.printTimeLeft ?? undefined,
      elapsedSec: job.progress?.printTime ?? undefined,
      temps: {
        nozzle: t.tool0 && { actual: t.tool0.actual, target: t.tool0.target },
        bed: t.bed && { actual: t.bed.actual, target: t.bed.target },
        chamber: t.chamber && { actual: t.chamber.actual, target: t.chamber.target },
      },
      message: printer.state?.text,
    };
  }

  async upload(fileName: string, data: Uint8Array, opts: { startPrint?: boolean } = {}): Promise<void> {
    const form = new FormData();
    form.append("file", new Blob([data.slice()]), fileName);
    form.append("select", "true");
    form.append("print", opts.startPrint ? "true" : "false");
    await this.http.request("POST", "/api/files/local", { body: form, timeoutMs: 300_000 });
  }

  async start(fileName: string): Promise<void> {
    await this.http.json("POST", `/api/files/local/${encodeURIComponent(fileName)}`, { command: "select", print: true });
  }
  async pause(): Promise<void> {
    await this.http.json("POST", "/api/job", { command: "pause", action: "pause" });
  }
  async resume(): Promise<void> {
    await this.http.json("POST", "/api/job", { command: "pause", action: "resume" });
  }
  async cancel(): Promise<void> {
    await this.http.json("POST", "/api/job", { command: "cancel" });
  }
  async snapshot(): Promise<Snapshot | null> {
    const url = this.config.cameraUrl ?? this.http.url("/webcam/?action=snapshot");
    return fetchCameraUrl(url);
  }
}
