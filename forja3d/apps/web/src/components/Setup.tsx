import { useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../context.tsx";
import { useT } from "../i18n.ts";

export function mcpSnippet(): string {
  return JSON.stringify(
    { mcpServers: { forja3d: { command: "npx", args: ["-y", "tsx", "/ruta/a/forja3d/apps/mcp/src/index.ts"] } } },
    null,
    2,
  );
}

/** Primer paso: elegir cómo usar la IA (Claude, modelo local gratis o MCP). */
export function Setup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { config, reloadConfig, toast } = useApp();
  const [mode, setMode] = useState<"claude" | "local" | "mcp">("claude");
  const [key, setKey] = useState("");
  const [preset, setPreset] = useState("max");
  const [ollamaUrl, setOllamaUrl] = useState(config?.settings.ollamaUrl ?? "http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen3:8b");
  const [saving, setSaving] = useState(false);
  const presets = config?.presets.filter((p) => p.provider === "anthropic") ?? [];

  const save = async () => {
    setSaving(true);
    try {
      if (mode === "claude") {
        const p = presets.find((x) => x.id === preset) ?? presets[0];
        await api.saveSettings({ provider: "anthropic", model: p?.model, anthropicApiKey: key.trim() });
      } else if (mode === "local") {
        await api.saveSettings({ provider: "ollama", ollamaUrl, model: ollamaModel, visionProvider: "ollama", visionModel: "qwen2.5vl:7b", webSearch: false });
      }
      await reloadConfig();
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <h3>🔥 {t("setup.title")}</h3>
      <div className="setup-options">
        <button className={`setup-option ${mode === "claude" ? "active" : ""}`} onClick={() => setMode("claude")}>
          <b>✨ {t("setup.claude")}</b>
          <span>{t("setup.claudeDesc")}</span>
        </button>
        <button className={`setup-option ${mode === "local" ? "active" : ""}`} onClick={() => setMode("local")}>
          <b>💻 {t("setup.local")}</b>
          <span>{t("setup.localDesc")}</span>
        </button>
        <button className={`setup-option ${mode === "mcp" ? "active" : ""}`} onClick={() => setMode("mcp")}>
          <b>🔌 {t("setup.mcp")}</b>
          <span>{t("setup.mcpDesc")}</span>
        </button>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {mode === "claude" && (
          <>
            <label className="field">
              <span>{t("settings.apiKey")}</span>
              <input className="input" type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
            </label>
            <p className="small muted" style={{ margin: 0 }}>
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> → API Keys. La clave se guarda solo en tu servidor de Forja.
            </p>
            <label className="field">
              <span>{t("settings.presets")}</span>
              <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label} — {p.model}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" disabled={!key.trim() || saving} onClick={() => void save()}>{t("setup.save")}</button>
          </>
        )}
        {mode === "local" && (
          <>
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Instala Ollama: <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">ollama.com/download</a></li>
              <li>En una terminal: <code>ollama pull {ollamaModel}</code> (y <code>ollama pull qwen2.5vl:7b</code> para la cámara)</li>
              <li>Pulsa guardar. Todo corre en tu equipo, sin costo.</li>
            </ol>
            <div className="grid-2">
              <label className="field"><span>{t("settings.ollamaUrl")}</span><input className="input" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} /></label>
              <label className="field"><span>{t("settings.model")}</span><input className="input" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} /></label>
            </div>
            <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{t("setup.save")}</button>
          </>
        )}
        {mode === "mcp" && (
          <>
            <p className="small" style={{ margin: 0 }}>Claude Desktop → Ajustes → Desarrollador → Editar configuración, y añade:</p>
            <pre className="snippet">{mcpSnippet()}</pre>
            <p className="small muted" style={{ margin: 0 }}>
              Claude Code: <code>claude mcp add forja3d -- npx -y tsx /ruta/a/forja3d/apps/mcp/src/index.ts</code>. Por HTTP: <code>{location.origin}/mcp</code>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
