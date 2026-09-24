import { useEffect, useMemo, useRef, useState } from "react";
import { api, fileUrl, type CostBreakdown, type Model, type Printer, type ScadParameter } from "../api.ts";
import { duration, money, useApp } from "../context.tsx";
import { useT } from "../i18n.ts";
import * as I from "./Icons.tsx";

interface Props {
  model: Model;
  onChange: (m: Model) => void;
  onBusy: (busy: boolean) => void;
  onDeleted: () => void;
}

function ParamControl({ p, value, onChange }: { p: ScadParameter; value: ScadParameter["value"]; onChange: (v: ScadParameter["value"]) => void }) {
  if (p.type === "boolean") {
    return (
      <label className="switch">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span className="cap">{p.name.replace(/_/g, " ")}</span>
      </label>
    );
  }
  if (p.options?.length) {
    return (
      <select className="input" value={String(value)} onChange={(e) => onChange(p.type === "number" ? Number(e.target.value) : e.target.value)}>
        {p.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (p.type === "number") {
    const n = Number(value);
    const hasRange = p.min !== undefined && p.max !== undefined;
    return (
      <div className="row" style={{ flexWrap: "nowrap" }}>
        {hasRange && (
          <input type="range" min={p.min} max={p.max} step={p.step ?? (Number.isInteger(p.value) ? 1 : 0.1)} value={n} onChange={(e) => onChange(Number(e.target.value))} aria-label={p.name} />
        )}
        <input className="param-num" type="number" value={n} step={p.step ?? "any"} onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))} />
      </div>
    );
  }
  if (p.type === "vector") {
    return <input className="input" defaultValue={(value as number[]).join(", ")} onBlur={(e) => onChange(e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)))} />;
  }
  return <input className="input" defaultValue={String(value)} onBlur={(e) => onChange(e.target.value)} />;
}

