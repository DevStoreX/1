import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ALL_TOOLS, DESIGN_GUIDELINES, type ForjaTool } from "@forja3d/agent";
import type { Runtime } from "./runtime.ts";
import { VERSION } from "./routes/settings.ts";

const INSTRUCTIONS = `Forja3D convierte ideas en piezas imprimibles en 3D. Tú escribes el código OpenSCAD y Forja lo compila (motor Manifold), comprueba si se puede imprimir, estima filamento/tiempo/precio y habla con las impresoras (Bambu Lab, Prusa, Klipper, OctoPrint).
Flujo típico: search_models (¿ya existe?) → create_model → leer el análisis y corregir → update_model para ajustar medidas → estimate_price → send_to_printer.
Cada modelo creado se ve en la interfaz web de Forja (viewer_url) y se descarga como STL (stl_url).

${DESIGN_GUIDELINES}`;

const MODEL_TOOLS = new Set(["create_model", "update_model", "generate_organic_mesh", "get_model", "analyze_model"]);

/**
 * Servidor MCP con las herramientas de Forja. Cualquier asistente compatible con MCP
 * (Claude Desktop, Claude Code, ChatGPT, Cursor, VS Code...) puede diseñar e imprimir
 * usando su propia suscripción: Forja no cobra nada por encima.
 */
export function createMcpServer(rt: Runtime, tools: ForjaTool[] = ALL_TOOLS): McpServer {
  const server = new McpServer({ name: "forja3d", version: VERSION }, { instructions: INSTRUCTIONS });
  const base = rt.publicUrl ?? `http://localhost:${process.env.PORT ?? 8787}`;

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: ["get_model", "list_models", "analyze_model", "estimate_price", "search_models", "list_printers", "reference_data", "check_camera"].includes(tool.name),
          destructiveHint: tool.name === "printer_control",
          openWorldHint: ["search_models", "generate_organic_mesh"].includes(tool.name),
        },
      },
      (async (input: unknown) => {
        const ctx = await rt.toolContext();
        const parsed = tool.schema.safeParse(input);
        if (!parsed.success) {
          return { isError: true, content: [{ type: "text", text: `Entrada no válida: ${parsed.error.message}` }] } satisfies CallToolResult;
        }
        try {
          const out = await tool.run(parsed.data, ctx);
          let text = out.content;
          if (!out.isError && MODEL_TOOLS.has(tool.name)) {
            try {
              const data = JSON.parse(out.content) as { model_id?: string };
              if (data.model_id) {
                text = JSON.stringify({ ...data, viewer_url: `${base}/#/model/${data.model_id}`, stl_url: `${base}/api/models/${data.model_id}/files/model.stl?download=1` });
              }
            } catch {
              /* texto plano */
            }
          }
          const content: CallToolResult["content"] = [{ type: "text", text }];
          for (const img of out.images ?? []) content.push({ type: "image", data: img.data, mimeType: img.mime });
          return { content, isError: out.isError } satisfies CallToolResult;
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: (e as Error).message }] } satisfies CallToolResult;
        }
      }) as never,
    );
  }

  server.registerPrompt(
    "disenar_pieza",
    { title: "Diseñar una pieza imprimible", description: "Guía para convertir una idea o invento en una pieza OpenSCAD imprimible" },
    () => ({
      messages: [{ role: "user", content: { type: "text", text: `${DESIGN_GUIDELINES}\n\nAyúdame a diseñar una pieza. Pregúntame qué necesito.` } }],
    }),
  );

  return server;
}
