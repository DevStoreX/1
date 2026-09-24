import { useEffect, useState } from "react";
import { api, type Settings } from "../api.ts";
import { mcpSnippet } from "../components/Setup.tsx";
import { useApp, usd } from "../context.tsx";
import { useT } from "../i18n.ts";

type Draft = Partial<Settings> & Record<string, unknown>;

export function SettingsPage() {
  const t = useT();
  const { config, reloadConfig, usage, reloadUsage, toast } = useApp();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem("forja.token") ?? "");

  useEffect(() => {
    void reloadUsage();
  }, []);

  if (!config) return <div className="page"><p className="muted">{t("common.loading")}</p></div>;
  const s = { ...config.settings, ...draft } as Settings & Record<string, unknown>;
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const text = (k: string, label: string, opts: { type?: string; ph?: string } = {}) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={opts.type ?? "text"} autoComplete="off" placeholder={opts.ph} value={(s[k] as string | number | undefined) ?? ""} onChange={(e) => set(k, opts.type === "number" ? Number(e.target.value) : e.target.value)} />
    </label>
  );
  const secret = (k: string, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type="password" autoComplete="off" placeholder={config.settings.secrets[k] ?? "—"} value={(draft[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings(draft);
      setDraft({});
      await reloadConfig();
      toast(t("settings.saved"));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-head">
          <h1>{t("settings.title")}</h1>
          <button className="btn btn-primary" disabled={saving || Object.keys(draft).length === 0} onClick={() => void save()}>{saving ? <span className="spinner" /> : null} {t("settings.save")}</button>
        </div>

        {!config.ready.ready && <div className="notice" style={{ marginBottom: 12 }}>{config.ready.reason}</div>}

        <div className="card">
          <h3>{t("settings.presets")}</h3>
          <div className="preset-grid">
            {config.presets.map((p) => (
              <button key={p.id} className={`preset ${s.provider === p.provider && s.model === p.model ? "active" : ""}`} onClick={() => setDraft((d) => ({ ...d, provider: p.provider as Settings["provider"], model: p.model }))}>
                <b>{p.label}</b>
                <span>{p.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>{t("settings.provider")}</h3>
          <div className="grid-2">
            <label className="field">
              <span>{t("settings.provider")}</span>
              <select className="input" value={s.provider} onChange={(e) => set("provider", e.target.value)}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="ollama">Ollama (local, gratis)</option>
                <option value="openai-compatible">Compatible OpenAI (LM Studio, OpenRouter, DeepSeek…)</option>
              </select>
            </label>
            {text("model", t("settings.model"))}
            {s.provider === "anthropic" && secret("anthropicApiKey", t("settings.apiKey"))}
            {s.provider === "anthropic" && (
              <label className="field">
                <span>{t("settings.effort")}</span>
                <select className="input" value={s.effort} onChange={(e) => set("effort", e.target.value)}>
                  {["low", "medium", "high", "xhigh", "max"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
            )}
            {s.provider === "ollama" && text("ollamaUrl", t("settings.ollamaUrl"))}
            {s.provider === "openai-compatible" && text("openaiBaseUrl", t("settings.baseUrl"), { ph: "https://openrouter.ai/api/v1" })}
            {s.provider === "openai-compatible" && secret("openaiApiKey", "API key")}
            {s.provider === "openai-compatible" && text("customPriceInput", "USD / millón tokens entrada", { type: "number" })}
            {s.provider === "openai-compatible" && text("customPriceOutput", "USD / millón tokens salida", { type: "number" })}
          </div>
          <label className="switch" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={!!s.webSearch} onChange={(e) => set("webSearch", e.target.checked)} /> {t("settings.webSearch")}
          </label>
        </div>

        <div className="card">
          <h3>{t("settings.camera")}</h3>
          <div className="grid-2">
            <label className="field">
              <span>{t("settings.detector")}</span>
              <select className="input" value={s.cameraDetector} onChange={(e) => set("cameraDetector", e.target.value)}>
                <option value="vision">Modelo de visión (Claude / local)</option>
                <option value="obico">Obico ML (gratis, auto-hospedado)</option>
              </select>
            </label>
            {s.cameraDetector === "vision" ? (
              <>
                <label className="field">
                  <span>Proveedor de visión</span>
                  <select className="input" value={s.visionProvider} onChange={(e) => set("visionProvider", e.target.value)}>
                    <option value="anthropic">Anthropic</option>
                    <option value="ollama">Ollama</option>
                    <option value="openai-compatible">Compatible</option>
                  </select>
                </label>
                {text("visionModel", t("settings.visionModel"))}
              </>
            ) : (
              text("obicoUrl", t("settings.obicoUrl"), { ph: "http://localhost:3333" })
            )}
          </div>
        </div>

        <div className="card">
          <h3>{t("settings.gen3d")}</h3>
          <div className="grid-2">
            {secret("falKey", t("settings.falKey"))}
            {text("hunyuanUrl", t("settings.hunyuanUrl"), { ph: "http://mi-gpu:8081" })}
            {secret("thingiverseToken", t("settings.thingiverse"))}
          </div>
        </div>

        <div className="card">
          <h3>{t("settings.business")}</h3>
          <div className="grid-3">
            {text("currency", t("settings.currency"), { ph: "USD, COP, MXN, EUR…" })}
            <label className="field">
              <span>{t("settings.defaultMaterial")}</span>
              <select className="input" value={s.defaultMaterial} onChange={(e) => set("defaultMaterial", e.target.value)}>
                {config.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("settings.defaultPrinter")}</span>
              <select className="input" value={s.defaultPrinterProfile} onChange={(e) => set("defaultPrinterProfile", e.target.value)}>
                {config.printerProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {text("filamentPricePerKg", t("prices.filament"), { type: "number" })}
            {text("electricityPerKwh", t("prices.electricity"), { type: "number" })}
            {text("laborPerHour", t("prices.laborRate"), { type: "number" })}
            {text("marginPercent", t("prices.margin"), { type: "number" })}
            {text("platformFeePercent", t("prices.fee"), { type: "number" })}
            {text("monthlyBudgetUsd", t("settings.budget"), { type: "number" })}
          </div>
        </div>

        <div className="card">
          <h3>{t("settings.usage")}</h3>
          {usage ? (
            <>
              <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                <div className="stat"><div className="k">{t("settings.last30")}</div><div className="v">{usd(usage.last30dUsd)}</div></div>
                <div className="stat"><div className="k">{t("settings.total")}</div><div className="v">{usd(usage.totalUsd)}</div></div>
                {Object.entries(usage.byKind).map(([k, v]) => <div key={k} className="stat"><div className="k">{k}</div><div className="v">{usd(v)}</div></div>)}
              </div>
              {usage.entries.length > 0 && (
                <table className="table" style={{ marginTop: 12 }}>
                  <thead><tr><th>Fecha</th><th>Tipo</th><th>Modelo</th><th className="num">USD</th></tr></thead>
                  <tbody>
                    {usage.entries.slice(0, 15).map((e, i) => (
                      <tr key={i}><td>{new Date(e.at).toLocaleString()}</td><td>{e.kind}</td><td className="muted">{e.model ?? e.provider}</td><td className="num">{usd(e.costUsd)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : <p className="muted">{t("common.loading")}</p>}
        </div>

        <div className="card">
          <h3>{t("settings.mcp")}</h3>
          <p className="small muted" style={{ marginTop: 0 }}>{t("settings.mcpDesc")}</p>
          <p className="small"><b>HTTP:</b> <code>{location.origin}/mcp</code></p>
          <p className="small"><b>Claude Code:</b> <code>claude mcp add --transport http forja3d {location.origin}/mcp</code></p>
          <p className="small"><b>Claude Desktop (stdio):</b></p>
          <pre className="snippet">{mcpSnippet()}</pre>
        </div>

        <div className="card">
          <h3>{t("settings.language")} · {t("settings.token")}</h3>
          <div className="grid-2">
            <label className="field">
              <span>{t("settings.language")}</span>
              <select className="input" value={s.language} onChange={(e) => set("language", e.target.value)}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="field">
              <span>{t("settings.token")}</span>
              <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} onBlur={() => { localStorage.setItem("forja.token", token); void reloadConfig(); }} />
            </label>
          </div>
          <p className="small muted">Forja3D v{config.version} · código abierto (MIT) · {config.slicer ? "laminador conectado" : "sin laminador (sube tu G-code)"}</p>
        </div>
      </div>
    </div>
  );
}
