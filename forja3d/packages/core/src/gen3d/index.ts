/**
 * Generación de mallas "orgánicas" (figuras, personajes, esculturas) a partir de una
 * imagen o un texto, al estilo Meshy, pero con proveedores intercambiables y a precio
 * de costo. Para piezas funcionales es mejor el CAD paramétrico (OpenSCAD).
 */
export type Gen3DProviderId = "fal-trellis" | "fal-hunyuan3d" | "hunyuan3d-local";

export interface Gen3DProviderInfo {
  id: Gen3DProviderId;
  name: string;
  /** Costo aproximado por generación en USD (solo lo que cobra el proveedor, sin margen) */
  costUsd: number;
  requires: string;
  notes: string;
}

export const GEN3D_PROVIDERS: Gen3DProviderInfo[] = [
  { id: "fal-trellis", name: "TRELLIS (Microsoft, abierto) vía fal.ai", costUsd: 0.02, requires: "FAL_KEY", notes: "El más barato; buena geometría para figuras." },
  { id: "fal-hunyuan3d", name: "Hunyuan3D 2 (Tencent, abierto) vía fal.ai", costUsd: 0.16, requires: "FAL_KEY", notes: "Muy buena calidad de forma; sin textura (no hace falta para imprimir)." },
  { id: "hunyuan3d-local", name: "Hunyuan3D 2 en tu propia GPU", costUsd: 0, requires: "HUNYUAN3D_URL", notes: "Gratis si tienes una GPU (≥ 8 GB VRAM) con el api_server de Hunyuan3D-2." },
];

/** Costo de generar una imagen a partir de texto (FLUX schnell en fal.ai) */
export const TEXT_TO_IMAGE_COST_USD = 0.003;

export interface Gen3DRequest {
  provider: Gen3DProviderId;
  /** data:image/png;base64,... o URL pública */
  image?: string;
  /** Si no hay imagen, se genera una a partir del texto */
  prompt?: string;
}

export interface Gen3DResult {
  glb: Uint8Array;
  provider: Gen3DProviderId;
  costUsd: number;
  seconds: number;
  /** Imagen usada (útil cuando se generó desde texto) */
  imageUrl?: string;
}

export interface Gen3DEnv {
  falKey?: string;
  hunyuanUrl?: string;
  fetchImpl?: typeof fetch;
  /** Para pruebas: intervalo entre consultas de estado */
  pollMs?: number;
  timeoutMs?: number;
}

interface FalQueued {
  request_id: string;
  status_url?: string;
  response_url?: string;
}

async function falRun<T>(model: string, input: unknown, env: Gen3DEnv): Promise<T> {
  const f = env.fetchImpl ?? fetch;
  if (!env.falKey) throw new Error("Falta FAL_KEY para usar fal.ai (créala en https://fal.ai/dashboard/keys)");
  const headers = { Authorization: `Key ${env.falKey}`, "Content-Type": "application/json" };
  const submit = await f(`https://queue.fal.run/${model}`, { method: "POST", headers, body: JSON.stringify(input) });
  if (!submit.ok) throw new Error(`fal.ai (${model}) respondió HTTP ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const q = (await submit.json()) as FalQueued;
  const statusUrl = q.status_url ?? `https://queue.fal.run/${model}/requests/${q.request_id}/status`;
  const responseUrl = q.response_url ?? `https://queue.fal.run/${model}/requests/${q.request_id}`;
  const deadline = Date.now() + (env.timeoutMs ?? 300_000);
  while (Date.now() < deadline) {
    const st = await f(statusUrl, { headers });
    if (!st.ok) throw new Error(`fal.ai estado HTTP ${st.status}`);
    const body = (await st.json()) as { status: string };
    if (body.status === "COMPLETED") break;
    if (body.status !== "IN_QUEUE" && body.status !== "IN_PROGRESS") throw new Error(`fal.ai estado inesperado: ${body.status}`);
    await new Promise((r) => setTimeout(r, env.pollMs ?? 2000));
  }
  const res = await f(responseUrl, { headers });
  if (!res.ok) throw new Error(`fal.ai resultado HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

async function download(url: string, env: Gen3DEnv): Promise<Uint8Array> {
  const res = await (env.fetchImpl ?? fetch)(url);
  if (!res.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function buildImagePrompt(prompt: string): string {
  return `${prompt}. Single object, full body, centered, 3/4 view, plain white background, soft studio lighting, clean silhouette, suitable for 3D printing, no text`;
}

async function textToImage(prompt: string, env: Gen3DEnv): Promise<string> {
  const out = await falRun<{ images?: { url: string }[] }>("fal-ai/flux/schnell", { prompt: buildImagePrompt(prompt), image_size: "square_hd", num_images: 1 }, env);
  const url = out.images?.[0]?.url;
  if (!url) throw new Error("fal.ai no devolvió imagen");
  return url;
}

export async function generate3D(req: Gen3DRequest, env: Gen3DEnv): Promise<Gen3DResult> {
  const t0 = Date.now();
  let cost = 0;
  let image = req.image;
  if (!image) {
    if (!req.prompt) throw new Error("Necesito una imagen o una descripción");
    if (req.provider === "hunyuan3d-local") throw new Error("Hunyuan3D local necesita una imagen (o configura FAL_KEY para generar una desde texto)");
    image = await textToImage(req.prompt, env);
    cost += TEXT_TO_IMAGE_COST_USD;
  }

  if (req.provider === "fal-trellis") {
    const out = await falRun<{ model_mesh?: { url: string } }>("fal-ai/trellis", { image_url: image, texture_size: 512, mesh_simplify: 0.95 }, env);
    if (!out.model_mesh?.url) throw new Error("TRELLIS no devolvió malla");
    cost += 0.02;
    return { glb: await download(out.model_mesh.url, env), provider: req.provider, costUsd: cost, seconds: (Date.now() - t0) / 1000, imageUrl: image.startsWith("http") ? image : undefined };
  }
  if (req.provider === "fal-hunyuan3d") {
    const out = await falRun<{ model_mesh?: { url: string } }>("fal-ai/hunyuan3d/v2", { input_image_url: image, textured_mesh: false, num_inference_steps: 50, octree_resolution: 256 }, env);
    if (!out.model_mesh?.url) throw new Error("Hunyuan3D no devolvió malla");
    cost += 0.16;
    return { glb: await download(out.model_mesh.url, env), provider: req.provider, costUsd: cost, seconds: (Date.now() - t0) / 1000, imageUrl: image.startsWith("http") ? image : undefined };
  }
  if (req.provider === "hunyuan3d-local") {
    if (!env.hunyuanUrl) throw new Error("Configura HUNYUAN3D_URL con la dirección de tu api_server de Hunyuan3D-2");
    let b64: string;
    if (image.startsWith("data:")) b64 = image.split(",")[1];
    else b64 = Buffer.from(await download(image, env)).toString("base64");
    const res = await (env.fetchImpl ?? fetch)(`${env.hunyuanUrl.replace(/\/+$/, "")}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: b64, texture: false, type: "glb", octree_resolution: 256, num_inference_steps: 30, guidance_scale: 5.0 }),
      signal: AbortSignal.timeout(env.timeoutMs ?? 600_000),
    });
    if (!res.ok) throw new Error(`Hunyuan3D local respondió HTTP ${res.status}`);
    return { glb: new Uint8Array(await res.arrayBuffer()), provider: req.provider, costUsd: cost, seconds: (Date.now() - t0) / 1000 };
  }
  throw new Error(`Proveedor desconocido: ${req.provider}`);
}
