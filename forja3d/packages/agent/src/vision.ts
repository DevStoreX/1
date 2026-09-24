import { ObicoDetector, VisionLLMDetector, type FailureDetector, type Snapshot, type VisionFn } from "@forja3d/core";
import { createProvider } from "./providers/index.ts";
import { textOf } from "./providers/types.ts";
import type { ForjaSettings } from "./settings.ts";

export function createVisionFn(settings: ForjaSettings, onCost?: (costUsd: number, model: string) => void): VisionFn {
  return async (image: Snapshot, prompt: string) => {
    const provider = createProvider(settings, { provider: settings.visionProvider, model: settings.visionModel });
    const res = await provider.chat({
      system: "Analizas imágenes de impresoras 3D. Respondes solo con el JSON pedido.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", mime: image.mime, data: Buffer.from(image.data).toString("base64") },
            { type: "text", text: prompt },
          ],
        },
      ],
      tools: [],
      maxTokens: 1024,
    });
    onCost?.(res.costUsd, res.model);
    return { text: textOf(res.message), costUsd: res.costUsd };
  };
}

export function createDetector(settings: ForjaSettings, vision: VisionFn): FailureDetector {
  if (settings.cameraDetector === "obico" && settings.obicoUrl) return new ObicoDetector(settings.obicoUrl, fetch, process.env.OBICO_ML_TOKEN);
  return new VisionLLMDetector(vision);
}
