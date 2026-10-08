import Graphic from "@arcgis/core/Graphic";
import type Mesh from "@arcgis/core/geometry/Mesh";
import Point from "@arcgis/core/geometry/Point";
import { createFromGLTF } from "@arcgis/core/geometry/support/meshUtils";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import type { AppContext, LayerModule } from "../core/modules";
import { addDataStore } from "./state";

/**
 * Upload 3D models (IFC, glTF/GLB, OBJ, FBX, DAE, USDZ …) following the
 * ArcGIS "SceneLayer upload 3D models and applyEdits" workflow:
 *   1. SceneLayer.convertMesh(files) converts the model on the server of an
 *      editable 3D object layer (georeferenced models keep their location)
 *   2. SketchViewModel places / moves / rotates / scales the mesh
 *   3. SceneLayer.applyEdits({ addFeatures }) stores it in the layer
 * Without a target layer, glTF/GLB can still be previewed locally
 * (meshUtils.createFromGLTF), but not saved.
 */

/** Formats converted by an editable 3D object layer's associated feature service. */
export const SERVER_FORMATS = [".ifc", ".glb", ".gltf", ".obj", ".fbx", ".dae", ".usdz", ".3ds", ".zip"];
export const LOCAL_FORMATS = [".glb", ".gltf"];

let ctx: AppContext | null = null;
let target: SceneLayer | null = null;
let sketch: SketchViewModel | null = null;
const pendingLayer = new GraphicsLayer({ title: "Model 3D (belum disimpan)", elevationInfo: { mode: "absolute-height" } });
const localLayer = new GraphicsLayer({ title: "Model 3D lokal (pratinjau)", elevationInfo: { mode: "absolute-height" } });
const meshSymbol = { type: "mesh-3d", symbolLayers: [{ type: "fill" }] } as never;

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

function setStatus(text: string, kind: "success" | "danger" | "info" = "info") {
  addDataStore.set({ message: { kind, text } });
}

function syncPending() {
  addDataStore.set({
    pendingModels: pendingLayer.graphics.toArray().map((g) => ({ id: g.attributes?.__id ?? "", fileName: g.attributes?.__file ?? "model" })),
  });
}

