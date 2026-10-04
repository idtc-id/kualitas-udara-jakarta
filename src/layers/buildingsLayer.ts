import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import type Layer from "@arcgis/core/layers/Layer";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer";
import SolidEdges3D from "@arcgis/core/symbols/edges/SolidEdges3D";
import type { LayerModule } from "../core/modules";

/** 3D city model. The source is chosen in appConfig.buildings. */
export function createBuildingsLayer(): LayerModule {
  let layer: Layer | null = null;

  const meshRenderer = (theme: "dark" | "light") =>
    new SimpleRenderer({
      symbol: {
        type: "mesh-3d",
        symbolLayers: [
          {
            type: "fill",
            material: { color: theme === "dark" ? [150, 160, 175, 1] : [235, 237, 240, 1], colorMixMode: "replace" },
            edges: new SolidEdges3D({ color: theme === "dark" ? [20, 24, 32, 0.5] : [80, 80, 80, 0.35], size: 0.6 }),
          },
        ],
      },
    });

  return {
    id: "buildings",
    title: "Bangunan 3D",
    description: "Model kota 3D (default: OpenStreetMap 3D Buildings).",
    visibleByDefault: true,

    async init({ config, map, store }) {
      const src = config.buildings;
      if (src.type === "geojson") {
        layer = new GeoJSONLayer({
          url: src.url,
          title: "Bangunan 3D",
          renderer: new SimpleRenderer({
            symbol: { type: "polygon-3d", symbolLayers: [{ type: "extrude", material: { color: [190, 196, 205, 1] } }] },
            visualVariables: [
              {
                type: "size",
                valueExpression: `DefaultValue($feature["${src.heightField}"], ${src.defaultHeight ?? 9})`,
                valueUnit: "meters",
              },
            ],
          }),
        });
      } else {
        const scene =
          src.type === "portal-item"
            ? new SceneLayer({ portalItem: { id: src.id, ...(src.portalUrl ? { portal: { url: src.portalUrl } } : {}) } })
            : new SceneLayer({ url: src.url });
        scene.title = "Bangunan 3D";
        scene.popupEnabled = false;
        store.on(["theme"], (s) => (scene.renderer = meshRenderer(s.theme)), true);
        layer = scene;
      }
      layer.visible = store.state.layerVisibility.buildings ?? true;
      map.add(layer, 0);
      layer.load().catch((err) => console.warn("Building layer failed to load", err));
    },

    setVisible(visible) {
      if (layer) layer.visible = visible;
    },
  };
}
