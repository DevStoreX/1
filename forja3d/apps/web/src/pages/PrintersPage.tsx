import { useCallback, useEffect, useState } from "react";
import { api, snapshotUrl, type CameraCheck, type Printer, type PrinterKind, type PrinterStatus } from "../api.ts";
import * as I from "../components/Icons.tsx";
import { duration, useApp } from "../context.tsx";
import { useT, type Key } from "../i18n.ts";

const KINDS: { id: PrinterKind; label: string }[] = [
  { id: "bambu", label: "Bambu Lab (A1, P1S, X1C, H2D…)" },
  { id: "prusalink", label: "Prusa (PrusaLink)" },
  { id: "moonraker", label: "Klipper (Moonraker / Mainsail / Fluidd)" },
  { id: "octoprint", label: "OctoPrint (Ender, Anycubic…)" },
  { id: "mock", label: "Simulada (demo)" },
];

function PrinterForm({ initial, onClose, onSaved }: { initial?: Printer; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { config, toast } = useApp();
  const [p, setP] = useState<Partial<Printer>>(initial ?? { kind: "bambu", name: "" });
  const [testing, setTesting] = useState(false);
  const set = (k: keyof Printer, v: string) => setP((prev) => ({ ...prev, [k]: v || undefined }));
  const secretPh = (k: string) => (initial?.hasSecrets?.[k] ? "•••••• (guardado)" : "");

  const field = (k: keyof Printer, label: string, opts: { type?: string; ph?: string } = {}) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={opts.type ?? "text"} autoComplete="off" placeholder={opts.ph} value={(p[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{initial ? p.name : t("printers.add")}</h2>
        <div style={{ display: "grid", gap: 10 }}>
          <label className="field">
            <span>{t("printers.kind")}</span>
            <select className="input" value={p.kind} onChange={(e) => setP((prev) => ({ ...prev, kind: e.target.value as PrinterKind }))}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          <p className="small muted" style={{ margin: 0 }}>{t(`printers.help.${p.kind}` as Key)}</p>
          {field("name", t("printers.name"), { ph: "Mi impresora" })}
          {p.kind === "bambu" && (
            <div className="grid-2">
              {field("host", "IP", { ph: "192.168.1.50" })}
              {field("serial", "Serial", { ph: "01S00A…" })}
              {field("accessCode", "Código de acceso LAN", { type: "password", ph: secretPh("accessCode") })}
              <label className="field">
                <span>Modelo</span>
                <select className="input" value={p.model ?? "p1"} onChange={(e) => set("model", e.target.value)}>
                  <option value="a1">A1 / A1 mini</option>
                  <option value="p1">P1P / P1S / P2S</option>
                  <option value="x1">X1 / X1C / X1E</option>
                  <option value="h2d">H2D</option>
                </select>
              </label>
            </div>
          )}
          {(p.kind === "octoprint" || p.kind === "moonraker" || p.kind === "prusalink") && field("url", "URL", { ph: p.kind === "moonraker" ? "http://192.168.1.60:7125" : "http://192.168.1.60" })}
          {(p.kind === "octoprint" || p.kind === "moonraker" || p.kind === "prusalink") && field("apiKey", `API key (${t("common.optional")})`, { type: "password", ph: secretPh("apiKey") })}
          {p.kind === "prusalink" && (
            <div className="grid-2">
              {field("username", "Usuario", { ph: "maker" })}
              {field("password", "Contraseña", { type: "password", ph: secretPh("password") })}
            </div>
          )}
          {field("cameraUrl", `URL de cámara JPEG/MJPEG (${t("common.optional")})`, { ph: "http://192.168.1.60/webcam/?action=snapshot" })}
          <label className="field">
            <span>Perfil (volumen y consumo)</span>
            <select className="input" value={p.profileId ?? ""} onChange={(e) => set("profileId", e.target.value)}>
              <option value="">—</option>
              {config?.printerProfiles.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
            </select>
          </label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" disabled={testing} onClick={async () => {
              setTesting(true);
              try {
                const r = await api.testPrinter(p);
                toast(r.ok ? `✓ ${r.status?.state ?? "OK"}` : `✗ ${r.error ?? r.status?.message ?? "Sin respuesta"}`, r.ok ? "info" : "error");
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setTesting(false);
              }
            }}>{testing ? <span className="spinner" /> : <I.Refresh />} {t("printers.test")}</button>
            <button className="btn btn-ghost" onClick={onClose}>{t("printers.cancel")}</button>
            <button className="btn btn-primary" onClick={async () => {
              try {
                await api.savePrinter(p);
                onSaved();
              } catch (e) {
                toast((e as Error).message, "error");
              }
            }}>{t("printers.save")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrinterCard({ printer, onEdit, onDelete }: { printer: Printer; onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  const { toast, reloadUsage } = useApp();
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [nonce, setNonce] = useState(0);
  const [camOk, setCamOk] = useState(true);
  const [check, setCheck] = useState<CameraCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [interval, setIntervalSec] = useState(60);

  const refresh = useCallback(() => api.printerStatus(printer.id).then(setStatus).catch(() => setStatus({ online: false, state: "offline" })), [printer.id]);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
      setNonce((n) => n + 1);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const act = async (a: "pause" | "resume" | "cancel") => {
    if (a === "cancel" && !confirm(t("printers.confirmStop"))) return;
    try {
      await api.printerAction(printer.id, a);
      void refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const state = status?.state ?? "unknown";
  const stateClass = state === "printing" || state === "finished" || state === "idle" ? "ok" : state === "paused" || state === "busy" ? "warn" : state === "error" || state === "offline" ? "bad" : "neutral";
  const monitor = status?.monitor;
  const lastCheck = check ?? monitor?.history?.[0] ?? null;

  return (
    <div className="card printer-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <b>{printer.name}</b>
          <div className="small muted">{KINDS.find((k) => k.id === printer.kind)?.label}</div>
        </div>
        <span className={`badge ${stateClass}`}>{t(`printers.state.${state}` as Key) || state}</span>
      </div>

      {status?.progress !== undefined && (state === "printing" || state === "paused") && (
        <div>
          <div className="row small" style={{ justifyContent: "space-between" }}>
            <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{status.fileName}</span>
            <b>{Math.round(status.progress * 100)}%{status.timeLeftSec ? ` · ${duration(status.timeLeftSec)} ${t("printers.left")}` : ""}</b>
          </div>
          <div className="progress"><div style={{ width: `${Math.round(status.progress * 100)}%` }} /></div>
        </div>
      )}

      {status?.temps && (
        <div className="stats">
          {status.temps.nozzle && <div className="stat"><div className="k">{t("printers.nozzle")}</div><div className="v">{Math.round(status.temps.nozzle.actual)}°{status.temps.nozzle.target ? ` / ${status.temps.nozzle.target}°` : ""}</div></div>}
          {status.temps.bed && <div className="stat"><div className="k">{t("printers.bed")}</div><div className="v">{Math.round(status.temps.bed.actual)}°{status.temps.bed.target ? ` / ${status.temps.bed.target}°` : ""}</div></div>}
        </div>
      )}
      {status?.message && <div className="small muted">{status.message}</div>}

      <div className={`camera ${camOk ? "" : "none"}`}>
        {camOk ? (
          <img src={snapshotUrl(printer.id, nonce)} alt={t("printers.camera")} onError={() => setCamOk(false)} onLoad={() => setCamOk(true)} />
        ) : (
          <span><I.Camera /> {t("printers.noCamera")}</span>
        )}
      </div>
      {lastCheck && (
        <div className={`verdict ${lastCheck.verdict}`}>
          <b>{lastCheck.verdict === "ok" ? "✓" : lastCheck.verdict === "failure" ? "✗" : "?"} {lastCheck.explanation || lastCheck.verdict}</b>
          {lastCheck.issues.length > 0 && <div className="small">{lastCheck.issues.join(" · ")}</div>}
          <div className="small">{new Date(lastCheck.at).toLocaleTimeString()} · {lastCheck.detector}{lastCheck.costUsd ? ` · $${lastCheck.costUsd.toFixed(4)}` : ""}</div>
        </div>
      )}

      <div className="row">
        {state === "printing" && <button className="btn btn-sm" onClick={() => void act("pause")}><I.Pause /> {t("printers.pause")}</button>}
        {state === "paused" && <button className="btn btn-sm" onClick={() => void act("resume")}><I.Play /> {t("printers.resume")}</button>}
        {(state === "printing" || state === "paused") && <button className="btn btn-sm btn-danger" onClick={() => void act("cancel")}><I.Stop /> {t("printers.stop")}</button>}
        <button className="btn btn-sm" disabled={checking || !camOk} onClick={async () => {
          setChecking(true);
          try {
            setCheck(await api.checkCamera(printer.id));
            void reloadUsage();
          } catch (e) {
            toast((e as Error).message, "error");
          } finally {
            setChecking(false);
          }
        }}>{checking ? <span className="spinner" /> : <I.Sparkles />} {t("printers.checkAi")}</button>
      </div>

      <div className="row small">
        <label className="switch">
          <input type="checkbox" checked={!!monitor?.running} onChange={async (e) => {
            try {
              await api.setMonitor(printer.id, { enabled: e.target.checked, intervalSec: interval, autoPause: true });
              void refresh();
            } catch (err) {
              toast((err as Error).message, "error");
            }
          }} />
          {t("printers.monitor")}
        </label>
        <span className="muted">{t("printers.every")}</span>
        <select className="input" style={{ width: 90, padding: "3px 6px" }} value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))}>
          {[30, 60, 120, 300].map((s) => <option key={s} value={s}>{s} {t("printers.seconds")}</option>)}
        </select>
        {monitor?.running && <span className="badge ok">● {t("printers.autoPause")}</span>}
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-sm btn-ghost" onClick={onEdit}><I.Gear /></button>
        <button className="btn btn-sm btn-ghost btn-danger" onClick={onDelete}><I.Trash /></button>
      </div>
    </div>
  );
}

export function PrintersPage() {
  const t = useT();
  const { toast } = useApp();
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [editing, setEditing] = useState<Printer | "new" | null>(null);
  const load = () => api.printers().then(setPrinters).catch((e) => toast(e.message, "error"));
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-head">
          <h1>{t("printers.title")}</h1>
          <button className="btn btn-primary" onClick={() => setEditing("new")}><I.Plus /> {t("printers.add")}</button>
        </div>
        {printers === null ? (
          <p className="muted">{t("common.loading")}</p>
        ) : printers.length === 0 ? (
          <div className="card empty">
            <I.Printer width={40} height={40} />
            <p>{t("printers.empty")}</p>
            <button className="btn btn-primary" onClick={() => setEditing("new")}><I.Plus /> {t("printers.add")}</button>
          </div>
        ) : (
          <div className="printer-grid">
            {printers.map((p) => (
              <PrinterCard key={p.id} printer={p} onEdit={() => setEditing(p)} onDelete={async () => {
                if (!confirm(`¿Eliminar ${p.name}?`)) return;
                await api.deletePrinter(p.id);
                void load();
              }} />
            ))}
          </div>
        )}
        {editing && (
          <PrinterForm initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
        )}
      </div>
    </div>
  );
}