export function ModelPanel({ model, onChange, onBusy, onDeleted }: Props) {
  const t = useT();
  const { config, toast } = useApp();
  const currency = config?.settings.currency ?? "USD";
  const [values, setValues] = useState<Record<string, ScadParameter["value"]>>({});
  const [updating, setUpdating] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState(model.source ?? "");
  const [price, setPrice] = useState<CostBreakdown | null>(null);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printerId, setPrinterId] = useState("");
  const [startPrint, setStartPrint] = useState(false);
  const [scaleMm, setScaleMm] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<Record<string, ScadParameter["value"]>>({});
  const slicedInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValues({ ...Object.fromEntries((model.parameters ?? []).map((p) => [p.name, p.value])), ...(model.values ?? {}) });
    setCode(model.source ?? "");
    setScaleMm(Math.round(Math.max(...(model.analysis?.size ?? [0]))));
  }, [model.id, model.version]);

  useEffect(() => {
    api.printers().then((list) => {
      setPrinters(list);
      if (list[0]) setPrinterId((id) => id || list[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const e = model.estimate;
    if (!e) return;
    api.price({ grams: e.grams, printSeconds: e.printSeconds, materialId: e.materialId, printerId: e.printerId }).then(setPrice).catch(() => setPrice(null));
  }, [model.id, model.version, model.estimate?.grams]);

  const groups = useMemo(() => {
    const g = new Map<string, ScadParameter[]>();
    for (const p of model.parameters ?? []) {
      const key = p.group ?? "";
      g.set(key, [...(g.get(key) ?? []), p]);
    }
    return [...g.entries()];
  }, [model.parameters]);

  const push = async (patch: Parameters<typeof api.updateModel>[1]) => {
    setUpdating(true);
    onBusy(true);
    try {
      const r = await api.updateModel(model.id, patch);
      onChange({ ...r.model, source: patch.scad_code ?? model.source, estimate: r.estimate });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUpdating(false);
      onBusy(false);
    }
  };

  const setParam = (name: string, v: ScadParameter["value"]) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    pending.current[name] = v;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const patch = pending.current;
      pending.current = {};
      void push({ values: patch });
    }, 450);
  };

  const a = model.analysis;
  const e = model.estimate;
  const sliced = model.files.find((f) => f.startsWith("print."));
  const scoreColor = !a ? "var(--muted)" : a.score >= 80 ? "var(--ok)" : a.score >= 50 ? "var(--warn)" : "var(--bad)";

  return (
    <>
      {model.kind === "scad" && (model.parameters?.length ?? 0) > 0 && (
        <div className="card">
          <h3><I.Wrench /> {t("model.params")} {updating && <span className="spinner" style={{ marginLeft: "auto" }} />}</h3>
          {groups.map(([group, params]) => (
            <div key={group}>
              {group && <div className="group-title">{group}</div>}
              {params.map((p) => (
                <div key={p.name} className="param">
                  {p.type !== "boolean" && (
                    <div className="param-head">
                      <b>{p.name.replace(/_/g, " ")}</b>
                      {p.type === "number" && <output>{String(values[p.name])}</output>}
                    </div>
                  )}
                  <ParamControl p={p} value={values[p.name] ?? p.value} onChange={(v) => setParam(p.name, v)} />
                  {p.description && <span className="param-desc">{p.description}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {model.kind === "mesh" && (
        <div className="card">
          <h3><I.Wrench /> {t("model.params")}</h3>
          <p className="small muted" style={{ marginTop: 0 }}>{t("model.noParams")}</p>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <label className="field" style={{ flex: 1 }}>
              <span>{t("model.scaleTo")}</span>
              <input className="input" type="number" min={5} max={500} value={scaleMm} onChange={(ev) => setScaleMm(Number(ev.target.value))} />
            </label>
            <button className="btn" style={{ alignSelf: "flex-end" }} onClick={async () => {
              onBusy(true);
              try {
                const r = await api.rescale(model.id, scaleMm);
                onChange({ ...r.model, estimate: r.estimate });
              } catch (err) {
                toast((err as Error).message, "error");
              } finally {
                onBusy(false);
              }
            }}>OK</button>
          </div>
        </div>
      )}

      {a && (
        <div className="card">
          <h3><I.Check /> {t("model.analysis")}</h3>
          <div className="score">
            <span className="small muted">{t("model.score")}</span>
            <div className="score-bar"><div style={{ width: `${a.score}%`, background: scoreColor }} /></div>
            <b style={{ color: scoreColor }}>{a.score}</b>
          </div>
          <div className="stats" style={{ marginTop: 10 }}>
            <div className="stat"><div className="k">{t("model.size")}</div><div className="v">{a.size.map((v) => v.toFixed(1)).join(" × ")} mm</div></div>
            <div className="stat"><div className="k">{t("model.volume")}</div><div className="v">{a.volumeCm3.toFixed(2)} cm³</div></div>
          </div>
          <ul className="checks">
            <li>{a.watertight ? <span className="badge ok">✓</span> : <span className="badge bad">✗</span>} {t("model.watertight")}</li>
            <li>{a.needsSupports ? <span className="badge warn">!</span> : <span className="badge ok">✓</span>} {t("model.supports")}: {a.needsSupports ? `${t("model.yes")} (${a.overhang.percent.toFixed(1)}%)` : t("model.no")}</li>
            {a.fits && (
              <li>{a.fits.fits ? <span className="badge ok">✓</span> : a.fits.fitsRotated ? <span className="badge warn">!</span> : <span className="badge bad">✗</span>} {t("model.fits")}: {a.fits.fits ? t("model.yes") : a.fits.fitsRotated ? t("model.rotated") : t("model.no")} <span className="muted small">({a.fits.buildVolume.x}×{a.fits.buildVolume.y}×{a.fits.buildVolume.z})</span></li>
            )}
            {a.issues.filter((i) => !["not_watertight", "overhangs", "too_big"].includes(i.code)).map((i) => (
              <li key={i.code}><span className={`badge ${i.level === "error" ? "bad" : "warn"}`}>!</span> {i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {e && (
        <div className="card">
          <h3><I.Tag /> {t("model.estimate")}</h3>
          <div className="stats">
            <div className="stat"><div className="k">{t("model.grams")}</div><div className="v">{e.grams} g · {e.materialId}</div></div>
            <div className="stat"><div className="k">{t("model.time")}</div><div className="v">{duration(e.printSeconds)}</div></div>
            <div className="stat"><div className="k">{t("model.cost")}</div><div className="v">{money(price?.totalCost, currency)}</div></div>
            <div className="stat"><div className="k">{t("prices.suggested")}</div><div className="v" style={{ color: "var(--accent-strong)" }}>{money(price?.suggestedPrice, currency)}</div></div>
          </div>
          <p className="small muted" style={{ margin: "8px 0 0" }}>{e.accuracy}</p>
        </div>
      )}

      <div className="card">
        <div className="row">
          <a className="btn btn-primary" href={fileUrl(model.id, "model.stl", model.version, true)}><I.Download /> {t("model.downloadStl")}</a>
          {model.kind === "scad" && <a className="btn" href={fileUrl(model.id, "source.scad", model.version, true)}><I.Code /> {t("model.downloadScad")}</a>}
          {model.kind === "scad" && <button className="btn" onClick={() => setShowCode((s) => !s)}><I.Code /> {t("model.code")}</button>}
        </div>
        {showCode && (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <textarea className="code-edit" spellCheck={false} value={code} onChange={(ev) => setCode(ev.target.value)} />
            <button className="btn" disabled={updating || code === model.source} onClick={() => void push({ scad_code: code })}>{updating ? <span className="spinner" /> : <I.Refresh />} {t("model.compile")}</button>
          </div>
        )}

        <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "14px 0" }} />
        <div style={{ display: "grid", gap: 8 }}>
          <div className="row">
            <button className="btn btn-sm" onClick={() => slicedInput.current?.click()}><I.Upload /> {t("model.uploadSliced")}</button>
            {sliced && <span className="badge ok">✓ {t("model.sliced")}</span>}
            <input ref={slicedInput} type="file" hidden accept=".gcode,.bgcode,.3mf" onChange={async (ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = "";
              if (!f) return;
              try {
                const r = await api.uploadSliced(model.id, f);
                onChange({ ...model, ...r.model });
                toast(r.info?.printSeconds ? `${t("model.sliced")}: ${duration(r.info.printSeconds)} · ${r.info.filamentGrams ?? "?"} g` : t("model.sliced"));
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }} />
          </div>
          {printers.length > 0 && (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <select className="input" value={printerId} onChange={(ev) => setPrinterId(ev.target.value)}>
                {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <label className="switch small" title="Iniciar al subir"><input type="checkbox" checked={startPrint} onChange={(ev) => setStartPrint(ev.target.checked)} />▶</label>
              <button className="btn" disabled={!printerId} onClick={async () => {
                try {
                  const r = await api.sendToPrinter(printerId, model.id, startPrint);
                  toast(`✓ ${r.uploaded}${r.started ? " ▶" : ""}`);
                } catch (err) {
                  toast((err as Error).message, "error");
                }
              }}><I.Printer /> {t("model.sendPrinter")}</button>
            </div>
          )}
          <button className="btn btn-sm btn-ghost btn-danger" style={{ justifySelf: "start" }} onClick={async () => {
            if (!confirm(`${t("model.delete")} "${model.name}"?`)) return;
            await api.deleteModel(model.id);
            onDeleted();
          }}><I.Trash /> {t("model.delete")}</button>
        </div>
      </div>
    </>
  );
}
