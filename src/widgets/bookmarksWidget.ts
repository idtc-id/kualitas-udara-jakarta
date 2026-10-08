import Camera from "@arcgis/core/Camera";
import Viewpoint from "@arcgis/core/Viewpoint";
import Bookmark from "@arcgis/core/webmap/Bookmark";
import type { AppConfig } from "../config/app.config";
import type { WidgetModule } from "../core/modules";
import type { MonitoringStation } from "../core/types";
import { cameraAt } from "../core/camera";
import { h } from "../ui/dom";

const STORAGE_KEY = "dt-airpolution:bookmarks";
const KIND_LABEL: Record<MonitoringStation["kind"], string> = { spku: "SPKU", embassy: "US Embassy", model: "titik model" };

/** Default bookmarks: a city overview plus every real air quality sensor (SPKU, US Embassy). */
export function defaultBookmarks(config: AppConfig): Bookmark[] {
  const { longitude, latitude, z, heading, tilt } = config.camera;
  const overview = new Bookmark({
    name: "Seluruh DKI Jakarta",
    viewpoint: new Viewpoint({ camera: new Camera({ position: { longitude, latitude, z }, heading, tilt }) }),
  });
  const sensors = config.stations
    .filter((s) => s.kind !== "model")
    .map(
      (s) =>
        new Bookmark({
          name: `${s.name} · ${KIND_LABEL[s.kind]}${s.district ? ` · ${s.district}` : ""}`,
          viewpoint: new Viewpoint({ camera: cameraAt(s.longitude, s.latitude) }),
        }),
    );
  return [overview, ...sensors];
}

function loadSaved(): Bookmark[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as unknown[]).map((j) => Bookmark.fromJSON(j)) : null;
  } catch {
    return null;
  }
}

function save(bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks.map((b) => b.toJSON())));
  } catch {
    // Quota exceeded (large thumbnails) or storage unavailable: keep without thumbnails.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks.map((b) => ({ ...b.toJSON(), thumbnail: undefined }))));
    } catch {
      /* storage unavailable */
    }
  }
}

/** Bookmarks (arcgis-bookmarks): sensor locations by default, user bookmarks saved in the browser. */
export const bookmarksWidget: WidgetModule = {
  id: "bookmarks",
  title: "Bookmark",
  icon: "bookmark",
  placement: "start",

  create({ view, config }) {
    const el = document.createElement("arcgis-bookmarks");
    el.view = view;
    el.showAddBookmarkButton = true;
    el.showEditBookmarkButton = true;
    el.showFilter = true;
    el.dragEnabled = true;
    el.timeDisabled = true;
    el.showHeading = false;
    el.bookmarks = loadSaved() ?? defaultBookmarks(config);

    // Persist any change (add, edit, delete, reorder) made in the widget.
    let watching = el.bookmarks;
    const persist = () => save(el.bookmarks.toArray());
    let handle = watching.on("change", persist);
    el.addEventListener("arcgisBookmarkEdit", persist);

    const reset = h("calcite-button", { iconStart: "reset", scale: "s", appearance: "transparent", width: "full" }, "Pulihkan bookmark sensor bawaan");
    reset.addEventListener("click", () => {
      handle.remove();
      localStorage.removeItem(STORAGE_KEY);
      el.bookmarks = defaultBookmarks(config);
      watching = el.bookmarks;
      handle = watching.on("change", persist);
    });

    return h(
      "div",
      { class: "widget widget--flush" },
      el,
      h(
        "div",
        { class: "widget-section" },
        h("p", { class: "muted small" }, "Bawaan: pandangan seluruh Jakarta dan setiap sensor kualitas udara (SPKU dan US Embassy). Tambah bookmark dari tampilan saat ini dengan tombol +; perubahan disimpan di browser ini."),
        reset,
      ),
    );
  },
};
