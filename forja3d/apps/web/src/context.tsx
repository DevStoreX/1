import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { SettingsResponse, Usage } from "./api.ts";

export interface AppState {
  config: SettingsResponse | null;
  setConfig: (c: SettingsResponse) => void;
  reloadConfig: () => Promise<void>;
  usage: Usage | null;
  reloadUsage: () => Promise<void>;
  toast: (message: string, kind?: "info" | "error") => void;
  navigate: (hash: string) => void;
}

export const AppContext = createContext<AppState>(null as never);

export function useApp(): AppState {
  return useContext(AppContext);
}

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return { toasts, toast };
}

export function ToastStack({ toasts }: { toasts: Toast[] }): ReactNode {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>{t.message}</div>
      ))}
    </div>
  );
}

export function money(v: number | undefined, currency = "USD"): string {
  if (v === undefined || Number.isNaN(v)) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: v < 1 ? 3 : 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

export function usd(v: number): string {
  return v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export function duration(sec: number | undefined): string {
  if (!sec && sec !== 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Reduce una imagen a máx. `max` px y la devuelve en base64 JPEG. */
export async function fileToImage(file: File, max = 1280): Promise<{ mime: string; data: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la imagen"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL("image/jpeg", 0.85);
    return { mime: "image/jpeg", data: preview.split(",")[1], preview };
  } finally {
    URL.revokeObjectURL(url);
  }
}
