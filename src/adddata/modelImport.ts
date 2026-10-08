import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import { createFromGLTF } from "@arcgis/core/geometry/support/meshUtils";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import type { AppContext, LayerModule } from "../core/modules";
import { addDataStore } from "./state";

import type { ConvertOptions } from "./modelConvert";

/**
 * Place 3D models in the scene, entirely in the browser. glTF / GLB is used
 * as is; IFC, OBJ, FBX, DAE and USD(Z) are first converted to GLB in the
 * browser (modelConvert, loaded on demand). The GLB becomes a Mesh
 * (meshUtils.createFromGLTF), placed with a click and can then be moved,
 * rotated and scaled (SketchViewModel). Nothing is uploaded or saved; models
 * live for the current session only.
 */

/** Formats that are placed directly. */
export const NATIVE_FORMATS = [".glb", ".gltf"];
/** Formats converted to GLB in the browser first. */
export const CONVERTED_FORMATS = [".ifc", ".obj", ".fbx", ".dae", ".usdz", ".usd", ".usda", ".usdc"];
export const MODEL_FORMATS = [...NATIVE_FORMATS, ...CONVERTED_FORMATS];
/** Files referenced by a model (materials, buffers, textures) that may be selected alongside it. */
export const COMPANION_FORMATS = [".mtl", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga", ".gif"];

let ctx: AppContext | null = null;
let sketch: SketchViewModel | null = null;
const modelLayer = new GraphicsLayer({ title: "Model 3D", elevationInfo: { mode: "absolute-height" } });
const meshSymbol = { type: "mesh-3d", symbolLayers: [{ type: "fill" }] } as never;
const objectUrls = new Map<string, string>();

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

function setStatus(text: string, kind: "success" | "danger" | "info" = "info") {
  addDataStore.set({ message: { kind, text } });
}

function syncModels() {
  addDataStore.set({
    models: modelLayer.graphics.toArray().map((g) => ({ id: g.attributes?.__id ?? "", fileName: g.attributes?.__file ?? "model", format: g.attributes?.__format ?? "glTF/GLB" })),
  });
}

/** Load a model (plus companion files), convert it if needed and start interactive placement. */
export async function importModel(files: File[], options: Omit<ConvertOptions, "onProgress">): Promise<void> {
  if (!ctx || !sketch || !files.length) return;
  const file = files.find((f) => MODEL_FORMATS.includes(extensionOf(f.name)));
  if (!file) {
    return setStatus(
      `Format tidak didukung (${files.map((f) => extensionOf(f.name)).join(", ")}). Gunakan glTF/GLB, IFC, OBJ, FBX, DAE, atau USDZ.`,
      "danger",
    );
  }
  const companions = files.filter((f) => f !== file && COMPANION_FORMATS.includes(extensionOf(f.name)));
  const ext = extensionOf(file.name);
  const origin = (ctx.view.center?.clone() ?? new Point({ longitude: 106.8227, latitude: -6.1945 })) as Point;
  addDataStore.set({ busy: true });
  setStatus(`Memuat ${file.name}…`);
  try {
    // .glb and self-contained .gltf go straight in; everything else (incl. .gltf with external files) is converted.
    const direct = ext === ".glb" || (ext === ".gltf" && !companions.length);
    let blob: Blob = file;
    let detail = "";
    if (!direct) {
      const { convertToGlb } = await import("./modelConvert");
      const result = await convertToGlb(file, companions, { ...options, onProgress: (text) => setStatus(text) });
      blob = result.glb;
      const [w, hgt, d] = result.size.map((v) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("id-ID")));
      detail = ` Ukuran ${w} × ${d} m, tinggi ${hgt} m (satuan: ${result.unit}).`;
    }
    const url = URL.createObjectURL(blob);
    const mesh = await createFromGLTF(origin, url);
    const id = `m${Date.now().toString(36)}`;
    objectUrls.set(id, url);
    const format = NATIVE_FORMATS.includes(ext) ? "glTF/GLB" : `${ext.slice(1).toUpperCase()} → GLB`;
    const done = sketch.on("create", (e) => {
      if (e.state !== "complete" || !e.graphic) return;
      done.remove();
      const placed = e.graphic;
      placed.attributes = { __id: id, __file: file.name, __format: format };
      placed.symbol = meshSymbol;
      syncModels();
      void sketch!.update(placed);
      setStatus(`${file.name} ditempatkan. Geser, putar, atau skalakan dengan manipulator; klik di luar model untuk selesai.`, "success");
    });
    void sketch.place(mesh);
    setStatus(`Klik di peta untuk menempatkan ${file.name}.${detail}`);
  } catch (err) {
    console.error(err);
    setStatus(`Gagal memuat ${file.name}: ${err instanceof Error ? err.message : String(err)}`, "danger");
  } finally {
    addDataStore.set({ busy: false });
  }
}

function graphicById(id: string): Graphic | undefined {
  return modelLayer.graphics.find((g) => g.attributes?.__id === id);
}

export function editModel(id: string): void {
  const g = graphicById(id);
  if (g && sketch) void sketch.update(g);
}

export function zoomToModel(id: string): void {
  const g = graphicById(id);
  if (g && ctx) void ctx.view.goTo(g).catch(() => {});
}

export function removeModel(id: string): void {
  const g = graphicById(id);
  if (!g) return;
  sketch?.cancel();
  modelLayer.remove(g);
  const url = objectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(id);
  syncModels();
}

export function clearModels(): void {
  sketch?.cancel();
  modelLayer.removeAll();
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  syncModels();
}

export function createModelImportLayer(): LayerModule {
  return {
    id: "model-import",
    title: "Model 3D",
    description: "Model 3D yang ditempatkan lewat menu Tambah data (hanya sesi ini).",
    visibleByDefault: true,

    init(c) {
      ctx = c;
      c.map.add(modelLayer);
      sketch = new SketchViewModel({ view: c.view, layer: modelLayer });
      sketch.on("delete", syncModels);
    },

    setVisible(visible) {
      modelLayer.visible = visible;
    },
  };
}
