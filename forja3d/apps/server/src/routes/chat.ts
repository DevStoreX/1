import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { newId } from "@forja3d/core";
import { ALL_TOOLS, buildContextNote, createProvider, providerReady, runAgent, type ChatMessage, type ImagePart } from "@forja3d/agent";
import type { Runtime } from "../runtime.ts";

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  costUsd: number;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const running = new Set<string>();

export function chatRoutes(rt: Runtime) {
  const app = new Hono();

  app.get("/conversations", async (c) => {
    const list = await rt.store.listConversations<Conversation>();
    return c.json(list.map(({ id, title, updatedAt, costUsd }) => ({ id, title, updatedAt, costUsd })));
  });

  app.get("/conversations/:id", async (c) => {
    const conv = await rt.store.getConversation<Conversation>(c.req.param("id"));
    return conv ? c.json(conv) : c.json({ error: "No encontrada" }, 404);
  });

  app.post("/chat", async (c) => {
    const body = await c.req.json<{ conversationId?: string; message?: string; images?: ImagePart[]; selectedModelId?: string }>();
    const text = (body.message ?? "").trim();
    const images = (body.images ?? []).filter((i) => i && typeof i.data === "string" && /^image\/(png|jpeg|webp|gif)$/.test(i.mime));
    if (!text && images.length === 0) return c.json({ error: "Mensaje vacío" }, 400);
    if (images.some((i) => i.data.length * 0.75 > MAX_IMAGE_BYTES)) return c.json({ error: "Imagen demasiado grande (máx. 5 MB)" }, 413);

    const settings = await rt.settings();
    const ready = providerReady(settings);
    if (!ready.ready) return c.json({ error: ready.reason, code: "provider_not_ready" }, 400);

    const id = body.conversationId && /^[\w-]+$/.test(body.conversationId) ? body.conversationId : newId();
    if (running.has(id)) return c.json({ error: "Esta conversación ya está respondiendo" }, 409);
    const existing = await rt.store.getConversation<Conversation>(id);
    const now = new Date().toISOString();
    const conv: Conversation = existing ?? { id, title: (text || "Imagen").slice(0, 60), createdAt: now, updatedAt: now, messages: [], costUsd: 0 };

    const selected = body.selectedModelId ? await rt.store.getModel(body.selectedModelId) : null;
    const printers = (await rt.store.listPrinters()).map((p) => ({ id: p.id, name: p.name, kind: p.kind, profileId: p.profileId }));
    const note = buildContextNote({ settings, selectedModel: selected && { id: selected.id, name: selected.name, version: selected.version }, printers });
    const user: ChatMessage = {
      role: "user",
      content: [{ type: "text", text: note }, ...images.map((i) => ({ type: "image" as const, mime: i.mime, data: i.data })), ...(text ? [{ type: "text" as const, text }] : [])],
    };
    // Imágenes adjuntadas en toda la conversación, la más reciente primero
    const attachments: ImagePart[] = [...conv.messages, user]
      .filter((m) => m.role === "user")
      .flatMap((m) => m.content.filter((p): p is ImagePart => p.type === "image"))
      .reverse();

    return streamSSE(c, async (stream) => {
      running.add(id);
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      await stream.writeSSE({ event: "conversation", data: JSON.stringify({ id, title: conv.title }) });
      try {
        const provider = createProvider(settings);
        const ctx = await rt.toolContext({ conversationId: id, attachments });
        const result = await runAgent({
          provider,
          history: conv.messages,
          user,
          tools: ALL_TOOLS,
          ctx,
          webSearch: settings.webSearch,
          signal: controller.signal,
          emit: (e) => {
            void stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
          },
        });
        conv.messages.push(...result.messages);
        conv.costUsd += result.costUsd;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await stream.writeSSE({ event: "notice", data: JSON.stringify({ type: "notice", level: "error", message: `Error del proveedor de IA: ${message}` }) });
        await stream.writeSSE({ event: "done", data: JSON.stringify({ type: "done", stopReason: "error" }) });
        // Guardamos el mensaje de la persona para no perderlo
        if (!conv.messages.includes(user)) conv.messages.push(user, { role: "assistant", content: [{ type: "text", text: `⚠️ ${message}` }] });
      } finally {
        conv.updatedAt = new Date().toISOString();
        await rt.store.saveConversation(id, conv);
        running.delete(id);
      }
    });
  });

  return app;
}
