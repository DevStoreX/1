import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

interface Props {
  url: string | null;
  /** Identificador del modelo: al cambiar, se vuelve a encuadrar la cámara */
  modelKey?: string;
  buildVolume?: { x: number; y: number; z: number };
  wireframe?: boolean;
  fitNonce?: number;
  onLoaded?: () => void;
  onError?: (msg: string) => void;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Visor 3D con eje Z hacia arriba, cama de impresión y cámara orbital. */
export function Viewer3D({ url, modelKey, buildVolume, wireframe, fitNonce, onLoaded, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const lastKey = useRef<string | undefined>(undefined);
  const [themeNonce, setThemeNonce] = useState(0);
  const state = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh | null;
    bed: THREE.Group;
    material: THREE.MeshStandardMaterial;
    render: () => void;
    fit: () => void;
  } | null>(null);

  // Inicialización
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -160, 120);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a70, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, -1.5, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe2cc, 0.6);
    rim.position.set(-1.5, 1, 0.5);
    scene.add(rim);

    const bed = new THREE.Group();
    scene.add(bed);
    const material = new THREE.MeshStandardMaterial({ color: cssVar("--model-color", "#f97316"), roughness: 0.55, metalness: 0.05 });

    let raf = 0;
    const loop = () => {
      raf = 0;
      const moving = controls.update();
      renderer.render(scene, camera);
      if (moving) raf = requestAnimationFrame(loop);
    };
    const render = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    controls.addEventListener("change", render);

    const fit = () => {
      const s = state.current!;
      const box = new THREE.Box3();
      if (s.mesh) box.setFromObject(s.mesh);
      else box.setFromObject(bed);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.15;
      const dir = new THREE.Vector3(0.9, -1.3, 0.9).normalize();
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
      camera.near = dist / 100;
      camera.far = dist * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.update();
      render();
    };

    const applyTheme = () => {
      scene.background = new THREE.Color(cssVar("--viewer-bg", "#f3ece5"));
      material.color.set(cssVar("--model-color", "#f97316"));
      setThemeNonce((n) => n + 1);
      render();
    };
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", applyTheme);
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    state.current = { renderer, scene, camera, controls, mesh: null, bed, material, render, fit };
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", applyTheme);
      themeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      state.current = null;
    };
  }, []);

  // Cama de impresión
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.bed.clear();
    const bv = buildVolume ?? { x: 220, y: 220, z: 250 };
    const grid = new THREE.GridHelper(
      Math.max(bv.x, bv.y),
      Math.round(Math.max(bv.x, bv.y) / 10),
      new THREE.Color(cssVar("--grid-major", "#b8a898")),
      new THREE.Color(cssVar("--grid-minor", "#d8ccc0")),
    );
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.8;
    s.bed.add(grid);
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bv.x, bv.y, bv.z)),
      new THREE.LineDashedMaterial({ color: 0xc9a88a, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.6 }),
    );
    box.position.z = bv.z / 2;
    box.computeLineDistances();
    s.bed.add(box);
    s.render();
  }, [buildVolume?.x, buildVolume?.y, buildVolume?.z, themeNonce]);

  // Carga del modelo
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    if (!url) {
      if (s.mesh) {
        s.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh = null;
      }
      s.render();
      return;
    }
    let cancelled = false;
    const refit = !s.mesh || lastKey.current !== modelKey;
    lastKey.current = modelKey;
    new STLLoader().load(
      url,
      (geometry) => {
        if (cancelled) return;
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        // Centramos en XY y apoyamos en la cama
        geometry.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
        if (s.mesh) {
          s.scene.remove(s.mesh);
          s.mesh.geometry.dispose();
        }
        s.mesh = new THREE.Mesh(geometry, s.material);
        s.scene.add(s.mesh);
        if (refit) s.fit();
        else s.render();
        onLoaded?.();
      },
      undefined,
      () => !cancelled && onError?.("No se pudo cargar el modelo 3D"),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.material.wireframe = !!wireframe;
    s.render();
  }, [wireframe]);

  useEffect(() => {
    if (fitNonce) state.current?.fit();
  }, [fitNonce]);

  return <div className="viewer-canvas" ref={host} />;
}
