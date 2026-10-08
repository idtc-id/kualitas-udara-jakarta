import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import { createFromGLTF } from "@arcgis/core/geometry/support/meshUtils";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import type { AppContext, LayerModule } from "../core/modules";
import { addDataStore } from "./state";

/**
 * Place glTF / GLB models in the scene, entirely in the browser: the file is
 * turned into a Mesh (meshUtils.createFromGLTF), placed with a click and can
 * then be moved, rotated and scaled (SketchViewModel). Nothing is uploaded or
 * saved; models live for the current session only.
 */

export const MODEL_FORMATS = [".glb", ".gltf"];

let ctx: AppContext | null = null;
let sketch: SketchViewModel | null = null;
const modelLayer = new GraphicsLayer({ title: "Model 3D (glTF/GLB)", elevationInfo: { mode: "absolute-height" } });
const meshSymbol = { type: "mesh-3d", symbolLayers: [{ type: "fill" }] } as never;
const objectUrls = new Map<string, string>();

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

function setStatus(text: string, kind: "success" | "danger" | "info" = "info") {
  addDataStore.set({ message: { kind, text } });
}

function syncModels() {
  addDataStore.set({
    models: modelLayer.graphics.toArray().map((g) => ({ id: g.attributes?.__id ?? "", fileName: g.attributes?.__file ?? "model" })),
  });
}

/** Load a glTF/GLB file and start interactive placement. */
export async function importModel(files: File[]): Promise<void> {
  if (!ctx || !sketch || !files.length) return;
  const file = files.find((f) => MODEL_FORMATS.includes(extensionOf(f.name)));
  if (!file) {
    return setStatus(`Format tidak didukung (${files.map((f) => extensionOf(f.name)).join(", ")}). Saat ini hanya glTF (.gltf) dan GLB (.glb).`, "danger");
  }
  const origin = (ctx.view.center?.clone() ?? new Point({ longitude: 106.8227, latitude: -6.1945 })) as Point;
  addDataStore.set({ busy: true });
  setStatus(`Memuat ${file.name}…`);
  try {
    // A .gltf that references external .bin / texture files only works when those are embedded; .glb is self-contained.
    const url = URL.createObjectURL(file);
    const mesh = await createFromGLTF(origin, url);
    const id = `m${Date.now().toString(36)}`;
    objectUrls.set(id, url);
    const done = sketch.on("create", (e) => {
      if (e.state !== "complete" || !e.graphic) return;
      done.remove();
      const placed = e.graphic;
      placed.attributes = { __id: id, __file: file.name };
      placed.symbol = meshSymbol;
      syncModels();
      void sketch!.update(placed);
      setStatus(`${file.name} ditempatkan. Geser, putar, atau skalakan dengan manipulator; klik di luar model untuk selesai.`, "success");
    });
    void sketch.place(mesh);
    setStatus(`Klik di peta untuk menempatkan ${file.name}.`);
  } catch (err) {
    setStatus(`Gagal memuat model: ${err instanceof Error ? err.message : String(err)}`, "danger");
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
    title: "Model 3D (glTF/GLB)",
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
