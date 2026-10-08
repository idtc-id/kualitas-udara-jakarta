import type { WidgetModule } from "../core/modules";
import { h } from "../ui/dom";
import { transitActions } from "./transitLayer";
import { transitStore } from "./state";

/** Transjakarta routes in 3D: service URL, colour field, path style, bus animation, route legend. */
export const transitWidget: WidgetModule = {
  id: "transit",
  title: "Rute Transjakarta 3D",
  icon: "road-sign",
  placement: "start",

  create({ store, config }) {
    const show = h("calcite-switch", { checked: !!store.state.layerVisibility.transit, label: "Tampilkan rute 3D" });
    show.addEventListener("calciteSwitchChange", () => store.set({ layerVisibility: { ...store.state.layerVisibility, transit: show.checked } }));
    store.on(["layerVisibility"], (s) => (show.checked = !!s.layerVisibility.transit), true);

    const url = h("calcite-input-text", { scale: "s", value: config.transitServiceUrl });
    const reload = h("calcite-button", { iconStart: "refresh", scale: "s", appearance: "outline" }, "Muat");
    reload.addEventListener("click", () => void transitActions.reload(url.value));

    const status = h("div", { class: "muted small" });
    const error = h("calcite-notice", { kind: "danger", scale: "s", width: "full", icon: "x-octagon", open: false });
    const errorMsg = h("div", { slot: "message" });
    error.append(errorMsg);
    const loader = h("calcite-loader", { inline: true, label: "Memuat rute", hidden: true });

    const field = h("calcite-select", { label: "Warna berdasarkan", scale: "s" });
    field.addEventListener("calciteSelectChange", () => transitStore.set({ colorField: field.value, focus: null }));

    const profile = h("calcite-segmented-control", { scale: "s", width: "full", attrs: { "aria-label": "Bentuk jalur" } });
    profile.append(
      h("calcite-segmented-control-item", { value: "circle", checked: transitStore.state.profile === "circle" }, "Tabung"),
      h("calcite-segmented-control-item", { value: "quad", checked: transitStore.state.profile === "quad" }, "Pita"),
    );
    profile.addEventListener("calciteSegmentedControlChange", () => transitStore.set({ profile: profile.value as "circle" | "quad" }));

    const slider = (label: string, key: "width" | "offset" | "busCount" | "busSpeed", min: number, max: number, step: number) => {
      const el = h("calcite-slider", { min, max, step, value: transitStore.state[key], labelHandles: true, scale: "s", attrs: { "aria-label": label } });
      el.addEventListener("calciteSliderChange", () => {
        const v = Number(el.value);
        transitStore.set(key === "width" ? { width: v, height: v, autoWidth: false } : { [key]: v });
      });
      return h("calcite-label", { scale: "s" }, label, el);
    };

    const auto = h("calcite-switch", { checked: transitStore.state.autoWidth, label: "Lebar otomatis menurut zoom" });
    auto.addEventListener("calciteSwitchChange", () => transitStore.set({ autoWidth: auto.checked }));

    const buses = h("calcite-switch", { checked: transitStore.state.buses, label: "Animasi bus" });
    buses.addEventListener("calciteSwitchChange", () => transitStore.set({ buses: buses.checked }));

    const stats = h("div", { class: "hero__meta" });
    const legend = h("div", { class: "route-legend" });

    transitStore.on(null, (s) => {
      status.textContent = s.status;
      error.open = !!s.error;
      errorMsg.textContent = s.error ?? "";
      loader.hidden = !s.loading;
      if (field.childElementCount !== s.fields.length) {
        field.replaceChildren(...s.fields.map((f) => h("calcite-option", { value: f.name }, f.alias === f.name ? f.name : `${f.alias} (${f.name})`)));
      }
      if (s.colorField) field.value = s.colorField;
      stats.replaceChildren(
        h("div", {}, h("span", { class: "muted" }, "Segmen rute "), h("strong", {}, s.routeCount.toLocaleString("id-ID"))),
        h("div", {}, h("span", { class: "muted" }, "Panjang jaringan "), h("strong", {}, `${s.totalKm.toLocaleString("id-ID")} km`)),
        h("div", {}, h("span", { class: "muted" }, "Layer "), h("strong", {}, `${s.routeLayers.length} rute · ${s.stopLayers.length} halte`)),
      );
      const top = s.classes.filter((c) => c.color !== "#8a8f98");
      const others = s.classes.length - top.length;
      legend.replaceChildren(
        ...top.map((c) => {
          const row = h(
            "button",
            { class: `route-legend__item${s.focus === c.value ? " is-active" : ""}`, type: "button", title: "Klik untuk menyorot rute ini" },
            h("span", { class: "swatch", style: `background:${c.color}` }),
            h("span", { class: "route-legend__label" }, c.label),
            h("span", { class: "muted small" }, String(c.count)),
          );
          row.addEventListener("click", () => transitStore.set({ focus: transitStore.state.focus === c.value ? null : c.value }));
          return row;
        }),
        ...(others > 0 ? [h("div", { class: "route-legend__item" }, h("span", { class: "swatch", style: "background:#8a8f98" }), h("span", { class: "route-legend__label" }, `Lainnya (${others} rute)`))] : []),
      );
    }, true);

    return h(
      "div",
      { class: "widget" },
      h("div", { class: "switch-row" }, show, h("span", {}, "Tampilkan rute 3D")),
      h("calcite-label", { scale: "s" }, "Layanan rute (ArcGIS MapServer / FeatureServer)", h("div", { class: "input-row" }, url, reload)),
      h("div", { class: "row-actions" }, status, loader),
      error,
      stats,
      h("calcite-label", { scale: "s" }, "Warna berdasarkan field", field),
      h("div", { class: "section-title" }, "Rute (klik untuk menyorot)"),
      legend,
      h("div", { class: "section-title" }, "Gaya jalur 3D"),
      profile,
      h("div", { class: "switch-row" }, auto, h("span", {}, "Lebar otomatis menurut zoom")),
      slider("Lebar jalur (m)", "width", 4, 80, 1),
      slider("Ketinggian di atas jalan (m)", "offset", 0, 120, 2),
      h("div", { class: "section-title" }, "Bus"),
      h("div", { class: "switch-row" }, buses, h("span", {}, "Animasi bus bergerak di sepanjang rute")),
      slider("Jumlah bus", "busCount", 10, 600, 10),
      slider("Kecepatan animasi (× 20 km/j)", "busSpeed", 1, 120, 1),
      h(
        "p",
        { class: "muted small" },
        "Rute digambar dengan PathSymbol3DLayer (tabung/pita 3D) dan diwarnai per rute: 8 rute terbanyak memakai warna kategorikal, sisanya abu-abu. Bus adalah animasi ilustratif (bukan posisi GPS real-time). Sumber: Jakarta Satu.",
      ),
    );
  },
};
