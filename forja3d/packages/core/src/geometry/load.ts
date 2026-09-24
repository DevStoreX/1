import { parseGLB } from "./glb.ts";
import { type Mesh, placeOnBed, removeDegenerate, yUpToZUp } from "./mesh.ts";
import { parseOBJ } from "./obj.ts";
import { parseSTL } from "./stl.ts";

export type MeshFormat = "stl" | "glb" | "obj";

export function detectMeshFormat(data: Uint8Array, fileName?: string): MeshFormat {
  const ext = fileName?.split(".").pop()?.toLowerCase();
  if (ext === "stl" || ext === "glb" || ext === "obj") return ext;
  if (data.byteLength >= 4 && new DataView(data.buffer, data.byteOffset).getUint32(0, true) === 0x46546c67) return "glb";
  const head = new TextDecoder().decode(data.subarray(0, 256));
  if (/^\s*(#|v |o |mtllib|g )/m.test(head) && !head.startsWith("solid")) return "obj";
  return "stl";
}

/**
 * Carga cualquier malla soportada y la deja lista para imprimir: Z hacia arriba,
 * sin triángulos degenerados y apoyada en la cama.
 */
export function loadMesh(data: Uint8Array, fileName?: string, opts: { yUp?: boolean } = {}): Mesh {
  const format = detectMeshFormat(data, fileName);
  let mesh: Mesh;
  if (format === "glb") mesh = yUpToZUp(parseGLB(data));
  else if (format === "obj") {
    mesh = parseOBJ(new TextDecoder().decode(data));
    if (opts.yUp ?? true) mesh = yUpToZUp(mesh);
  } else mesh = parseSTL(data);
  return placeOnBed(removeDegenerate(mesh));
}
