import type { CameraMonitor, ModelRecord, PrinterManager, Store, UsageEntry, VisionFn } from "@forja3d/core";
import type { z } from "zod";
import type { ModelService } from "../models.ts";
import type { ImagePart } from "../providers/types.ts";
import type { ForjaSettings } from "../settings.ts";

export interface ToolContext {
  store: Store;
  models: ModelService;
  printers: PrinterManager;
  monitor: CameraMonitor;
  settings: ForjaSettings;
  vision?: VisionFn;
  /** URL pública del servidor (para que Obico descargue capturas) */
  publicUrl?: string;
  /** Imágenes adjuntadas por la persona en esta conversación (la más reciente primero) */
  attachments: ImagePart[];
  onModel?: (model: ModelRecord) => void;
  recordUsage?: (entry: Omit<UsageEntry, "at">) => Promise<void>;
  conversationId?: string;
}

export interface ToolOutput {
  content: string;
  images?: ImagePart[];
  isError?: boolean;
}

export interface ForjaTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>;
}

export function ok(data: unknown, images?: ImagePart[]): ToolOutput {
  return { content: typeof data === "string" ? data : JSON.stringify(data), images };
}

export function fail(message: string): ToolOutput {
  return { content: message, isError: true };
}
