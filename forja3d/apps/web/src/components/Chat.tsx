import { useEffect, useRef, useState } from "react";
import { api, ApiError, streamChat, type AgentEvent, type ChatMessage, type Conversation, type Model } from "../api.ts";
import { fileToImage, useApp, usd } from "../context.tsx";
import { useT, type Key } from "../i18n.ts";
import { Markdown } from "./Markdown.tsx";
import { Setup } from "./Setup.tsx";
import * as I from "./Icons.tsx";

type Block =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; status: "running" | "ok" | "error" }
  | { kind: "notice"; level: string; message: string };

type Item =
  | { role: "user"; text: string; images: string[] }
  | { role: "assistant"; blocks: Block[]; costUsd?: number; streaming?: boolean };

const CONTEXT_PREFIX = "[Contexto de la app";

/** Convierte la conversación guardada en elementos para mostrar. */
function toItems(messages: ChatMessage[]): Item[] {
  const items: Item[] = [];
  const results = new Map<string, boolean>();
  for (const m of messages) for (const p of m.content) if (p.type === "tool_result") results.set(p.toolCallId, !!p.isError);
  for (const m of messages) {
    if (m.role === "user") {
      if (m.content.every((p) => p.type === "tool_result")) continue;
      const text = m.content.filter((p) => p.type === "text" && !p.text.startsWith(CONTEXT_PREFIX) && !p.text.startsWith("[Forja]")).map((p) => (p as { text: string }).text).join("\n");
      const images = m.content.filter((p) => p.type === "image").map((p) => `data:${(p as { mime: string }).mime};base64,${(p as { data: string }).data}`);
      if (!text && !images.length) continue;
      items.push({ role: "user", text, images });
    } else {
      const last = items[items.length - 1];
      const target = last?.role === "assistant" ? last : ({ role: "assistant", blocks: [] } as Item & { role: "assistant" });
      if (target !== last) items.push(target);
      for (const p of m.content) {
        if (p.type === "text" && p.text) target.blocks.push({ kind: "text", text: p.text });
        if (p.type === "tool_call") target.blocks.push({ kind: "tool", id: p.id, name: p.name, status: results.get(p.id) ? "error" : "ok" });
      }
    }
  }
  return items;
}

interface Props {
  selectedModelId?: string;
  onModel: (m: Model) => void;
}

