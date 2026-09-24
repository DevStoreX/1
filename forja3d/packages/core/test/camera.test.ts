import { describe, expect, it, vi } from "vitest";
import { CameraMonitor, parseVerdictJson, VisionLLMDetector, type FailureDetector } from "../src/camera/index.ts";
import { MockConnector } from "../src/printers/index.ts";

describe("detector por visión", () => {
  it("interpreta la respuesta JSON del modelo", async () => {
    const det = new VisionLLMDetector(async () => ({ text: 'Aquí va: {"verdict":"failure","confidence":0.92,"issues":["espagueti"],"explanation":"Hilos enredados sobre la cama"}', costUsd: 0.001 }));
    const r = await det.check({ data: new Uint8Array([1]), mime: "image/jpeg" }, { printerName: "A1" });
    expect(r).toMatchObject({ verdict: "failure", confidence: 0.92, issues: ["espagueti"], costUsd: 0.001 });
  });

  it("devuelve unknown si la respuesta no es JSON", () => {
    expect(parseVerdictJson("no sé", "x").verdict).toBe("unknown");
  });
});

describe("monitor de cámara", () => {
  it("pausa tras fallos consecutivos confirmados", async () => {
    vi.useFakeTimers();
    const printer = new MockConnector({ id: "p", name: "Demo", kind: "mock" });
    printer.snapshot = async () => ({ data: new Uint8Array([0xff, 0xd8]), mime: "image/jpeg" });
    await printer.start("x.gcode");
    const detector: FailureDetector = {
      name: "fake",
      check: async () => ({ at: new Date().toISOString(), verdict: "failure", confidence: 0.9, issues: ["espagueti"], explanation: "", detector: "fake" }),
    };
    const mon = new CameraMonitor();
    const paused = vi.fn();
    mon.on("paused", paused);
    mon.start("p", { connector: () => printer, detector: () => detector, printerName: "Demo" }, { intervalSec: 10, confirmations: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(paused).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(paused).toHaveBeenCalledOnce();
    expect((await printer.status()).state).toBe("paused");
    expect(mon.get("p")!.history).toHaveLength(2);
    mon.stopAll();
    vi.useRealTimers();
  });
});
