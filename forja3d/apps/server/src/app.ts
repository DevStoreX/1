import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp.ts";
import { chatRoutes } from "./routes/chat.ts";
import { modelRoutes } from "./routes/models.ts";
import { printerRoutes } from "./routes/printers.ts";
import { settingsRoutes } from "./routes/settings.ts";
import type { Runtime } from "./runtime.ts";

export interface AppOptions {
  /** Si se define, todas las rutas /api y /mcp exigen este token (Authorization: Bearer ...) */
  token?: string;
  /** Orígenes permitidos para CORS (por defecto solo el mismo origen) */
  corsOrigins?: string[];
}

export function createApp(rt: Runtime, opts: AppOptions = {}) {
  const app = new Hono();

  if (opts.corsOrigins?.length) app.use("*", cors({ origin: opts.corsOrigins }));

  if (opts.token) {
    const token = opts.token;
    app.use("/api/*", async (c, next) => {
      if (c.req.path === "/api/health") return next();
      const auth = c.req.header("authorization") ?? "";
      const q = c.req.query("token");
      if (auth !== `Bearer ${token}` && q !== token) return c.json({ error: "No autorizado", code: "auth" }, 401);
      return next();
    });
    app.use("/mcp", async (c, next) => {
      if (c.req.header("authorization") !== `Bearer ${token}`) return c.json({ error: "No autorizado" }, 401);
      return next();
    });
  }

  app.use("/api/*", bodyLimit({ maxSize: 160 * 1024 * 1024, onError: (c) => c.json({ error: "Petición demasiado grande" }, 413) }));

  app.route("/api", settingsRoutes(rt));
  app.route("/api", chatRoutes(rt));
  app.route("/api", modelRoutes(rt));
  app.route("/api", printerRoutes(rt));

  // MCP por HTTP (modo sin sesión): un servidor y un transporte por petición
  app.all("/mcp", async (c) => {
    const server = createMcpServer(rt);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // En modo JSON la respuesta ya está completa al volver de handleRequest
      void server.close();
    }
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}
