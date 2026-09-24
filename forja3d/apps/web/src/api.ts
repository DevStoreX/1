// Cliente de la API de Forja3D
export interface ScadParameter {
  name: string;
  type: "number" | "string" | "boolean" | "vector";
  value: number | string | boolean | number[];
  description?: string;
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
}

export interface Issue {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface Analysis {
  triangles: number;
  size: [number, number, number];
  volumeCm3: number;
  surfaceAreaCm2: number;
  watertight: boolean;
  needsSupports: boolean;
  overhang: { areaCm2: number; percent: number };
  bedContactAreaCm2: number;
  fits?: { fits: boolean; fitsRotated: boolean; buildVolume: { x: number; y: number; z: number } };
  score: number;
  issues: Issue[];
}

export interface Estimate {
  grams: number;
  filamentMeters: number;
  supportGrams: number;
  printSeconds: number;
  layers: number;
  materialId: string;
  printerId: string;
  accuracy: string;
}

export interface Model {
  id: string;
  name: string;
  kind: "scad" | "mesh";
  origin: string;
  description?: string;
  parameters?: ScadParameter[];
  values?: Record<string, ScadParameter["value"]>;
  analysis?: Analysis;
  files: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  source?: string;
  estimate?: Estimate;
}

export interface ModelSummary {
  id: string;
  name: string;
  kind: "scad" | "mesh";
  origin: string;
  updatedAt: string;
  version: number;
  size?: [number, number, number];
  score?: number;
}

export interface Temp {
  actual: number;
  target?: number;
}

export interface PrinterStatus {
  online: boolean;
  state: string;
  progress?: number;
  fileName?: string;
  timeLeftSec?: number;
  temps?: { nozzle?: Temp; bed?: Temp; chamber?: Temp };
  message?: string;
  monitor?: MonitorState | null;
}

export interface CameraCheck {
  at: string;
  verdict: "ok" | "warning" | "failure" | "unknown";
  confidence: number;
  issues: string[];
  explanation: string;
  detector: string;
  costUsd?: number;
}

export interface MonitorState {
  running: boolean;
  options: { intervalSec: number; autoPause: boolean };
  history: CameraCheck[];
  pausedByMonitor: boolean;
}

export type PrinterKind = "octoprint" | "moonraker" | "prusalink" | "bambu" | "mock";

export interface Printer {
  id: string;
  name: string;
  kind: PrinterKind;
  url?: string;
  host?: string;
  serial?: string;
  model?: string;
  username?: string;
  storage?: string;
  cameraUrl?: string;
  profileId?: string;
  hasSecrets?: Record<string, boolean>;
  apiKey?: string;
  password?: string;
  accessCode?: string;
}

export interface Material {
  id: string;
  name: string;
  density: number;
  pricePerKg: number;
  nozzleC: [number, number];
  bedC: [number, number];
  difficulty: number;
  kidFriendly: boolean;
  notes: string;
}

export interface PrinterProfile {
  id: string;
  name: string;
  buildVolume: { x: number; y: number; z: number };
  connector: string;
}

export interface Preset {
  id: string;
  label: string;
  provider: string;
  model: string;
  description: string;
}

export interface Settings {
  language: "es" | "en";
  kidMode: boolean;
  provider: "anthropic" | "ollama" | "openai-compatible";
  model: string;
  effort: string;
  ollamaUrl: string;
  openaiBaseUrl?: string;
  customPriceInput: number;
  customPriceOutput: number;
  webSearch: boolean;
  cameraDetector: "vision" | "obico";
  visionProvider: string;
  visionModel: string;
  obicoUrl?: string;
  hunyuanUrl?: string;
  currency: string;
  defaultMaterial: string;
  defaultPrinterProfile: string;
  filamentPricePerKg?: number;
  electricityPerKwh: number;
  laborPerHour: number;
  marginPercent: number;
  platformFeePercent: number;
  monthlyBudgetUsd: number;
  secrets: Record<string, string | undefined>;
}

export interface SettingsResponse {
  settings: Settings;
  ready: { ready: boolean; reason?: string };
  presets: Preset[];
  materials: Material[];
  printerProfiles: PrinterProfile[];
  gen3dProviders: { id: string; name: string; costUsd: number; requires: string; notes: string }[];
  slicer: boolean;
  version: string;
}

export interface Usage {
  totalUsd: number;
  last30dUsd: number;
  byKind: Record<string, number>;
  entries: { at: string; kind: string; provider: string; model?: string; costUsd: number; note?: string }[];
}

export interface CostBreakdown {
  currency: string;
  material: number;
  electricity: number;
  depreciation: number;
  maintenance: number;
  labor: number;
  failureBuffer: number;
  packaging: number;
  totalCost: number;
  breakEvenPrice: number;
  suggestedPrice: number;
  profit: number;
  tiers: { name: string; marginPercent: number; price: number }[];
  explanation: string[];
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentPart[];
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  costUsd: number;
  messages?: ChatMessage[];
}

export type AgentEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; isError: boolean; result: string }
  | { type: "model"; model: Model }
  | { type: "usage"; costUsd: number; totalCostUsd: number; model: string }
  | { type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { type: "done"; stopReason: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

function token(): string | null {
  try {
    return localStorage.getItem("forja.token");
  } catch {
    return null;
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const t = token();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    headers: headers(body === undefined || isForm ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status, data.code);
  return data as T;
}

export const api = {
  settings: () => request<SettingsResponse>("GET", "/settings"),
  saveSettings: (patch: Record<string, unknown>) => request<{ settings: Settings; ready: SettingsResponse["ready"] }>("PUT", "/settings", patch),
  usage: () => request<Usage>("GET", "/usage"),
  models: () => request<ModelSummary[]>("GET", "/models"),
  model: (id: string) => request<Model>("GET", `/models/${id}`),
  createModel: (name: string, scad_code: string) => request<{ model: Model; estimate: Estimate }>("POST", "/models", { name, scad_code }),
  updateModel: (id: string, patch: { values?: Record<string, unknown>; scad_code?: string; name?: string }) =>
    request<{ model: Model; estimate: Estimate }>("PATCH", `/models/${id}`, patch),
  deleteModel: (id: string) => request("DELETE", `/models/${id}`),
  rescale: (id: string, targetSizeMm: number) => request<{ model: Model; estimate: Estimate }>("POST", `/models/${id}/rescale`, { targetSizeMm }),
  importModel: (file: File, targetSizeMm?: number) => {
    const f = new FormData();
    f.append("file", file);
    if (targetSizeMm) f.append("targetSizeMm", String(targetSizeMm));
    return request<{ model: Model; estimate: Estimate }>("POST", "/models/import", f);
  },
  uploadSliced: (id: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return request<{ model: Model; info?: { printSeconds?: number; filamentGrams?: number } }>("POST", `/models/${id}/sliced`, f);
  },
  estimate: (id: string, body: { printerProfile?: string; material?: string; infillPercent?: number; layerHeightMm?: number }) =>
    request<{ analysis: Analysis; estimate: Estimate }>("POST", `/models/${id}/estimate`, body),
  price: (body: Record<string, unknown>) => request<CostBreakdown>("POST", "/price", body),
  generate3d: (body: { provider?: string; prompt?: string; image?: string; name?: string; targetSizeMm?: number }) =>
    request<{ model: Model; costUsd: number }>("POST", "/generate3d", body),
  search: (q: string) => request<{ results: { title: string; url: string; source: string; thumbnail?: string }[]; links: { source: string; url: string; note: string }[] }>("GET", `/search?q=${encodeURIComponent(q)}`),
  printers: () => request<Printer[]>("GET", "/printers"),
  savePrinter: (p: Partial<Printer>) => request<Printer>("POST", "/printers", p),
  testPrinter: (p: Partial<Printer>) => request<{ ok: boolean; status?: PrinterStatus; error?: string }>("POST", "/printers/test", p),
  deletePrinter: (id: string) => request("DELETE", `/printers/${id}`),
  printerStatus: (id: string) => request<PrinterStatus>("GET", `/printers/${id}/status`),
  printerAction: (id: string, action: "pause" | "resume" | "cancel") => request("POST", `/printers/${id}/${action}`),
  sendToPrinter: (id: string, modelId: string, start: boolean) => request<{ uploaded: string; started: boolean }>("POST", `/printers/${id}/send`, { modelId, start }),
  checkCamera: (id: string) => request<CameraCheck>("POST", `/printers/${id}/check`),
  setMonitor: (id: string, body: { enabled: boolean; intervalSec?: number; autoPause?: boolean }) => request<MonitorState>("POST", `/printers/${id}/monitor`, body),
  conversations: () => request<Conversation[]>("GET", "/conversations"),
  conversation: (id: string) => request<Conversation>("GET", `/conversations/${id}`),
};

export function fileUrl(modelId: string, name: string, version?: number, download = false): string {
  const q = new URLSearchParams();
  if (version) q.set("v", String(version));
  if (download) q.set("download", "1");
  const t = token();
  if (t) q.set("token", t);
  return `/api/models/${modelId}/files/${name}?${q}`;
}

export function snapshotUrl(printerId: string, nonce: number): string {
  const t = token();
  return `/api/printers/${printerId}/snapshot?n=${nonce}${t ? `&token=${encodeURIComponent(t)}` : ""}`;
}

/** Envía un mensaje al agente y recibe los eventos en vivo (SSE sobre fetch POST). */
export async function streamChat(
  body: { conversationId?: string; message: string; images?: { mime: string; data: string }[]; selectedModelId?: string },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status, data.code);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      const ev = /^event:\s*(.+)$/m.exec(block)?.[1];
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        onEvent(ev === "conversation" ? { type: "conversation", ...parsed } : parsed);
      } catch {
        /* bloque incompleto */
      }
    }
  }
}
