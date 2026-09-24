#!/usr/bin/env node
// Lanza el servidor MCP de Forja3D por stdio usando tsx (sin paso de compilación).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const tsxCli = require.resolve("tsx/cli");
const child = spawn(process.execPath, [tsxCli, path.join(here, "../src/index.ts")], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
