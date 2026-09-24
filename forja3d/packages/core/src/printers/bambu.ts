import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import tls from "node:tls";
import { fetchCameraUrl } from "./http.ts";
import { type PrinterConfig, type PrinterConnector, PrinterError, type PrinterState, type PrinterStatus, type Snapshot } from "./types.ts";

type MqttClient = import("mqtt").MqttClient;

interface BambuPrint {
  gcode_state?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  subtask_name?: string;
  gcode_file?: string;
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  chamber_temper?: number;
  print_error?: number;
}

/**
 * Bambu Lab (A1, A1 mini, P1P/P1S/P2S, X1C, H2D) en modo LAN.
 * Requiere "Modo LAN" y, en firmwares recientes, "Modo desarrollador" activado para que
 * programas de terceros puedan controlar la impresora. Estado y control por MQTT (8883),
 * subida de archivos por FTPS implícito (990) y cámara por el puerto 6000 (A1/P1) o RTSP (X1/H2D).
 */
export class BambuConnector implements PrinterConnector {
  private client: MqttClient | null = null;
  private state: BambuPrint = {};
  private lastReport = 0;
  private seq = 0;

  constructor(readonly config: PrinterConfig) {
    if (!config.host || !config.serial || !config.accessCode) {
      throw new PrinterError("Bambu Lab necesita IP (host), número de serie y código de acceso LAN");
    }
  }

