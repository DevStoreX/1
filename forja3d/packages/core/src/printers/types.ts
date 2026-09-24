export type PrinterKind = "octoprint" | "moonraker" | "prusalink" | "bambu" | "mock";

export interface PrinterConfig {
  id: string;
  name: string;
  kind: PrinterKind;
  /** URL base (OctoPrint, Moonraker, PrusaLink), p. ej. http://192.168.1.50 */
  url?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  /** Bambu Lab: IP de la impresora, número de serie y código de acceso LAN */
  host?: string;
  serial?: string;
  accessCode?: string;
  /** Bambu Lab: "x1" usa RTSP para la cámara; el resto usa el puerto 6000 */
  model?: string;
  /** PrusaLink: almacenamiento destino ("usb" o "local") */
  storage?: string;
  /** URL de captura JPEG o MJPEG si la cámara es externa */
  cameraUrl?: string;
  /** Perfil de impresora para estimaciones (ver PRINTER_PROFILES) */
  profileId?: string;
}

export type PrinterState = "idle" | "printing" | "paused" | "finished" | "error" | "offline" | "busy" | "unknown";

export interface Temp {
  actual: number;
  target?: number;
}

export interface PrinterStatus {
  online: boolean;
  state: PrinterState;
  /** 0–1 */
  progress?: number;
  fileName?: string;
  timeLeftSec?: number;
  elapsedSec?: number;
  temps?: { nozzle?: Temp; bed?: Temp; chamber?: Temp };
  message?: string;
}

export interface Snapshot {
  data: Uint8Array;
  mime: string;
}

export interface PrinterConnector {
  readonly config: PrinterConfig;
  status(): Promise<PrinterStatus>;
  /** Sube un archivo laminado (.gcode, .bgcode, .3mf) y opcionalmente inicia la impresión */
  upload(fileName: string, data: Uint8Array, opts?: { startPrint?: boolean }): Promise<void>;
  start(fileName: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  snapshot(): Promise<Snapshot | null>;
  close?(): Promise<void>;
}

export class PrinterError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PrinterError";
  }
}
