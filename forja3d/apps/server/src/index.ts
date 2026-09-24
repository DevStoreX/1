import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { shutdownCad } from "@forja3d/core";
import { createApp } from "./app.ts";
import { Runtime, defaultDataDir } from "./runtime.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const token = process.env.FORJA_TOKEN || undefined;
const dataDir = defaultDataDir();

const rt = new Runtime({ dataDir, publicUrl: process.env.FORJA_PUBLIC_URL ?? `http://${host === "0.0.0.0" ? "localhost" : host}:${port}` });
const api = createApp(rt, { token, corsOrigins: process.env.FORJA_CORS_ORIGINS?.split(",").filter(Boolean) });

const root = new Hono();
root.route("/", api);

// Interfaz web compilada (npm run build)
const webDist = process.env.FORJA_WEB_DIST ?? path.resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  const rel = path.relative(process.cwd(), webDist) || ".";
  root.use("/*", serveStatic({ root: rel }));
  root.get("*", serveStatic({ root: rel, path: "index.html" }));
}

const server = serve({ fetch: root.fetch, port, hostname: host }, (info) => {
  const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${info.port}`;
  console.log(`\n  🔥 Forja3D listo en ${url}`);
  console.log(`  📁 Datos en ${dataDir}`);
  console.log(`  🔌 MCP (HTTP): ${url}/mcp`);
  if (!existsSync(webDist)) console.log("  ℹ️  Interfaz web no compilada: usa `npm run dev` o `npm run build`.");
  if (host !== "127.0.0.1" && host !== "localhost" && !token) {
    console.warn("  ⚠️  Escuchando en la red sin FORJA_TOKEN: cualquiera en tu red podría usar tu API y tus impresoras.");
  }
});

const shutdown = async () => {
  server.close();
  await rt.close();
  await shutdownCad();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
