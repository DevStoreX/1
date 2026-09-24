import { useEffect, useState } from "react";
import { api, fileUrl, type Model } from "../api.ts";
import { Chat } from "../components/Chat.tsx";
import { ModelPanel } from "../components/ModelPanel.tsx";
import { Viewer3D } from "../components/Viewer3D.tsx";
import * as I from "../components/Icons.tsx";
import { useApp } from "../context.tsx";
import { useT } from "../i18n.ts";

export function CreatePage({ modelId }: { modelId?: string }) {
  const t = useT();
  const { config, navigate, toast } = useApp();
  const [model, setModel] = useState<Model | null>(null);
  const [busy, setBusy] = useState(false);
  const [wire, setWire] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [view, setView] = useState<"chat" | "model">("chat");
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    const id = modelId ?? localStorage.getItem("forja.model") ?? undefined;
    if (!id) return;
    if (id === model?.id) return;
    api.model(id).then(setModel).catch(() => localStorage.removeItem("forja.model"));
  }, [modelId]);

  useEffect(() => {
    if (model) localStorage.setItem("forja.model", model.id);
  }, [model?.id]);

  const openModel = async (m: Model) => {
    // Los eventos traen el registro; pedimos el completo (código y estimación)
    try {
      setModel(await api.model(m.id));
    } catch {
      setModel(m);
    }
    if (view === "chat") setUnseen(true);
    if (location.hash !== `#/model/${m.id}`) history.replaceState(null, "", `#/model/${m.id}`);
  };

  const profile = config?.printerProfiles.find((p) => p.id === config.settings.defaultPrinterProfile);

  return (
    <div className="create" data-view={view}>
      <div className="mobile-tabs">
        <button className={`btn ${view === "chat" ? "btn-primary" : ""}`} onClick={() => setView("chat")}><I.Chat /> Chat</button>
        <button className={`btn ${view === "model" ? "btn-primary" : ""}`} onClick={() => { setView("model"); setUnseen(false); }}>
          <I.Cube /> {model?.name ?? "3D"} {unseen && <span className="badge warn">●</span>}
        </button>
      </div>
      <Chat selectedModelId={model?.id} onModel={(m) => void openModel(m)} />
      <div className={`workspace ${model ? "" : "no-side"}`}>
        <div className="viewer-wrap">
          <Viewer3D
            url={model ? fileUrl(model.id, "model.stl", model.version) : null}
            modelKey={model?.id}
            buildVolume={profile?.buildVolume}
            wireframe={wire}
            fitNonce={fitNonce}
            onError={(msg) => toast(msg, "error")}
          />
          {!model && (
            <div className="viewer-empty">
              <I.Cube />
              <b>{t("viewer.empty")}</b>
              <span className="small">{t("viewer.emptyHint")}</span>
              <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => navigate("#/modelos")}><I.Upload /> {t("models.import")}</button>
            </div>
          )}
          {model && (
            <div className="viewer-toolbar">
              <span className="viewer-title" title={model.name}>{model.name} <span className="muted small">· {t("model.version")} {model.version}</span></span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => setFitNonce((n) => n + 1)} title={t("viewer.fit")}><I.Target /></button>
              <button className={`btn btn-sm ${wire ? "btn-primary" : ""}`} onClick={() => setWire((w) => !w)} title={t("viewer.wire")}><I.Grid /></button>
            </div>
          )}
          {busy && <div className="viewer-busy"><span className="spinner" /> {t("model.updating")}</div>}
        </div>
        {model && (
          <aside className="side">
            <ModelPanel
              model={model}
              onChange={setModel}
              onBusy={setBusy}
              onDeleted={() => {
                setModel(null);
                localStorage.removeItem("forja.model");
                navigate("#/crear");
              }}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
