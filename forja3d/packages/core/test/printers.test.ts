import { describe, expect, it } from "vitest";
import { createConnector, MockConnector, readFirstJpeg } from "../src/printers/index.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function fakeFetch(routes: Record<string, (c: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = { url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body };
    calls.push(call);
    const key = Object.keys(routes).find((k) => `${call.method} ${url}`.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return routes[key](call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

describe("OctoPrint", () => {
  it("lee estado y envía comandos con la API key", async () => {
    const { impl, calls } = fakeFetch({
      "GET http://octo/api/job": () => json({ job: { file: { name: "llavero.gcode" } }, progress: { completion: 42.5, printTime: 600, printTimeLeft: 900 } }),
      "GET http://octo/api/printer": () => json({ state: { text: "Printing", flags: { printing: true, operational: true } }, temperature: { tool0: { actual: 210, target: 210 }, bed: { actual: 60, target: 60 } } }),
      "POST http://octo/api/job": () => new Response(null, { status: 204 }),
      "POST http://octo/api/files/local": () => json({ done: true }, 201),
    });
    const c = createConnector({ id: "1", name: "Ender", kind: "octoprint", url: "http://octo/", apiKey: "KEY" }, impl);
    const s = await c.status();
    expect(s).toMatchObject({ online: true, state: "printing", progress: 0.425, fileName: "llavero.gcode", timeLeftSec: 900 });
    expect(s.temps?.nozzle?.actual).toBe(210);
    await c.pause();
    expect(JSON.parse(String(calls.at(-1)!.body))).toEqual({ command: "pause", action: "pause" });
    expect(calls.at(-1)!.headers["X-Api-Key"]).toBe("KEY");
    await c.upload("pieza.gcode", new TextEncoder().encode("G28"), { startPrint: true });
    const form = calls.at(-1)!.body as FormData;
    expect(form.get("print")).toBe("true");
  });

  it("reporta desconectado con HTTP 409", async () => {
    const { impl } = fakeFetch({
      "GET http://octo/api/job": () => json({}),
      "GET http://octo/api/printer": () => new Response("Printer is not operational", { status: 409 }),
    });
    const c = createConnector({ id: "1", name: "x", kind: "octoprint", url: "http://octo" }, impl);
    expect(await c.status()).toMatchObject({ online: false, state: "offline" });
  });
});

describe("Moonraker (Klipper)", () => {
  it("interpreta print_stats y calcula tiempo restante", async () => {
    const { impl, calls } = fakeFetch({
      "GET http://k1:7125/printer/objects/query": () => json({ result: { status: { print_stats: { state: "printing", filename: "soporte.gcode", print_duration: 1000 }, virtual_sdcard: { progress: 0.5 }, extruder: { temperature: 220, target: 220 }, heater_bed: { temperature: 60, target: 60 } } } }),
      "POST http://k1:7125/printer/print/cancel": () => json({ result: "ok" }),
    });
    const c = createConnector({ id: "2", name: "K1", kind: "moonraker", url: "http://k1:7125" }, impl);
    expect(await c.status()).toMatchObject({ state: "printing", progress: 0.5, timeLeftSec: 1000, fileName: "soporte.gcode" });
    await c.cancel();
    expect(calls.at(-1)!.url).toBe("http://k1:7125/printer/print/cancel");
  });
});

describe("PrusaLink", () => {
  it("usa autenticación Digest y pausa el trabajo activo", async () => {
    let authed = 0;
    const { impl, calls } = fakeFetch({
      "http://mk4/api/v1/status": (c) => {
        if (!c.headers.Authorization) return new Response("", { status: 401, headers: { "www-authenticate": 'Digest realm="Printer API", nonce="abc", qop="auth"' } });
        authed++;
        expect(c.headers.Authorization).toMatch(/^Digest username="maker", realm="Printer API", nonce="abc", uri="\/api\/v1\/status", response="[0-9a-f]{32}"/);
        return json({ printer: { state: "PRINTING", temp_nozzle: 215, target_nozzle: 215, temp_bed: 60, target_bed: 60 }, job: { id: 7, progress: 12, time_remaining: 3600 } });
      },
      "PUT http://mk4/api/v1/job/7/pause": (c) => (c.headers.Authorization ? new Response(null, { status: 204 }) : new Response("", { status: 401, headers: { "www-authenticate": 'Digest realm="Printer API", nonce="abc", qop="auth"' } })),
    });
    const c = createConnector({ id: "3", name: "MK4", kind: "prusalink", url: "http://mk4", password: "secreto" }, impl);
    expect(await c.status()).toMatchObject({ state: "printing", progress: 0.12, timeLeftSec: 3600 });
    await c.pause();
    expect(authed).toBe(2);
    expect(calls.some((x) => x.method === "PUT" && x.url.endsWith("/job/7/pause") && x.headers.Authorization)).toBe(true);
  });
});

describe("impresora simulada", () => {
  it("simula el ciclo de impresión", async () => {
    const m = new MockConnector({ id: "m", name: "Demo", kind: "mock" });
    expect((await m.status()).state).toBe("idle");
    await m.upload("a.gcode", new Uint8Array([1]), { startPrint: true });
    expect((await m.status()).state).toBe("printing");
    await m.pause();
    expect((await m.status()).state).toBe("paused");
    await m.resume();
    await m.cancel();
    expect((await m.status()).state).toBe("idle");
  });
});

describe("cámara MJPEG", () => {
  it("extrae el primer JPEG de un flujo multipart", async () => {
    const jpeg = [0xff, 0xd8, 1, 2, 3, 0xff, 0xd9];
    const enc = new TextEncoder();
    const body = new Uint8Array([...enc.encode("--frame\r\nContent-Type: image/jpeg\r\n\r\n"), ...jpeg, ...enc.encode("\r\n--frame\r\n"), ...jpeg]);
    const res = new Response(body, { headers: { "content-type": "multipart/x-mixed-replace; boundary=frame" } });
    expect(Array.from(await readFirstJpeg(res))).toEqual(jpeg);
  });
});
