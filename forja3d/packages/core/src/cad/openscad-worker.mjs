// Hilo aislado que ejecuta OpenSCAD (WebAssembly). Se escribe en JS plano para que
// funcione igual con node, tsx y vitest. Cada trabajo usa una instancia nueva del
// módulo (OpenSCAD no se puede reutilizar tras callMain), pero el binario WASM
// compilado se reutiliza entre trabajos.
import { parentPort } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
let wasmModulePromise;
let createOpenSCAD;
let addFonts;
let addMCAD;

async function load() {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const dir = path.dirname(require.resolve("@lofcz/openscad-wasm/package.json"));
      const bytes = readFileSync(path.join(dir, "openscad.wasm"));
      createOpenSCAD = (await import("@lofcz/openscad-wasm")).default;
      return WebAssembly.compile(bytes);
    })();
  }
  return wasmModulePromise;
}

async function run(job) {
  const wasmModule = await load();
  const logs = [];
  const instance = await createOpenSCAD({
    noInitialRun: true,
    print: (s) => logs.push(s),
    printErr: (s) => logs.push(s),
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(wasmModule, imports).then((inst) => done(inst));
      return {};
    },
  });
  if (/\btext\s*\(/.test(job.source)) {
    addFonts ??= (await import("@lofcz/openscad-wasm/fonts")).addFonts;
    addFonts(instance);
  }
  if (/MCAD/.test(job.source)) {
    addMCAD ??= (await import("@lofcz/openscad-wasm/mcad")).addMCAD;
    addMCAD(instance);
  }
  instance.FS.writeFile("/input.scad", job.source);
  const out = `/output.${job.format === "binstl" ? "stl" : job.format}`;
  const args = ["/input.scad", "--backend", "Manifold", "--export-format", job.format, "-o", out];
  for (const [k, v] of Object.entries(job.defines ?? {})) args.push("-D", `${k}=${v}`);
  let exitCode;
  try {
    exitCode = instance.callMain(args);
  } catch (err) {
    logs.push(`ERROR: ${err?.message ?? String(err)}`);
    exitCode = -1;
  }
  let output = null;
  try {
    output = instance.FS.readFile(out);
  } catch {
    output = null;
  }
  return { exitCode, logs, output };
}

parentPort.on("message", async (job) => {
  try {
    const result = await run(job);
    // Copiamos la salida para no transferir memoria que pertenezca al módulo WASM.
    const output = result.output ? result.output.slice() : null;
    parentPort.postMessage({ id: job.id, ...result, output }, output ? [output.buffer] : []);
  } catch (err) {
    parentPort.postMessage({ id: job.id, exitCode: -1, logs: [`ERROR: ${err?.message ?? String(err)}`], output: null });
  }
});
