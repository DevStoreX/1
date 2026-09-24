/**
 * Lee los parámetros "Customizer" de un archivo OpenSCAD, el mismo formato que usan
 * OpenSCAD y Thingiverse:
 *
 *   // Ancho de la pieza
 *   ancho = 40; // [10:1:120]
 *   forma = "redonda"; // [redonda, cuadrada]
 *   con_logo = true;
 *   /* [Hidden] *\/
 */
export type ParamValue = number | string | boolean | number[];

export interface ScadParameter {
  name: string;
  type: "number" | "string" | "boolean" | "vector";
  value: ParamValue;
  description?: string;
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
}

const ASSIGN_RE = /^\s*([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;\s*(?:\/\/\s*(.*))?$/;
const GROUP_RE = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/;

function parseLiteral(raw: string): { type: ScadParameter["type"]; value: ParamValue } | null {
  const s = raw.trim();
  if (s === "true" || s === "false") return { type: "boolean", value: s === "true" };
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return { type: "number", value: Number(s) };
  const str = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  if (str) return { type: "string", value: str[1].replace(/\\(.)/g, "$1") };
  const vec = /^\[\s*([-+\d.eE\s,]*)\]$/.exec(s);
  if (vec) {
    const parts = vec[1].split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.every((x) => !Number.isNaN(Number(x)))) return { type: "vector", value: parts.map(Number) };
  }
  return null; // expresión: no es un parámetro editable
}

function applyHint(param: ScadParameter, hint: string): void {
  const h = hint.trim();
  const bracket = /^\[(.*)\]$/.exec(h);
  if (!bracket) {
    if (h && !param.description) param.description = h;
    return;
  }
  const body = bracket[1].trim();
  if (param.type === "number" && /^[-+\d.eE\s:]+$/.test(body)) {
    const nums = body.split(":").map((x) => Number(x.trim()));
    if (nums.length === 1) { param.min = 0; param.max = nums[0]; }
    else if (nums.length === 2) { param.min = nums[0]; param.max = nums[1]; }
    else if (nums.length === 3) { param.min = nums[0]; param.step = nums[1]; param.max = nums[2]; }
    return;
  }
  const opts = body.split(",").map((x) => x.trim()).filter(Boolean);
  if (opts.length) {
    param.options = opts.map((o) => {
      const [v, ...label] = o.split(":");
      const val = v.trim().replace(/^"|"$/g, "");
      const value = param.type === "number" && !Number.isNaN(Number(val)) ? Number(val) : val;
      return { value, label: (label.join(":") || val).trim() };
    });
  }
}

export function parseScadParameters(source: string): ScadParameter[] {
  const params: ScadParameter[] = [];
  const lines = source.split(/\r?\n/);
  let group: string | undefined;
  let pendingComment: string | undefined;
  let depth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const g = GROUP_RE.exec(trimmed);
    if (g) {
      group = g[1].trim();
      pendingComment = undefined;
      continue;
    }
    if (group?.toLowerCase() === "hidden") {
      if (/^(module|function)\b/.test(trimmed)) break;
      continue;
    }
    if (depth === 0 && /^(module|function)\b/.test(trimmed)) break;
    if (depth === 0) {
      const m = ASSIGN_RE.exec(line);
      if (m) {
        const lit = parseLiteral(m[2]);
        if (lit) {
          const param: ScadParameter = { name: m[1], type: lit.type, value: lit.value, group };
          if (pendingComment) param.description = pendingComment;
          if (m[3]) applyHint(param, m[3]);
          // Una reasignación posterior reemplaza a la anterior (así lo hace OpenSCAD)
          const existing = params.findIndex((p) => p.name === param.name);
          if (existing >= 0) params.splice(existing, 1);
          params.push(param);
        }
        pendingComment = undefined;
      } else if (trimmed.startsWith("//")) {
        pendingComment = trimmed.replace(/^\/\/+\s*/, "") || undefined;
      } else if (trimmed) {
        pendingComment = undefined;
      }
    }
    for (const ch of line.replace(/\/\/.*$/, "")) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  return params;
}

/** Convierte un valor a literal OpenSCAD para pasarlo con `-D nombre=valor`. */
export function toScadLiteral(value: ParamValue): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Valor numérico no válido");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => toScadLiteral(v)).join(",")}]`;
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Valida y normaliza los valores recibidos contra los parámetros declarados. */
export function coerceParams(
  declared: ScadParameter[],
  values: Record<string, unknown>,
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [name, raw] of Object.entries(values)) {
    const p = declared.find((d) => d.name === name);
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`Nombre de parámetro no válido: ${name}`);
    const type = p?.type ?? (typeof raw === "number" ? "number" : typeof raw === "boolean" ? "boolean" : Array.isArray(raw) ? "vector" : "string");
    let v: ParamValue;
    switch (type) {
      case "number": {
        const n = Number(raw);
        if (Number.isNaN(n)) throw new Error(`${name} debe ser un número`);
        v = n;
        break;
      }
      case "boolean":
        v = raw === true || raw === "true" || raw === 1;
        break;
      case "vector":
        if (!Array.isArray(raw)) throw new Error(`${name} debe ser una lista de números`);
        v = raw.map(Number);
        break;
      default:
        v = String(raw);
    }
    out[name] = v;
  }
  return out;
}
