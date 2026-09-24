import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type SettingsResponse, type Usage } from "./api.ts";
import * as I from "./components/Icons.tsx";
import { AppContext, ToastStack, useToasts, usd } from "./context.tsx";
import { LangContext, translate, type Key } from "./i18n.ts";
import { CreatePage } from "./pages/CreatePage.tsx";
import { ModelsPage } from "./pages/ModelsPage.tsx";
import { PricesPage } from "./pages/PricesPage.tsx";
import { PrintersPage } from "./pages/PrintersPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash || "#/crear");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/crear");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

const NAV: { hash: string; key: Key; icon: () => ReactNode }[] = [
  { hash: "#/crear", key: "nav.create", icon: () => <I.Sparkles /> },
  { hash: "#/modelos", key: "nav.models", icon: () => <I.Cube /> },
  { hash: "#/impresoras", key: "nav.printers", icon: () => <I.Printer /> },
  { hash: "#/precios", key: "nav.prices", icon: () => <I.Tag /> },
  { hash: "#/ajustes", key: "nav.settings", icon: () => <I.Gear /> },
];

export function App() {
  const hash = useHash();
  const { toasts, toast } = useToasts();
  const [config, setConfig] = useState<SettingsResponse | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [authError, setAuthError] = useState(false);
  const lang = config?.settings.language ?? "es";
  const t = (k: Key) => translate(lang, k);

  const reloadConfig = useCallback(async () => {
    try {
      setConfig(await api.settings());
      setAuthError(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthError(true);
      else toast((e as Error).message, "error");
    }
  }, [toast]);
  const reloadUsage = useCallback(async () => {
    try {
      setUsage(await api.usage());
    } catch {
      /* sin conexión */
    }
  }, []);
  const navigate = useCallback((h: string) => {
    location.hash = h;
  }, []);

  useEffect(() => {
    void reloadConfig();
    void reloadUsage();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.body.classList.toggle("kid", !!config?.settings.kidMode);
  }, [lang, config?.settings.kidMode]);

  // Notificaciones en vivo (cámara)
  useEffect(() => {
    const tokenParam = localStorage.getItem("forja.token");
    const es = new EventSource(`/api/events${tokenParam ? `?token=${encodeURIComponent(tokenParam)}` : ""}`);
    es.addEventListener("camera_paused", () => toast("⚠️ La cámara detectó un fallo y pausó la impresora.", "error"));
    return () => es.close();
  }, [toast]);

  const toggleKid = async () => {
    if (!config) return;
    const r = await api.saveSettings({ kidMode: !config.settings.kidMode });
    setConfig({ ...config, settings: r.settings });
  };

  const route = hash.split("/")[1] ?? "crear";
  const modelId = route === "model" ? hash.split("/")[2] : undefined;
  const active = route === "model" ? "#/crear" : `#/${route}`;

  if (authError) {
    return (
      <div className="page" style={{ maxWidth: 420, margin: "10vh auto" }}>
        <div className="card">
          <h2>🔒 Forja3D</h2>
          <p className="muted">Este servidor requiere un token de acceso (FORJA_TOKEN).</p>
          <form onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get("token");
            localStorage.setItem("forja.token", String(v ?? ""));
            void reloadConfig();
          }} className="row" style={{ flexWrap: "nowrap" }}>
            <input name="token" className="input" type="password" autoFocus />
            <button className="btn btn-primary">OK</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <LangContext.Provider value={lang}>
      <AppContext.Provider value={{ config, setConfig, reloadConfig, usage, reloadUsage, toast, navigate }}>
        <div className="app">
          <header className="topbar">
            <a className="brand" href="#/crear">
              <I.Logo className="brand-mark" />
              <span>
                <span className="brand-name">Forja<b>3D</b></span>
                <span className="brand-tag">{t("app.tagline")}</span>
              </span>
            </a>
            <nav className="nav">
              {NAV.map((n) => (
                <a key={n.hash} href={n.hash} className={active === n.hash ? "active" : ""}>
                  {n.icon()} {t(n.key)}
                </a>
              ))}
            </nav>
            <div className="top-actions">
              {usage && <span className="chip spend" title={t("app.spent")}>IA 30d <b>{usd(usage.last30dUsd)}</b></span>}
              <button className={`btn btn-sm ${config?.settings.kidMode ? "btn-primary" : ""}`} onClick={() => void toggleKid()} title={t("app.kidMode")}>
                <I.Kid /> <span className="hide-sm">{t("app.kidMode")}</span>
              </button>
            </div>
          </header>
          <main className="main">
            {route === "crear" || route === "model" ? (
              <CreatePage modelId={modelId} />
            ) : route === "modelos" ? (
              <ModelsPage />
            ) : route === "impresoras" ? (
              <PrintersPage />
            ) : route === "precios" ? (
              <PricesPage />
            ) : route === "ajustes" ? (
              <SettingsPage />
            ) : (
              <CreatePage />
            )}
          </main>
          <ToastStack toasts={toasts} />
        </div>
      </AppContext.Provider>
    </LangContext.Provider>
  );
}
