import type { LayerModule, WidgetModule } from "../core/modules";
import { h } from "../ui/dom";

/** Generic layer list: one switch per registered layer module, plus its legend and controls. */
export function createLayersWidget(layers: LayerModule[]): WidgetModule {
  return {
    id: "layers",
    title: "Layer & legenda",
    icon: "layers",
    placement: "start",

    create({ store }) {
      const blocks = layers.map((layer) => {
        const toggle = h("calcite-switch", { checked: store.state.layerVisibility[layer.id] ?? layer.visibleByDefault, label: layer.title });
        toggle.addEventListener("calciteSwitchChange", () => {
          store.set({ layerVisibility: { ...store.state.layerVisibility, [layer.id]: toggle.checked } });
        });

        const legend = layer.legend?.length
          ? h(
              "ul",
              { class: "legend" },
              ...layer.legend.map((item) =>
                h(
                  "li",
                  {},
                  item.color ? h("span", { class: "swatch", style: `background:${item.color}` }) : null,
                  item.icon ? h("calcite-icon", { icon: item.icon, scale: "s" }) : null,
                  h("span", {}, item.label),
                ),
              ),
            )
          : null;

        const controls = (layer.controls ?? []).map((c) => {
          const slider = h("calcite-slider", { min: c.min, max: c.max, step: c.step, value: c.value, scale: "s", labelText: c.label });
          slider.addEventListener("calciteSliderInput", () => c.onChange(Number(slider.value)));
          return h("calcite-label", { scale: "s" }, c.label, slider);
        });

        return h(
          "calcite-block",
          { heading: layer.title, description: layer.description ?? "", expanded: !!legend || controls.length > 0, collapsible: true },
          h("div", { slot: "actions-end", class: "block-switch" }, toggle),
          ...controls,
          legend,
        );
      });

      return h("div", { class: "widget widget--flush" }, ...blocks);
    },
  };
}
