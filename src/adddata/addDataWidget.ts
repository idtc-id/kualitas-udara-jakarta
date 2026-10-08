import type { AppContext, WidgetModule } from "../core/modules";
import { h } from "../ui/dom";
import { createLayer, SOURCE_OPTIONS, TYPE_LABELS } from "./layerFactory";
import { discardPendingModels, importModel, LOCAL_FORMATS, savePendingModels, SERVER_FORMATS, setModelTarget } from "./modelImport";
import { addDataStore, savedSpecs, type SourceSpec } from "./state";

type Section = "service" | "file" | "model";

/** "Tambah data": add ArcGIS / OGC services, CSV & GeoJSON, and 3D models (IFC, glTF …). */
export const addDataWidget: WidgetModule = {
  id: "add-data",
  title: "Tambah data",
  icon: "add-layer",
  placement: "start",

  create(ctx: AppContext) {
    const { map, view } = ctx;

    const addSource = async (spec: SourceSpec, persistent: boolean) => {
      addDataStore.set({ busy: true, message: { kind: "info", text: `Memuat ${TYPE_LABELS[spec.kind]}…` } });
      try {
        const layer = await createLayer(spec);
        map.add(layer);
        const entry = { id: layer.id, spec, title: layer.title || spec.url, typeLabel: TYPE_LABELS[spec.kind], layer, persistent };
        addDataStore.set({ entries: [...addDataStore.state.entries, entry], message: { kind: "success", text: `"${entry.title}" ditambahkan.` } });
        if (layer.fullExtent) void view.goTo(layer.fullExtent).catch(() => {});
      } catch (err) {
        addDataStore.set({ message: { kind: "danger", text: `Gagal menambah data: ${err instanceof Error ? err.message : String(err)}` } });
      } finally {
        addDataStore.set({ busy: false });
      }
    };

    // Restore URL-based layers added in an earlier session (best effort).
    for (const spec of savedSpecs()) void addSource(spec, true);

    // --- section switcher
    const sections = h("calcite-segmented-control", { scale: "s", width: "full", attrs: { "aria-label": "Jenis data" } });
    const sectionDefs: { id: Section; label: string }[] = [
      { id: "service", label: "Layanan / URL" },
      { id: "file", label: "Berkas" },
      { id: "model", label: "Model 3D" },
    ];
    for (const s of sectionDefs) sections.append(h("calcite-segmented-control-item", { value: s.id, checked: s.id === "service" }, s.label));

    // --- service / URL
    const kind = h("calcite-select", { label: "Jenis layer", scale: "s" });
    for (const group of ["ArcGIS", "OGC", "Berkas / format terbuka", "3D"] as const) {
      const og = h("calcite-option-group", { label: group });
      for (const o of SOURCE_OPTIONS.filter((x) => x.group === group)) og.append(h("calcite-option", { value: o.kind }, o.label));
      kind.append(og);
    }
    const urlLabel = h("span");
    const url = h("calcite-input-text", { scale: "s", placeholder: "" });
    const paramLabel = h("span");
    const param = h("calcite-input-text", { scale: "s" });
    const paramRow = h("calcite-label", { scale: "s" }, paramLabel, param);
    const title = h("calcite-input-text", { scale: "s", placeholder: "Nama layer (opsional)" });
    const hint = h("div", { class: "muted small" });
    const addBtn = h("calcite-button", { iconStart: "add-layer", scale: "s", width: "full" }, "Tambah ke peta");

    const syncKind = () => {
      const o = SOURCE_OPTIONS.find((x) => x.kind === kind.value) ?? SOURCE_OPTIONS[0];
      urlLabel.textContent = o.urlLabel;
      url.placeholder = o.placeholder;
      paramRow.hidden = !o.paramLabel;
      paramLabel.textContent = o.paramLabel ?? "";
      hint.textContent = o.hint;
    };
    kind.addEventListener("calciteSelectChange", syncKind);
    syncKind();
    addBtn.addEventListener("click", () => {
      if (!url.value.trim()) return;
      const spec: SourceSpec = { kind: kind.value as SourceSpec["kind"], url: url.value.trim(), param: param.value.trim() || undefined, title: title.value.trim() || undefined };
      void addSource(spec, true).then(() => {
        url.value = "";
        param.value = "";
        title.value = "";
      });
    });
    const serviceBox = h(
      "div",
      { class: "widget-section" },
      h("calcite-label", { scale: "s" }, "Jenis layer", kind),
      h("calcite-label", { scale: "s" }, urlLabel, url),
      paramRow,
      h("calcite-label", { scale: "s" }, "Nama", title),
      hint,
      addBtn,
    );

    // --- local files (CSV / GeoJSON)
    const fileInput = h("input", { type: "file", accept: ".csv,.geojson,.json", multiple: true, hidden: true });
    const addFiles = (files: File[]) => {
      for (const f of files) {
        const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
        const k = ext === ".csv" ? "file-csv" : ext === ".geojson" || ext === ".json" ? "file-geojson" : null;
        if (!k) {
          addDataStore.set({ message: { kind: "danger", text: `${f.name}: format tidak didukung di sini (gunakan CSV atau GeoJSON; model 3D di tab Model 3D).` } });
          continue;
        }
        void addSource({ kind: k, url: URL.createObjectURL(f), title: f.name.replace(/\.[^.]+$/, "") }, false);
      }
    };
    fileInput.addEventListener("change", () => {
      addFiles([...(fileInput.files ?? [])]);
      fileInput.value = "";
    });
    const pickFile = h("calcite-button", { iconStart: "upload", scale: "s", width: "full", appearance: "outline" }, "Pilih berkas CSV / GeoJSON");
    pickFile.addEventListener("click", () => fileInput.click());
    const fileBox = h(
      "div",
      { class: "widget-section", hidden: true },
      dropZone("Tarik & lepas berkas CSV atau GeoJSON di sini", addFiles),
      pickFile,
      fileInput,
      h("p", { class: "muted small" }, "CSV: kolom koordinat (lat/lon, latitude/longitude, y/x) dideteksi otomatis. GeoJSON: FeatureCollection WGS84. Berkas lokal tidak disimpan setelah halaman dimuat ulang."),
    );

    // --- 3D models
    const target = h("calcite-input-text", { scale: "s", placeholder: "https://…/SceneServer/layers/0", value: addDataStore.state.modelTargetUrl });
    const connect = h("calcite-button", { iconStart: "link", scale: "s", appearance: "outline" }, "Hubungkan");
    connect.addEventListener("click", () => void setModelTarget(target.value));
    const targetStatus = h("div", { class: "muted small" });
    const modelInput = h("input", { type: "file", accept: SERVER_FORMATS.join(","), multiple: true, hidden: true });
    modelInput.addEventListener("change", () => {
      void importModel([...(modelInput.files ?? [])]);
      modelInput.value = "";
    });
    const pickModel = h("calcite-button", { iconStart: "cube", scale: "s", width: "full" }, "Pilih model 3D");
    pickModel.addEventListener("click", () => modelInput.click());
    const pendingList = h("div", { class: "plantings" });
    const save = h("calcite-button", { iconStart: "save", scale: "s", kind: "brand" }, "Simpan ke layer (applyEdits)");
    save.addEventListener("click", () => void savePendingModels());
    const discard = h("calcite-button", { iconStart: "x", scale: "s", appearance: "transparent", kind: "danger" }, "Batalkan");
    discard.addEventListener("click", discardPendingModels);
    const modelBox = h(
      "div",
      { class: "widget-section", hidden: true },
      h("calcite-label", { scale: "s" }, "3D object scene layer target (editable)", h("div", { class: "input-row" }, target, connect)),
      targetStatus,
      dropZone("Tarik & lepas model 3D di sini (IFC, glTF/GLB, OBJ, FBX, DAE, USDZ)", (files) => void importModel(files)),
      pickModel,
      modelInput,
      h("div", { class: "section-title" }, "Model belum disimpan"),
      pendingList,
      h("div", { class: "row-actions" }, discard, save),
      h(
        "p",
        { class: "muted small" },
        `Alur mengikuti sample ArcGIS "SceneLayer upload 3D models and applyEdits": model dikonversi oleh layanan 3D object layer (convertMesh), ditempatkan dengan klik, bisa digeser/diputar/diskalakan, lalu disimpan dengan applyEdits. Model bergeoreferensi (mis. IFC dengan koordinat) langsung ditempatkan di lokasinya. Tanpa layer target, hanya ${LOCAL_FORMATS.join("/")} yang bisa dipratinjau (tidak tersimpan). Layer target harus editable dan mungkin perlu login ArcGIS.`,
      ),
    );

    sections.addEventListener("calciteSegmentedControlChange", () => {
      const v = sections.value as Section;
      serviceBox.hidden = v !== "service";
      fileBox.hidden = v !== "file";
      modelBox.hidden = v !== "model";
    });

    // --- shared: status + added layers
    const notice = h("calcite-notice", { scale: "s", width: "full", open: false, closable: true });
    const noticeMsg = h("div", { slot: "message" });
    notice.append(noticeMsg);
    const loader = h("calcite-loader", { inline: true, label: "Memuat", hidden: true });
    const list = h("div", { class: "added-list" });

    addDataStore.on(["message", "busy", "entries", "modelTargetStatus", "pendingModels"], (s) => {
      notice.open = !!s.message;
      notice.kind = s.message?.kind === "danger" ? "danger" : s.message?.kind === "success" ? "success" : "brand";
      noticeMsg.textContent = s.message?.text ?? "";
      loader.hidden = !s.busy;
      addBtn.disabled = s.busy;
      targetStatus.textContent = s.modelTargetStatus;
      save.disabled = !s.pendingModels.length || s.busy;
      pendingList.replaceChildren(...s.pendingModels.map((m) => h("div", { class: "planting" }, h("span", {}, m.fileName))));

      list.replaceChildren(
        ...(s.entries.length
          ? s.entries.map((e) => {
              const vis = h("calcite-action", { icon: e.layer.visible ? "view-visible" : "view-hide", text: "Tampilkan/sembunyikan", scale: "s" });
              vis.addEventListener("click", () => {
                e.layer.visible = !e.layer.visible;
                vis.icon = e.layer.visible ? "view-visible" : "view-hide";
              });
              const zoom = h("calcite-action", { icon: "zoom-to-object", text: "Perbesar ke layer", scale: "s" });
              zoom.addEventListener("click", () => e.layer.fullExtent && void view.goTo(e.layer.fullExtent).catch(() => {}));
              const remove = h("calcite-action", { icon: "trash", text: "Hapus", scale: "s" });
              remove.addEventListener("click", () => {
                map.remove(e.layer);
                if (e.spec.url.startsWith("blob:")) URL.revokeObjectURL(e.spec.url);
                addDataStore.set({ entries: addDataStore.state.entries.filter((x) => x.id !== e.id) });
              });
              return h(
                "div",
                { class: "added-item" },
                h("div", { class: "added-item__text" }, h("strong", {}, e.title), h("span", { class: "muted small" }, `${e.typeLabel}${e.persistent ? "" : " · tidak disimpan"}`)),
                vis,
                zoom,
                remove,
              );
            })
          : [h("div", { class: "muted small" }, "Belum ada data tambahan.")]),
      );
    }, true);

    return h(
      "div",
      { class: "widget" },
      sections,
      serviceBox,
      fileBox,
      modelBox,
      h("div", { class: "row-actions" }, h("span", { class: "section-title" }, "Layer yang ditambahkan"), loader),
      notice,
      list,
    );
  },
};

/** Drag-and-drop target that hands dropped files to `onFiles`. */
function dropZone(text: string, onFiles: (files: File[]) => void): HTMLElement {
  const el = h("div", { class: "drop-zone" }, h("calcite-icon", { icon: "upload", scale: "m" }), h("span", {}, text));
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("drop-zone--over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-zone--over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop-zone--over");
    onFiles([...(e.dataTransfer?.files ?? [])]);
  });
  return el;
}
