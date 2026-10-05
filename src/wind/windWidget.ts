import type { WidgetModule } from "../core/modules";
import { formatDateTime } from "../core/time";
import { slotAt } from "../providers/weather/bmkg";
import { compassLabel } from "../providers/weather/conditions";
import { cityWeather } from "../core/selectors";
import { h } from "../ui/dom";
import { windStore } from "./state";

/** Wind simulation controls: data source, building effect, what-if buildings, animation settings. */
export const windWidget: WidgetModule = {
  id: "wind",
  title: "Simulasi angin",
  icon: "wind",
  placement: "start",

  create({ store, config }) {
    const source = h("div", { class: "hero__weather" });

    const flowToggle = h("calcite-switch", { checked: true, label: "Animasi aliran angin" });
    flowToggle.addEventListener("calciteSwitchChange", () =>
      store.set({ layerVisibility: { ...store.state.layerVisibility, "wind-flow": flowToggle.checked } }),
    );
    store.on(["layerVisibility"], (s) => (flowToggle.checked = s.layerVisibility["wind-flow"] ?? true), true);

    const effect = h("calcite-switch", { checked: windStore.state.buildingEffect, label: "Efek gedung & pohon" });
    effect.addEventListener("calciteSwitchChange", () => windStore.set({ buildingEffect: effect.checked }));
    const detail = h("calcite-switch", { checked: windStore.state.detail, label: "Grid detail saat zoom" });
    detail.addEventListener("calciteSwitchChange", () => windStore.set({ detail: detail.checked }));

    const stats = h("div", { class: "hero__meta" });

    // What-if building tool
    const height = h("calcite-slider", { min: 10, max: 400, step: 10, value: windStore.state.placeHeight, labelHandles: true, scale: "s", attrs: { "aria-label": "Tinggi gedung (m)" } });
    height.addEventListener("calciteSliderChange", () => windStore.set({ placeHeight: Number(height.value) }));
    const size = h("calcite-slider", { min: 10, max: 200, step: 5, value: windStore.state.placeSize, labelHandles: true, scale: "s", attrs: { "aria-label": "Lebar gedung (m)" } });
    size.addEventListener("calciteSliderChange", () => windStore.set({ placeSize: Number(size.value) }));
    const place = h("calcite-button", { iconStart: "pin-plus", scale: "s", width: "full" });
    place.addEventListener("click", () => store.set({ mapTool: store.state.mapTool === "place-building" ? null : "place-building" }));
    store.on(["mapTool"], (s) => {
      const on = s.mapTool === "place-building";
      place.textContent = on ? "Selesai (klik peta untuk menaruh gedung)" : "Tambah gedung what-if dengan klik";
      place.appearance = on ? "solid" : "outline";
      place.kind = on ? "brand" : "neutral";
    }, true);
    const clear = h("calcite-button", { iconStart: "trash", scale: "s", appearance: "transparent", kind: "danger" }, "Hapus gedung what-if");
    clear.addEventListener("click", () => windStore.set({ whatIf: [] }));
    const whatIfCount = h("div", { class: "muted small" });

    // Animation settings
    const slider = (label: string, key: "density" | "flowSpeed" | "trailLength", min: number, max: number, step: number) => {
      const el = h("calcite-slider", { min, max, step, value: windStore.state[key], scale: "s", attrs: { "aria-label": label } });
      el.addEventListener("calciteSliderChange", () => windStore.set({ [key]: Number(el.value) }));
      return h("calcite-label", { scale: "s" }, label, el);
    };

    const render = () => {
      const s = store.state;
      const t = s.airQuality?.times[s.timeIndex] ?? Date.now();
      const bmkgCount = config.weatherLocations.filter((loc) => {
        const fc = s.bmkg.find((b) => b.location.id === loc.id);
        return fc && slotAt(fc, t);
      }).length;
      const w = cityWeather(s);
      const src = bmkgCount
        ? `BMKG (${bmkgCount}/${config.weatherLocations.length} titik)`
        : s.weather?.synthetic
          ? "data sintetis (contoh)"
          : "Open-Meteo (BMKG tidak menyediakan data historis untuk jam ini)";
      source.replaceChildren(
        h("span", {}, h("strong", {}, "Sumber angin: "), src),
        h("span", { class: "muted" }, formatDateTime(t)),
        w ? h("span", {}, `${w.windSpeed?.toFixed(1) ?? "–"} m/s dari ${compassLabel(w.windDirection)} (${Math.round(w.windDirection ?? 0)}°)`) : h("span", {}, "–"),
      );

      const ws = windStore.state;
      const st = ws.stats;
      stats.replaceChildren(
        h("div", { class: "muted small" }, ws.gridInfo),
        h("div", {}, h("span", { class: "muted" }, "Gedung dari scene "), h("strong", {}, ws.sceneBuildings.toLocaleString("id-ID")), h("span", { class: "muted" }, ws.sceneBuildings ? "" : " (zoom ke kawasan agar gedung terbaca)")),
        ...(st && ws.buildingEffect
          ? [
              h("div", {}, h("span", { class: "muted" }, "Kecepatan rata-rata vs tanpa penghalang "), h("strong", {}, `${Math.round(st.speedRatio * 100)}%`)),
              h("div", {}, h("span", { class: "muted" }, "Area angin lemah (< 50%) "), h("strong", {}, `${Math.round(st.calmShare * 100)}%`)),
            ]
          : []),
      );
      whatIfCount.textContent = `${ws.whatIf.length} gedung what-if`;
    };
    store.on(["weather", "bmkg", "timeIndex"], render, true);
    windStore.on(["stats", "sceneBuildings", "gridInfo", "whatIf", "buildingEffect"], render);

    return h(
      "div",
      { class: "widget" },
      source,
      h("div", { class: "switch-row" }, flowToggle, h("span", {}, "Animasi aliran angin")),
      h("div", { class: "switch-row" }, effect, h("span", {}, "Efek gedung & pohon")),
      h("div", { class: "switch-row" }, detail, h("span", {}, "Grid detail saat zoom (< 6 km)")),
      stats,
      h("div", { class: "section-title" }, "Gedung what-if"),
      h("calcite-label", { scale: "s" }, "Tinggi (m)", height),
      h("calcite-label", { scale: "s" }, "Lebar (m)", size),
      place,
      h("div", { class: "row-actions" }, whatIfCount, clear),
      h("div", { class: "section-title" }, "Tampilan animasi"),
      slider("Kepadatan partikel", "density", 0.1, 1, 0.05),
      slider("Kecepatan animasi", "flowSpeed", 1, 40, 1),
      slider("Panjang jejak", "trailLength", 20, 1500, 10),
      h(
        "p",
        { class: "muted small" },
        "Model sederhana (bukan CFD): angin 10 m diinterpolasi dari titik cuaca, nol di dalam gedung, melemah di belakang gedung (rasio tinggi/jarak), dan dibelokkan di sekitar gedung. Gedung dibaca dari layer 3D yang sedang tampil, jadi zoom ke kawasan untuk hasil detail.",
      ),
    );
  },
};