export function Chat({ selectedModelId, onModel }: Props) {
  const t = useT();
  const { config, reloadUsage, toast } = useApp();
  const kid = config?.settings.kidMode;
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<{ mime: string; data: string; preview: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<string | undefined>(() => localStorage.getItem("forja.conv") ?? undefined);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadHistory = () => api.conversations().then(setHistory).catch(() => {});

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!convId) {
      setItems([]);
      return;
    }
    localStorage.setItem("forja.conv", convId);
    if (busy) return;
    api.conversation(convId).then((c) => setItems(toItems(c.messages ?? []))).catch(() => {
      setConvId(undefined);
      localStorage.removeItem("forja.conv");
    });
  }, [convId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  useEffect(() => {
    setNeedsSetup(!!config && !config.ready.ready);
  }, [config?.ready.ready]);

  const update = (fn: (a: Item & { role: "assistant" }) => void) =>
    setItems((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role !== "assistant") return prev;
      const copy = { ...last, blocks: [...last.blocks] };
      fn(copy);
      next[next.length - 1] = copy;
      return next;
    });

  const onEvent = (e: AgentEvent) => {
    switch (e.type) {
      case "conversation":
        setConvId(e.id);
        break;
      case "text":
        update((a) => {
          const lastBlock = a.blocks[a.blocks.length - 1];
          if (lastBlock?.kind === "text") a.blocks[a.blocks.length - 1] = { kind: "text", text: lastBlock.text + e.delta };
          else a.blocks.push({ kind: "text", text: e.delta });
        });
        break;
      case "tool_start":
        update((a) => a.blocks.push({ kind: "tool", id: e.id, name: e.name, status: "running" }));
        break;
      case "tool_end":
        update((a) => {
          a.blocks = a.blocks.map((b) => (b.kind === "tool" && b.id === e.id ? { ...b, status: e.isError ? "error" : "ok" } : b));
        });
        break;
      case "model":
        onModel(e.model);
        break;
      case "usage":
        update((a) => (a.costUsd = e.totalCostUsd));
        break;
      case "notice":
        update((a) => a.blocks.push({ kind: "notice", level: e.level, message: e.message }));
        break;
      case "done":
        update((a) => (a.streaming = false));
        break;
    }
  };

  const send = async (text = input) => {
    const message = text.trim();
    if ((!message && !images.length) || busy) return;
    setItems((prev) => [...prev, { role: "user", text: message, images: images.map((i) => i.preview) }, { role: "assistant", blocks: [], streaming: true }]);
    setInput("");
    const ta = document.querySelector<HTMLTextAreaElement>(".composer textarea");
    if (ta) ta.style.height = "";
    const imgs = images.map(({ mime, data }) => ({ mime, data }));
    setImages([]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      await streamChat({ conversationId: convId, message, images: imgs, selectedModelId }, onEvent, abort.current.signal);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        update((a) => a.blocks.push({ kind: "notice", level: "info", message: "⏹" }));
      } else if (err instanceof ApiError && err.code === "provider_not_ready") {
        setItems((prev) => prev.slice(0, -2));
        setInput(message);
        setNeedsSetup(true);
      } else {
        update((a) => a.blocks.push({ kind: "notice", level: "error", message: (err as Error).message }));
      }
    } finally {
      update((a) => (a.streaming = false));
      setBusy(false);
      abort.current = null;
      void reloadUsage();
      void loadHistory();
    }
  };

  const attach = async (files: FileList | null) => {
    if (!files) return;
    try {
      const imgs = await Promise.all([...files].slice(0, 4).map((f) => fileToImage(f)));
      setImages((prev) => [...prev, ...imgs].slice(0, 4));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const suggestions: Key[] = kid ? ["chat.suggestKid1", "chat.suggestKid2", "chat.suggestKid3"] : ["chat.suggest1", "chat.suggest2", "chat.suggest3", "chat.suggest4"];

  return (
    <section className="chat" aria-label="Chat">
      <div className="chat-head">
        <select className="input" value={convId ?? ""} onChange={(e) => setConvId(e.target.value || undefined)} aria-label={t("chat.history")}>
          <option value="">{t("chat.new")}</option>
          {history.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
        <button className="btn btn-icon" title={t("chat.new")} onClick={() => { setConvId(undefined); localStorage.removeItem("forja.conv"); }} disabled={busy}>
          <I.Plus />
        </button>
      </div>

      <div className="messages" ref={scroller}>
        {needsSetup && <Setup onDone={() => setNeedsSetup(false)} />}
        {!needsSetup && items.length === 0 && (
          <div className="welcome">
            <h2>{t("chat.welcomeTitle")}</h2>
            <p className="muted">{kid ? t("chat.welcomeKid") : t("chat.welcome")}</p>
            <div className="suggestions">
              {suggestions.map((k) => (
                <button key={k} className="suggestion" onClick={() => void send(t(k))}>{t(k)}</button>
              ))}
            </div>
          </div>
        )}
        {items.map((it, i) =>
          it.role === "user" ? (
            <div key={i} className="msg msg-user">
              {it.images.map((src, j) => <img key={j} src={src} alt="" />)}
              {it.text}
            </div>
          ) : (
            <div key={i} className="msg msg-assistant">
              {it.blocks.length === 0 && it.streaming && (
                <span className="tool-chip"><span className="spinner" /> {t("chat.thinking")}</span>
              )}
              {groupBlocks(it.blocks).map((g, j) =>
                g.kind === "tools" ? (
                  <div key={j} className="tool-list">
                    {g.tools.map((b) => (
                      <span key={b.id} className={`tool-chip ${b.status === "ok" ? "ok" : b.status === "error" ? "err" : ""}`}>
                        {b.status === "running" ? <span className="spinner" /> : b.status === "ok" ? <I.Check width={14} height={14} /> : <I.Alert width={14} height={14} />}
                        {toolLabel(t, b.name)}
                      </span>
                    ))}
                  </div>
                ) : g.kind === "text" ? (
                  <Markdown key={j} text={g.text} />
                ) : (
                  <div key={j} className={`notice ${g.level === "error" ? "error" : ""}`}>{g.message}</div>
                ),
              )}
              {!!it.costUsd && !it.streaming && <div className="msg-cost">{t("chat.cost")}: {usd(it.costUsd)}</div>}
            </div>
          ),
        )}
      </div>

      <div className="composer">
        {images.length > 0 && (
          <div className="attachments">
            {images.map((img, i) => (
              <div key={i} className="attachment">
                <img src={img.preview} alt="" />
                <button onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))} aria-label="Quitar">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-box">
          <button className="btn btn-ghost btn-icon" title={t("chat.attach")} onClick={() => fileInput.current?.click()}>
            <I.Image />
          </button>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />
          <textarea
            rows={1}
            value={input}
            placeholder={kid ? t("chat.placeholderKid") : t("chat.placeholder")}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (files.length) {
                const dt = new DataTransfer();
                files.forEach((f) => dt.items.add(f));
                void attach(dt.files);
              }
            }}
          />
          {busy ? (
            <button className="btn btn-icon" title={t("chat.stop")} onClick={() => abort.current?.abort()}><I.Stop /></button>
          ) : (
            <button className="btn btn-primary btn-icon" title={t("chat.send")} onClick={() => void send()} disabled={!input.trim() && !images.length}><I.Send /></button>
          )}
        </div>
      </div>
    </section>
  );
}

type Group = { kind: "tools"; tools: Extract<Block, { kind: "tool" }>[] } | Extract<Block, { kind: "text" }> | Extract<Block, { kind: "notice" }>;

function groupBlocks(blocks: Block[]): Group[] {
  const out: Group[] = [];
  for (const b of blocks) {
    if (b.kind === "tool") {
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.tools.push(b);
      else out.push({ kind: "tools", tools: [b] });
    } else out.push(b);
  }
  return out;
}

function toolLabel(t: (k: Key) => string, name: string): string {
  const key = `tool.${name}` as Key;
  const label = t(key);
  return label === key || !label ? name : label;
}
