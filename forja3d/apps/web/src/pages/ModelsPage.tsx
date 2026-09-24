import { useEffect, useRef, useState } from "react";
import { api, type ModelSummary } from "../api.ts";
import * as I from "../components/Icons.tsx";
import { fileToImage, useApp, usd } from "../context.tsx";
import { useT } from "../i18n.ts";

export function ModelsPage() {
  const t = useT();
  const { navigate, toast, config, reloadUsage } = useApp();
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<{ data: string; mime: string; preview: string } | null>(null);
  const [provider, setProvider] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<Awaited<ReturnType<typeof api.search>> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);

  const load = () => api.models().then(setModels).catch((e) => toast(e.message, "error"));
  useEffect(() => {
    void load();
  }, []);

  const providers = config?.gen3dProviders ?? [];
  const chosen = providers.find((p) => p.id === provider) ?? providers[0];

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-head">
          <h1>{t("models.title")}</h1>
          <div className="row">
            <button className="btn btn-primary" disabled={importing} onClick={() => fileInput.current?.click()}>
              {importing ? <span className="spinner" /> : <I.Upload />} {t("models.import")}
            </button>
            <input ref={fileInput} type="file" hidden accept=".stl,.glb,.obj" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setImporting(true);
              try {
                const r = await api.importModel(f);
                navigate(`#/model/${r.model.id}`);
              } catch (err) {
                toast((err as Error).message, "error");
              } finally {
                setImporting(false);
              }
            }} />
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 18 }}>
          <div className="card">
            <h3><I.Sparkles /> {t("models.generate")}</h3>
            <p className="small muted" style={{ marginTop: 0 }}>{t("models.generateDesc")}</p>
            <div style={{ display: "grid", gap: 8 }}>
              <input className="input" placeholder={t("models.prompt")} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <div className="row">
                <button className="btn btn-sm" onClick={() => imgInput.current?.click()}><I.Image /> {t("models.image")}</button>
                {image && <img src={image.preview} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />}
                <input ref={imgInput} type="file" hidden accept="image/*" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setImage(await fileToImage(f, 1024));
                }} />
              </div>
              <select className="input" value={chosen?.id ?? ""} onChange={(e) => setProvider(e.target.value)}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.costUsd ? `~$${p.costUsd}` : t("common.free")}</option>)}
              </select>
              {chosen && <span className="small muted">{chosen.notes} ({chosen.requires})</span>}
              <button className="btn btn-primary" disabled={genBusy || (!prompt.trim() && !image)} onClick={async () => {
                setGenBusy(true);
                try {
                  const r = await api.generate3d({ provider: chosen?.id, prompt: prompt.trim() || undefined, image: image ? `data:${image.mime};base64,${image.data}` : undefined, name: prompt.trim().slice(0, 40) || undefined });
                  toast(`✓ ${usd(r.costUsd)}`);
                  void reloadUsage();
                  navigate(`#/model/${r.model.id}`);
                } catch (err) {
                  toast((err as Error).message, "error");
                } finally {
                  setGenBusy(false);
                }
              }}>{genBusy ? <span className="spinner" /> : <I.Sparkles />} {t("models.generateBtn")}</button>
            </div>
          </div>

          <div className="card">
            <h3><I.Search /> {t("models.search")}</h3>
            <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={async (e) => {
              e.preventDefault();
              if (!q.trim()) return;
              try {
                setSearch(await api.search(q.trim()));
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }}>
              <input className="input" placeholder={t("models.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn"><I.Search /></button>
            </form>
            {search && (
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                {search.results.slice(0, 6).map((r) => (
                  <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="small">{r.title} <span className="muted">· {r.source}</span></a>
                ))}
                {search.links.map((l) => (
                  <a key={l.source} href={l.url} target="_blank" rel="noopener noreferrer" className="small">
                    {l.source} <span className="muted">— {l.note}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {models === null ? (
          <p className="muted">{t("common.loading")}</p>
        ) : models.length === 0 ? (
          <div className="card empty">{t("models.empty")}</div>
        ) : (
          <div className="model-grid">
            {models.map((m) => (
              <div key={m.id} className="card model-card" onClick={() => navigate(`#/model/${m.id}`)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`#/model/${m.id}`)}>
                <div className="thumb">{m.kind === "scad" ? <I.Code width={36} height={36} /> : <I.Sparkles width={36} height={36} />}</div>
                <b>{m.name}</b>
                <span className="small muted">
                  {m.size ? `${m.size.map((v) => Math.round(v)).join("×")} mm · ` : ""}v{m.version} · {new Date(m.updatedAt).toLocaleDateString()}
                </span>
                <div className="row">
                  <span className="badge neutral">{m.kind === "scad" ? "OpenSCAD" : m.origin.startsWith("gen3d") ? "IA" : "Malla"}</span>
                  {m.score !== undefined && <span className={`badge ${m.score >= 80 ? "ok" : m.score >= 50 ? "warn" : "bad"}`}>{m.score}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
