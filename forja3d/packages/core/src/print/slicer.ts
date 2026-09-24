import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type GcodeInfo, parseGcodeInfo } from "./gcode.ts";

/**
 * Laminado opcional con PrusaSlicer (o SuperSlicer / OrcaSlicer con sintaxis compatible)
 * instalado en el sistema. Configura FORJA_SLICER_BIN y, opcionalmente, FORJA_SLICER_CONFIG
 * con un .ini exportado desde tu laminador.
 */
export interface SliceResult {
  ok: boolean;
  gcode?: Uint8Array;
  info?: GcodeInfo;
  log: string[];
}

export function slicerAvailable(): boolean {
  return !!process.env.FORJA_SLICER_BIN;
}

export async function sliceStl(stl: Uint8Array, opts: { configPath?: string; timeoutMs?: number } = {}): Promise<SliceResult> {
  const bin = process.env.FORJA_SLICER_BIN;
  if (!bin) {
    return { ok: false, log: ["No hay laminador configurado (FORJA_SLICER_BIN). Descarga el STL y lamínalo en tu programa habitual."] };
  }
  const dir = await mkdtemp(path.join(tmpdir(), "forja-slice-"));
  const input = path.join(dir, "model.stl");
  const output = path.join(dir, "model.gcode");
  await writeFile(input, stl);
  const args = ["--export-gcode", "--output", output];
  const config = opts.configPath ?? process.env.FORJA_SLICER_CONFIG;
  if (config) args.push("--load", config);
  args.push(input);
  const log: string[] = [];
  const code = await new Promise<number>((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(-2); }, opts.timeoutMs ?? 300_000);
    const collect = (b: Buffer) => log.push(...b.toString().split(/\r?\n/).filter(Boolean));
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (e) => { log.push(e.message); clearTimeout(timer); resolve(-1); });
    child.on("close", (c) => { clearTimeout(timer); resolve(c ?? -1); });
  });
  try {
    if (code !== 0) return { ok: false, log };
    const gcode = new Uint8Array(await readFile(output));
    return { ok: true, gcode, info: parseGcodeInfo(new TextDecoder().decode(gcode)), log };
  } catch (e) {
    return { ok: false, log: [...log, (e as Error).message] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