/** Connect to (or clear) the editable 3D object scene layer that receives uploads. */
export async function setModelTarget(url: string): Promise<void> {
  if (!ctx) return;
  if (target) ctx.map.remove(target);
  target = null;
  addDataStore.set({ modelTargetUrl: url });
  if (!url.trim()) {
    addDataStore.set({ modelTargetStatus: "Belum ada layer target. glTF/GLB dapat dipratinjau secara lokal (tidak tersimpan)." });
    return;
  }
  addDataStore.set({ busy: true, modelTargetStatus: "Menghubungkan…" });
  try {
    const layer = new SceneLayer({ url: url.trim() });
    await layer.load();
    const canAdd = layer.capabilities?.operations?.supportsAdd && layer.capabilities?.editing?.supportsGeometryUpdate !== false;
    if (layer.geometryType !== "mesh") throw new Error("Layer bukan 3D object scene layer");
    ctx.map.add(layer);
    target = layer;
    addDataStore.set({
      modelTargetStatus: canAdd
        ? `Terhubung ke "${layer.title}". Model akan dikonversi di server dan disimpan dengan applyEdits.`
        : `Terhubung ke "${layer.title}", tetapi layer ini tidak mengizinkan penambahan fitur (perlu login dengan hak edit / layer editable).`,
    });
  } catch (err) {
    addDataStore.set({ modelTargetStatus: `Gagal terhubung: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    addDataStore.set({ busy: false });
  }
}

/** Convert a model and start interactive placement (or frame it if it is georeferenced). */
export async function importModel(files: File[]): Promise<void> {
  if (!ctx || !sketch || !files.length) return;
  const { view } = ctx;
  const main = files.find((f) => [...SERVER_FORMATS].includes(extensionOf(f.name))) ?? files[0];
  const ext = extensionOf(main.name);
  const origin = (view.center?.clone() ?? new Point({ longitude: 106.8227, latitude: -6.1945 })) as Point;
  addDataStore.set({ busy: true });
  setStatus(`Mengonversi ${main.name}…`);
  try {
    let mesh: Mesh;
    let georeferenced = false;
    if (target) {
      const result = await target.convertMesh(files, { defaultOrigin: origin });
      mesh = result.mesh;
      georeferenced = !!result.georeferenceInfo;
    } else if (LOCAL_FORMATS.includes(ext)) {
      mesh = await createFromGLTF(origin, URL.createObjectURL(main));
    } else {
      throw new Error(`Format ${ext} perlu dikonversi di server. Isi URL 3D object layer yang editable terlebih dahulu.`);
    }

    const layer = target ? pendingLayer : localLayer;
    sketch.layer = layer;
    const attributes = { __id: `m${Date.now().toString(36)}`, __file: main.name };
    if (georeferenced) {
      const graphic = new Graphic({ geometry: mesh, symbol: meshSymbol, attributes });
      layer.add(graphic);
      await view.goTo(graphic);
      void sketch.update(graphic);
      setStatus(`${main.name} memiliki georeferensi dan sudah ditempatkan. Sesuaikan posisi bila perlu, lalu simpan.`, "success");
    } else {
      const done = sketch.on("create", (e) => {
        if (e.state !== "complete" || !e.graphic) return;
        done.remove();
        const placed = e.graphic;
        placed.attributes = attributes;
        placed.symbol = meshSymbol;
        syncPending();
        setStatus(
          target
            ? `${main.name} ditempatkan. Geser/putar/skala bila perlu, lalu klik "Simpan ke layer".`
            : `${main.name} ditempatkan sebagai pratinjau lokal (tidak tersimpan). Hubungkan 3D object layer untuk menyimpan.`,
          "success",
        );
        void sketch!.update(placed);
      });
      void sketch.place(mesh);
      setStatus(`Klik di peta untuk menempatkan ${main.name}. Setelah itu model bisa digeser, diputar, dan diskalakan.`);
    }
    syncPending();
  } catch (err) {
    setStatus(`Gagal mengimpor model: ${err instanceof Error ? err.message : String(err)}`, "danger");
  } finally {
    addDataStore.set({ busy: false });
  }
}

/** Store all placed models in the target layer (applyEdits addFeatures). */
export async function savePendingModels(): Promise<void> {
  if (!target) return setStatus("Tidak ada layer target untuk menyimpan.", "danger");
  const graphics = pendingLayer.graphics.toArray();
  if (!graphics.length) return;
  sketch?.cancel();
  addDataStore.set({ busy: true });
  setStatus(`Menyimpan ${graphics.length} model ke ${target.title}…`);
  try {
    const features = graphics.map((g) => new Graphic({ geometry: g.geometry, attributes: {} }));
    const result = await target.applyEdits({ addFeatures: features });
    const failed = result.addFeatureResults.filter((r) => r.error);
    if (failed.length) throw new Error(failed[0].error?.message ?? "applyEdits gagal");
    pendingLayer.removeAll();
    syncPending();
    setStatus(`${graphics.length} model tersimpan di layer "${target.title}".`, "success");
  } catch (err) {
    setStatus(`Gagal menyimpan: ${err instanceof Error ? err.message : String(err)}`, "danger");
  } finally {
    addDataStore.set({ busy: false });
  }
}

export function discardPendingModels(): void {
  sketch?.cancel();
  pendingLayer.removeAll();
  localLayer.removeAll();
  syncPending();
}

export function createModelImportLayer(defaultTargetUrl: string): LayerModule {
  return {
    id: "model-import",
    title: "Model 3D impor",
    description: "Model 3D yang diunggah lewat menu Tambah data.",
    visibleByDefault: true,

    init(c) {
      ctx = c;
      c.map.addMany([localLayer, pendingLayer]);
      sketch = new SketchViewModel({ view: c.view, layer: pendingLayer });
      sketch.on("update", (e) => e.state === "complete" && syncPending());
      void setModelTarget(defaultTargetUrl);
    },

    setVisible(visible) {
      pendingLayer.visible = visible;
      localLayer.visible = visible;
      if (target) target.visible = visible;
    },
  };
}
