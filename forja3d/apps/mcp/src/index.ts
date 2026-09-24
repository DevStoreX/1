import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { shutdownCad } from "@forja3d/core";
import { createMcpServer } from "@forja3d/server/mcp";
import { Runtime } from "@forja3d/server/runtime";

// Por stdio, stdout es el canal del protocolo: los mensajes humanos van a stderr.
const rt = new Runtime();
const server = createMcpServer(rt);
await server.connect(new StdioServerTransport());
console.error(`Forja3D MCP listo (datos en ${rt.store.dir})`);

const shutdown = async () => {
  await server.close();
  await rt.close();
  await shutdownCad();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Si el cliente MCP se desconecta, salimos sin ruido
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") void shutdown();
});
