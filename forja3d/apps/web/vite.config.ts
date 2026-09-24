import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.FORJA_API ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: api, changeOrigin: true }, "/mcp": { target: api, changeOrigin: true } },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
