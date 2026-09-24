import { createHash, randomBytes } from "node:crypto";
import { PrinterError } from "./types.ts";

export type FetchLike = typeof fetch;

export interface HttpOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  /** Credenciales para HTTP Digest (PrusaLink) */
  digest?: { username: string; password: string };
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function digestHeader(www: string, method: string, uri: string, user: string, pass: string): string {
  const params: Record<string, string> = {};
  for (const m of www.replace(/^Digest\s+/i, "").matchAll(/(\w+)=("([^"]*)"|[^,]*)/g)) {
    params[m[1]] = m[3] ?? m[2];
  }
  const realm = params.realm ?? "";
  const nonce = params.nonce ?? "";
  const qop = params.qop?.split(",").map((s) => s.trim()).includes("auth") ? "auth" : undefined;
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (params.opaque) h += `, opaque="${params.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (params.algorithm) h += `, algorithm=${params.algorithm}`;
  return h;
}

export class HttpClient {
  constructor(private opts: HttpOptions) {}

  url(path: string): string {
    return this.opts.baseUrl.replace(/\/+$/, "") + path;
  }

  async request(method: string, path: string, init: { body?: RequestInit["body"]; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<Response> {
    const f = this.opts.fetchImpl ?? fetch;
    const url = this.url(path);
    const doFetch = (extra: Record<string, string> = {}) =>
      f(url, {
        method,
        body: init.body,
        headers: { ...this.opts.headers, ...init.headers, ...extra },
        signal: AbortSignal.timeout(init.timeoutMs ?? this.opts.timeoutMs ?? 15_000),
      });
    let res: Response;
    try {
      res = await doFetch();
      if (res.status === 401 && this.opts.digest) {
        const www = res.headers.get("www-authenticate") ?? "";
        if (/^Digest/i.test(www)) {
          const uri = new URL(url).pathname + new URL(url).search;
          res = await doFetch({ Authorization: digestHeader(www, method, uri, this.opts.digest.username, this.opts.digest.password) });
        }
      }
    } catch (e) {
      throw new PrinterError(`No se pudo conectar con ${url}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PrinterError(`${method} ${path} → HTTP ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    return res;
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.request(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
    });
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Extrae el primer JPEG de una respuesta (JPEG simple o flujo MJPEG). */
export async function readFirstJpeg(res: Response, maxBytes = 8 * 1024 * 1024): Promise<Uint8Array> {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("multipart") || !res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  let buf = new Uint8Array(0);
  try {
    while (buf.length < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf);
      merged.set(value, buf.length);
      buf = merged;
      const start = indexOf(buf, [0xff, 0xd8]);
      if (start >= 0) {
        const end = indexOf(buf, [0xff, 0xd9], start + 2);
        if (end >= 0) return buf.slice(start, end + 2);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error("No se encontró una imagen JPEG en el flujo de la cámara");
}

function indexOf(buf: Uint8Array, pat: number[], from = 0): number {
  outer: for (let i = from; i <= buf.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

export async function fetchCameraUrl(url: string, fetchImpl: FetchLike = fetch): Promise<{ data: Uint8Array; mime: string }> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Cámara respondió HTTP ${res.status}`);
  const data = await readFirstJpeg(res);
  const type = res.headers.get("content-type") ?? "";
  const mime = type.startsWith("image/") ? type.split(";")[0] : "image/jpeg";
  return { data, mime };
}
