import { type Mesh, triangleNormal } from "./mesh.ts";

function isBinarySTL(buf: Uint8Array): boolean {
  if (buf.byteLength < 84) return false;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(80, true);
  if (84 + count * 50 === buf.byteLength) return true;
  // Algunos exportadores escriben "solid" en la cabecera binaria; si el tamaño no cuadra
  // y empieza por "solid", asumimos ASCII.
  const head = new TextDecoder().decode(buf.subarray(0, 5)).toLowerCase();
  return head !== "solid";
}

export function parseSTL(input: Uint8Array | ArrayBuffer): Mesh {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  return isBinarySTL(buf) ? parseBinarySTL(buf) : parseAsciiSTL(new TextDecoder().decode(buf));
}

function parseBinarySTL(buf: Uint8Array): Mesh {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const declared = view.getUint32(80, true);
  const count = Math.min(declared, Math.floor((buf.byteLength - 84) / 50));
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12; // saltamos la normal
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(base + k * 4, true);
  }
  return { positions };
}

function parseAsciiSTL(text: string): Mesh {
  const nums: number[] = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  const usable = nums.length - (nums.length % 9);
  return { positions: Float32Array.from(nums.slice(0, usable)) };
}

export function toBinarySTL(mesh: Mesh, header = "Forja3D"): Uint8Array {
  const p = mesh.positions;
  const count = Math.floor(p.length / 9);
  const out = new Uint8Array(84 + count * 50);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(header.slice(0, 79)), 0);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const off = 84 + t * 50;
    const n = triangleNormal(p, t * 9);
    view.setFloat32(off, n[0], true);
    view.setFloat32(off + 4, n[1], true);
    view.setFloat32(off + 8, n[2], true);
    for (let k = 0; k < 9; k++) view.setFloat32(off + 12 + k * 4, p[t * 9 + k], true);
  }
  return out;
}