  private async connect(): Promise<MqttClient> {
    if (this.client?.connected) return this.client;
    const mqtt = await import("mqtt");
    const client = mqtt.connect(`mqtts://${this.config.host}:8883`, {
      username: "bblp",
      password: this.config.accessCode,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
    });
    this.client = client;
    const topic = `device/${this.config.serial}/report`;
    client.on("message", (_t, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (msg.print) {
          this.state = { ...this.state, ...msg.print };
          this.lastReport = Date.now();
        }
      } catch {
        /* mensaje no JSON: lo ignoramos */
      }
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PrinterError("Tiempo agotado conectando por MQTT con la impresora Bambu")), 12_000);
      client.once("connect", () => {
        clearTimeout(timer);
        client.subscribe(topic, (err) => (err ? reject(err) : resolve()));
      });
      client.once("error", (err) => { clearTimeout(timer); reject(new PrinterError(`MQTT: ${err.message}`)); });
    });
    this.publish({ pushing: { sequence_id: String(this.seq++), command: "pushall" } });
    return client;
  }

  private publish(payload: unknown): void {
    this.client?.publish(`device/${this.config.serial}/request`, JSON.stringify(payload));
  }

  private async command(command: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.connect();
    this.publish({ print: { sequence_id: String(this.seq++), command, ...extra } });
  }

  async status(): Promise<PrinterStatus> {
    try {
      await this.connect();
    } catch (e) {
      return { online: false, state: "offline", message: (e as Error).message };
    }
    // Esperamos el primer reporte completo (pushall) hasta 5 s
    const t0 = Date.now();
    while (!this.lastReport && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 200));
    const s = this.state;
    const map: Record<string, PrinterState> = { IDLE: "idle", PREPARE: "busy", RUNNING: "printing", PAUSE: "paused", FINISH: "finished", FAILED: "error", SLICING: "busy" };
    return {
      online: !!this.lastReport,
      state: map[s.gcode_state ?? ""] ?? "unknown",
      progress: s.mc_percent != null ? s.mc_percent / 100 : undefined,
      timeLeftSec: s.mc_remaining_time != null ? s.mc_remaining_time * 60 : undefined,
      fileName: s.subtask_name || s.gcode_file,
      temps: {
        nozzle: s.nozzle_temper != null ? { actual: s.nozzle_temper, target: s.nozzle_target_temper } : undefined,
        bed: s.bed_temper != null ? { actual: s.bed_temper, target: s.bed_target_temper } : undefined,
        chamber: s.chamber_temper != null ? { actual: s.chamber_temper } : undefined,
      },
      message: s.print_error ? `Código de error de impresión: ${s.print_error}` : undefined,
    };
  }

  async upload(fileName: string, data: Uint8Array, opts: { startPrint?: boolean } = {}): Promise<void> {
    const { Client } = await import("basic-ftp");
    const ftp = new Client(120_000);
    try {
      await ftp.access({
        host: this.config.host,
        port: 990,
        user: "bblp",
        password: this.config.accessCode,
        secure: "implicit",
        secureOptions: { rejectUnauthorized: false },
      });
      await ftp.uploadFrom(Readable.from(Buffer.from(data)), `/${fileName}`);
    } catch (e) {
      throw new PrinterError(`FTP Bambu: ${(e as Error).message}`);
    } finally {
      ftp.close();
    }
    if (opts.startPrint) await this.start(fileName);
  }

  async start(fileName: string): Promise<void> {
    if (fileName.toLowerCase().endsWith(".3mf")) {
      const isX1 = /x1|h2/i.test(this.config.model ?? "");
      await this.command("project_file", {
        param: "Metadata/plate_1.gcode",
        subtask_name: fileName.replace(/\.gcode\.3mf$|\.3mf$/i, ""),
        url: isX1 ? `file:///sdcard/${fileName}` : `ftp:///${fileName}`,
        md5: "",
        project_id: "0",
        profile_id: "0",
        task_id: "0",
        subtask_id: "0",
        timelapse: false,
        bed_type: "auto",
        bed_levelling: true,
        flow_cali: false,
        vibration_cali: false,
        layer_inspect: false,
        use_ams: false,
      });
    } else {
      await this.command("gcode_file", { param: `/sdcard/${fileName}` });
    }
  }

  async pause(): Promise<void> {
    await this.command("pause");
  }
  async resume(): Promise<void> {
    await this.command("resume");
  }
  async cancel(): Promise<void> {
    await this.command("stop");
  }

  async snapshot(): Promise<Snapshot | null> {
    if (this.config.cameraUrl) return fetchCameraUrl(this.config.cameraUrl);
    if (/x1|h2/i.test(this.config.model ?? "")) return this.rtspSnapshot();
    return { data: await bambuPort6000Snapshot(this.config.host!, this.config.accessCode!), mime: "image/jpeg" };
  }

  private rtspSnapshot(): Promise<Snapshot | null> {
    const url = `rtsps://bblp:${this.config.accessCode}@${this.config.host}:322/streaming/live/1`;
    return new Promise((resolve, reject) => {
      const ff = spawn(process.env.FFMPEG_BIN ?? "ffmpeg", ["-rtsp_transport", "tcp", "-i", url, "-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "-"], { stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => ff.kill("SIGKILL"), 20_000);
      ff.stdout.on("data", (c: Buffer) => chunks.push(c));
      ff.on("error", () => { clearTimeout(timer); reject(new PrinterError("La cámara X1/H2D necesita ffmpeg instalado (o configura cameraUrl)")); });
      ff.on("close", () => {
        clearTimeout(timer);
        const data = Buffer.concat(chunks);
        resolve(data.length ? { data: new Uint8Array(data), mime: "image/jpeg" } : null);
      });
    });
  }

  async close(): Promise<void> {
    await this.client?.endAsync().catch(() => {});
    this.client = null;
  }
}

/** Protocolo de cámara JPEG de A1/P1 (TLS, puerto 6000). */
export function bambuPort6000Snapshot(host: string, accessCode: string, timeoutMs = 15_000): Promise<Uint8Array> {
  const auth = Buffer.alloc(80);
  auth.writeUInt32LE(0x40, 0);
  auth.writeUInt32LE(0x3000, 4);
  auth.write("bblp", 16, "ascii");
  auth.write(accessCode, 48, "ascii");
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const socket = tls.connect({ host, port: 6000, rejectUnauthorized: false }, () => socket.write(auth));
    const done = (err: Error | null, data?: Uint8Array) => {
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(data!);
    };
    const timer = setTimeout(() => done(new PrinterError("Tiempo agotado esperando la cámara Bambu")), timeoutMs);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 16) return;
      const size = buf.readUInt32LE(0);
      if (size <= 0 || size > 10 * 1024 * 1024) return done(new PrinterError("Respuesta de cámara no válida (¿código de acceso incorrecto?)"));
      if (buf.length >= 16 + size) {
        const jpeg = buf.subarray(16, 16 + size);
        if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return done(new PrinterError("La cámara no devolvió un JPEG"));
        done(null, new Uint8Array(jpeg));
      }
    });
    socket.on("error", (e) => done(new PrinterError(`Cámara Bambu: ${e.message}`)));
  });
}
