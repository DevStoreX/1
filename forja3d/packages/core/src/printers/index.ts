import { BambuConnector } from "./bambu.ts";
import type { FetchLike } from "./http.ts";
import { MockConnector } from "./mock.ts";
import { MoonrakerConnector } from "./moonraker.ts";
import { OctoPrintConnector } from "./octoprint.ts";
import { PrusaLinkConnector } from "./prusalink.ts";
import { type PrinterConfig, type PrinterConnector, PrinterError } from "./types.ts";

export * from "./types.ts";
export { fetchCameraUrl, readFirstJpeg, HttpClient } from "./http.ts";
export { OctoPrintConnector, MoonrakerConnector, PrusaLinkConnector, BambuConnector, MockConnector };

export function createConnector(config: PrinterConfig, fetchImpl?: FetchLike): PrinterConnector {
  switch (config.kind) {
    case "octoprint": return new OctoPrintConnector(config, fetchImpl);
    case "moonraker": return new MoonrakerConnector(config, fetchImpl);
    case "prusalink": return new PrusaLinkConnector(config, fetchImpl);
    case "bambu": return new BambuConnector(config);
    case "mock": return new MockConnector(config);
    default: throw new PrinterError(`Tipo de impresora desconocido: ${(config as PrinterConfig).kind}`);
  }
}

/** Mantiene una conexión por impresora (Bambu usa MQTT persistente). */
export class PrinterManager {
  private connectors = new Map<string, PrinterConnector>();

  constructor(private fetchImpl?: FetchLike) {}

  get(config: PrinterConfig): PrinterConnector {
    const existing = this.connectors.get(config.id);
    if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) return existing;
    void existing?.close?.();
    const c = createConnector(config, this.fetchImpl);
    this.connectors.set(config.id, c);
    return c;
  }

  async remove(id: string): Promise<void> {
    await this.connectors.get(id)?.close?.();
    this.connectors.delete(id);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connectors.values()].map((c) => c.close?.()));
    this.connectors.clear();
  }
}
