import { type Mesh, mergeMeshes, transformMesh } from "./mesh.ts";

const MAGIC_GLTF = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  extensions?: Record<string, unknown>;
}
interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface Gltf {
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  extensionsRequired?: string[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(gltf: Gltf, bin: Uint8Array, index: number): Float64Array {
  const acc = gltf.accessors?.[index];
  if (!acc) throw new Error(`Accessor ${index} no existe`);
  if (acc.sparse) throw new Error("Accessors 'sparse' no soportados todavía");
  const nComp = COMPONENTS[acc.type] ?? 1;
  const out = new Float64Array(acc.count * nComp);
  if (acc.bufferView === undefined) return out; // todo ceros según la especificación
  const bv = gltf.bufferViews![acc.bufferView];
  const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
  if (!compSize) throw new Error(`componentType ${acc.componentType} no soportado`);
  const stride = bv.byteStride ?? compSize * nComp;
  const base = bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const view = new DataView(bin.buffer);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < nComp; c++) {
      const o = base + i * stride + c * compSize;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = view.getFloat32(o, true); break;
        case 5125: v = view.getUint32(o, true); break;
        case 5123: v = view.getUint16(o, true); break;
        case 5122: v = view.getInt16(o, true); break;
        case 5121: v = view.getUint8(o); break;
        default: v = view.getInt8(o);
      }
      if (acc.normalized) {
        v = acc.componentType === 5121 ? v / 255 : acc.componentType === 5123 ? v / 65535
          : acc.componentType === 5120 ? Math.max(v / 127, -1) : Math.max(v / 32767, -1);
      }
      out[i * nComp + c] = v;
    }
  }
  return out;
}

function multiply(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function nodeMatrix(node: GltfNode): number[] {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  const s = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
  const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
  return multiply(t, multiply(r, s));
}

function primitiveToMesh(gltf: Gltf, bin: Uint8Array, prim: GltfPrimitive): Mesh | null {
  const mode = prim.mode ?? 4;
  if (prim.extensions?.["KHR_draco_mesh_compression"]) {
    throw new Error("El GLB usa compresión Draco; expórtalo sin compresión o conviértelo a STL/OBJ.");
  }
  if (mode !== 4 && mode !== 5 && mode !== 6) return null; // solo triángulos
  const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
  const vCount = pos.length / 3;
  let idx: ArrayLike<number>;
  if (prim.indices !== undefined) idx = readAccessor(gltf, bin, prim.indices);
  else idx = Array.from({ length: vCount }, (_, i) => i);
  const tris: number[] = [];
  if (mode === 4) {
    for (let i = 0; i + 2 < idx.length; i += 3) tris.push(idx[i], idx[i + 1], idx[i + 2]);
  } else if (mode === 5) {
    for (let i = 0; i + 2 < idx.length; i++) {
      if (i % 2 === 0) tris.push(idx[i], idx[i + 1], idx[i + 2]);
      else tris.push(idx[i + 1], idx[i], idx[i + 2]);
    }
  } else {
    for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
  }
  const out = new Float32Array(tris.length * 3);
  tris.forEach((vi, j) => {
    out[j * 3] = pos[vi * 3];
    out[j * 3 + 1] = pos[vi * 3 + 1];
    out[j * 3 + 2] = pos[vi * 3 + 2];
  });
  return { positions: out };
}

/**
 * Lee un archivo .glb (glTF binario) y devuelve toda su geometría como una malla,
 * aplicando las transformaciones de la escena. Mantiene el eje Y-arriba de glTF;
 * usa `yUpToZUp` para imprimir.
 */
export function parseGLB(input: Uint8Array | ArrayBuffer): Mesh {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 20 || view.getUint32(0, true) !== MAGIC_GLTF) {
    throw new Error("No es un archivo GLB válido");
  }
  let offset = 12;
  let json: Gltf | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  while (offset + 8 <= buf.byteLength) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === CHUNK_BIN) bin = data;
    offset += 8 + len;
  }
  if (!json) throw new Error("GLB sin bloque JSON");
  const gltf = json;
  const unsupported = (gltf.extensionsRequired ?? []).filter((e) =>
    ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_mesh_quantization"].includes(e),
  );
  if (unsupported.length && unsupported.some((e) => e !== "KHR_mesh_quantization")) {
    throw new Error(`El GLB requiere extensiones no soportadas: ${unsupported.join(", ")}`);
  }

  const meshes: Mesh[] = [];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const visit = (nodeIndex: number, parent: number[], depth: number) => {
    if (depth > 64) return;
    const node = gltf.nodes?.[nodeIndex];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes?.[node.mesh]?.primitives ?? []) {
        const m = primitiveToMesh(gltf, bin, prim);
        if (m) meshes.push(transformMesh(m, world));
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };

  const sceneNodes = gltf.scenes?.[gltf.scene ?? 0]?.nodes;
  if (sceneNodes?.length) {
    for (const n of sceneNodes) visit(n, identity, 0);
  } else {
    // Sin escena: usamos todas las mallas sin transformar.
    for (const mesh of gltf.meshes ?? []) {
      for (const prim of mesh.primitives) {
        const m = primitiveToMesh(gltf, bin, prim);
        if (m) meshes.push(m);
      }
    }
  }
  return mergeMeshes(meshes);
}

/** Escribe una malla como GLB mínimo (útil para visores web). */
export function toGLB(mesh: Mesh): Uint8Array {
  const positions = mesh.positions;
  const count = positions.length / 3;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  if (count === 0) { min = [0, 0, 0]; max = [0, 0, 0]; }
  const json = {
    asset: { version: "2.0", generator: "Forja3D" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count, type: "VEC3", min, max }],
  };
  let jsonBytes: Uint8Array = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const binLen = positions.byteLength;
  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC_GLTF, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.length;
  view.setUint32(binOff, binLen, true);
  view.setUint32(binOff + 4, CHUNK_BIN, true);
  out.set(new Uint8Array(positions.buffer, positions.byteOffset, binLen), binOff + 8);
  return out;
}
