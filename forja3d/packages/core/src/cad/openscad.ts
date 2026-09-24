import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { type ParamValue, toScadLiteral } from "./params.ts";

export type ScadExportFormat = "binstl" | "off" | "3mf" | "amf";

export interface CompileOptions {
  params?: Record<string, ParamValue>;
  /** Tiempo máximo de compilación (ms). Por defecto 60 s. */
  timeoutMs?: number;
  format?: ScadExportFormat;
}

export interface CompileResult {
  ok: boolean;
  output?: Uint8Array;
  errors: string[];
  warnings: string[];
  echo: string[];
  log: string[];
  ms: number;
  backend: "wasm" | "native";
}

interface WorkerReply {
  id: number;
  exitCode: number;
  logs: string[];
  output: Uint8Array | null;
}

const NOISE = /(Could not initialize localization|Geometries in cache|Geometry cache size|CGAL Polyhedrons|CGAL cache size|Fontconfig)/;

function summarize(exitCode: number, logs: string[], output: Uint8Array | null, ms: number, backend: CompileResult["backend"]): CompileResult {
  const errors = logs.filter((l) => /^(ERROR|TRACE):/.test(l) || /Can't parse file|top level object is empty|Current top level object is not a 3D object/i.test(l));
  const warnings = logs.filter((l) => l.startsWith("WARNING:"));
  const echo = logs.filter((l) => l.startsWith("ECHO:")).map((l) => l.replace(/^ECHO:\s*/, ""));
  if (logs.some((l) => /top level object is a 2D object/i.test(l))) {
    errors.push("ERROR: El resultado es 2D. Usa linear_extrude() o rotate_extrude() para convertirlo en un sólido 3D.");
  }
  const ok = exitCode === 0 && !!output && output.byteLength > 84 && errors.length === 0;
  if (!ok && errors.length === 0) {
    errors.push(exitCode === -2 ? "ERROR: Tiempo de compilación agotado (¿bucle muy grande o $fn demasiado alto?)." : `ERROR: OpenSCAD terminó con código ${exitCode} sin generar geometría.`);
  }
  return {
    ok,
    output: ok ? output! : undefined,
    errors,
    warnings,
    echo,
    log: logs.filter((l) => l && !NOISE.test(l)),
    ms,
    backend,
  };
}

class WasmPool {
  private idle: Worker[] = [];
  private busy = 0;
  private queue: (() => void)[] = [];
  private nextId = 1;

  constructor(private size: number) {}

  private spawn(): Worker {
    const w = new Worker(new URL("./openscad-worker.mjs", import.meta.url));
    w.unref();
    return w;
  }

  private async acquire(): Promise<Worker> {
    if (this.busy >= this.size) await new Promise<void>((r) => this.queue.push(r));
    this.busy++;
    return this.idle.pop() ?? this.spawn();
  }

  private release(w: Worker | null): void {
    this.busy--;
    if (w) this.idle.push(w);
    this.queue.shift()?.();
  }

  async run(job: { source: string; defines: Record<string, string>; format: string }, timeoutMs: number): Promise<WorkerReply> {
    const worker = await this.acquire();
    const id = this.nextId++;
    return new Promise<WorkerReply>((resolve) => {
      let settled = false;
      const finish = (reply: WorkerReply, keep: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        if (!keep) void worker.terminate();
        this.release(keep ? worker : null);
        resolve(reply);
      };
      const onMessage = (msg: WorkerReply) => {
        if (msg.id === id) finish({ ...msg, output: msg.output ? new Uint8Array(msg.output) : null }, true);
      };
      const onError = (err: Error) => finish({ id, exitCode: -1, logs: [`ERROR: ${err.message}`], output: null }, false);
      const timer = setTimeout(() => finish({ id, exitCode: -2, logs: [], output: null }, false), timeoutMs);
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.postMessage({ id, ...job });
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.idle.map((w) => w.terminate()));
    this.idle = [];
  }
}

let pool: WasmPool | null = null;

function getPool(): WasmPool {
  pool ??= new WasmPool(Math.max(1, Number(process.env.FORJA_CAD_WORKERS ?? 2)));
  return pool;
}

async function compileNative(bin: string, source: string, defines: Record<string, string>, format: ScadExportFormat, timeoutMs: number): Promise<CompileResult> {
  const t0 = Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "forja-scad-"));
  const input = path.join(dir, "input.scad");
  const output = path.join(dir, `output.${format === "binstl" ? "stl" : format}`);
  await writeFile(input, source);
  const args = [input, "--backend", "Manifold", "--export-format", format, "-o", output];
  for (const [k, v] of Object.entries(defines)) args.push("-D", `${k}=${v}`);
  const logs: string[] = [];
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(bin, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(-2); }, timeoutMs);
    const collect = (b: Buffer) => logs.push(...b.toString().split(/\r?\n/).filter(Boolean));
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (e) => { logs.push(`ERROR: ${e.message}`); clearTimeout(timer); resolve(-1); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code ?? -1); });
  });
  let out: Uint8Array | null = null;
  try { out = new Uint8Array(await readFile(output)); } catch { out = null; }
  await rm(dir, { recursive: true, force: true });
  return summarize(exitCode, logs, out, Date.now() - t0, "native");
}

/**
 * Compila código OpenSCAD a un sólido. Usa OpenSCAD en WebAssembly (aislado, sin binarios
 * nativos) o, si se define OPENSCAD_BIN, el ejecutable nativo instalado.
 */
export async function compileScad(source: string, opts: CompileOptions = {}): Promise<CompileResult> {
  const format = opts.format ?? "binstl";
  const timeoutMs = opts.timeoutMs ?? Number(process.env.FORJA_CAD_TIMEOUT_MS ?? 60_000);
  const defines: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (!/^[A-Za-z_$][\w$]*$/.test(k)) throw new Error(`Nombre de parámetro no válido: ${k}`);
    defines[k] = toScadLiteral(v);
  }
  if (source.length > 500_000) {
    return summarize(-1, ["ERROR: El código OpenSCAD es demasiado grande (> 500 KB)."], null, 0, "wasm");
  }
  const bin = process.env.OPENSCAD_BIN;
  if (bin) return compileNative(bin, source, defines, format, timeoutMs);
  const t0 = Date.now();
  const reply = await getPool().run({ source, defines, format }, timeoutMs);
  return summarize(reply.exitCode, reply.logs, reply.output, Date.now() - t0, "wasm");
}

export async function shutdownCad(): Promise<void> {
  await pool?.close();
  pool = null;
}
