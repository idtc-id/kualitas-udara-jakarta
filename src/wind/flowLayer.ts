import Graphic from "@arcgis/core/Graphic";
import Extent from "@arcgis/core/geometry/Extent";
import Polygon from "@arcgis/core/geometry/Polygon";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import ImageryTileLayer from "@arcgis/core/layers/ImageryTileLayer";
import PixelBlock from "@arcgis/core/layers/support/PixelBlock";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import FlowRenderer from "@arcgis/core/renderers/FlowRenderer";
import { fromMercator, toMercator } from "../core/geo";
import type { LayerModule } from "../core/modules";
import { weatherAt } from "../core/selectors";
import { greeningStore } from "../greening/state";
import { sceneBuildingObstacles, treeObstacles, whatIfObstacles, type Obstacle } from "./obstacles";
import { windStore } from "./state";
import type { BasePoint, Grid, WindFieldResult } from "./windField";
import type { WindJob } from "./windWorker";

/** Run the wind model off the main thread; only the latest job's result is used. */
const worker = new Worker(new URL("./windWorker.ts", import.meta.url), { type: "module" });
let jobId = 0;
const pending = new Map<number, (r: WindFieldResult) => void>();
worker.onmessage = (e: MessageEvent<WindFieldResult & { id: number }>) => {
  pending.get(e.data.id)?.(e.data);
  pending.delete(e.data.id);
};
function computeInWorker(job: Omit<WindJob, "id">): Promise<WindFieldResult> {
  const id = ++jobId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, ...job });
  });
}

const CITY_CELL = 60; // m, whole-city grid
const DETAIL_MAX_ALTITUDE = 6000; // m camera height below which the local fine grid is used
const DETAIL_PIXELS = 640;

/** Sequential ramp by wind speed (m/s), one hue light→dark per theme. */
const RAMPS = {
  dark: [
    { value: 0.5, color: [110, 165, 230, 0.8] },
    { value: 2, color: [140, 205, 255, 1] },
    { value: 4, color: [200, 235, 255, 1] },
    { value: 7, color: [255, 255, 255, 1] },
  ],
  light: [
    { value: 0.5, color: [150, 190, 230, 0.7] },
    { value: 2, color: [60, 130, 210, 0.9] },
    { value: 4, color: [20, 80, 170, 1] },
    { value: 7, color: [8, 40, 100, 1] },
  ],
};

/**
 * Animated wind streamlines (FlowRenderer) driven by the twin's weather data
 * (BMKG for forecast hours, Open-Meteo for history), modified by buildings,
 * what-if buildings and planted trees. The vector field is computed in the
 * browser and fed to an in-memory ImageryTileLayer ("vector-uv").
 */
export function createFlowLayer(): LayerModule {
  let visible = true;
  let flow: ImageryTileLayer | null = null;
  let requestBuild: () => void = () => {};
  const whatIfLayer = new GraphicsLayer({ title: "Gedung what-if", elevationInfo: { mode: "on-the-ground" } });

  return {
    id: "wind-flow",
    title: "Aliran angin (animasi)",
    description: "Partikel angin seperti windy.com. Data BMKG (prakiraan) / Open-Meteo (historis), terhalang gedung & pohon.",
    visibleByDefault: true,
    legend: [
      { label: "< 1 m/s (tenang)", color: "#5a8cc8" },
      { label: "2 m/s", color: "#78beff" },
      { label: "4 m/s", color: "#c8ebff" },
      { label: "≥ 7 m/s", color: "#ffffff" },
    ],

    init({ map, view, store, config }) {
      map.add(whatIfLayer);
      let obstacles: Obstacle[] = [];
      let obstaclesKey = "";
      let rebuildTimer = 0;
      let lastBuild = 0;
      let controller: AbortController | null = null;

      const chooseGrid = (): { grid: Grid; key: string; extent: Extent; detail: boolean } => {
        const z = view.camera?.position?.z ?? Infinity;
        if (windStore.state.detail && z < DETAIL_MAX_ALTITUDE && view.center) {
          const [cx, cy] = toMercator(view.center.longitude!, view.center.latitude!);
          const half = Math.min(3000, Math.max(500, z * 0.9));
          const cs = Math.max(3, (2 * half) / DETAIL_PIXELS);
          const w = Math.round((2 * half) / cs);
          const grid = { xmin: cx - half, ymax: cy + half, cellSize: cs, width: w, height: w };
          const extent = new Extent({ xmin: cx - half, ymin: cy - half, xmax: cx + half, ymax: cy + half, spatialReference: SpatialReference.WebMercator });
          return { grid, extent, detail: true, key: `d|${Math.round(cx / 200)}|${Math.round(cy / 200)}|${Math.round(half / 100)}` };
        }
        const [x0, y0] = toMercator(config.extent[0] - 0.03, config.extent[1] - 0.03);
        const [x1, y1] = toMercator(config.extent[2] + 0.03, config.extent[3] + 0.03);
        const w = Math.round((x1 - x0) / CITY_CELL);
        const h = Math.round((y1 - y0) / CITY_CELL);
        const grid = { xmin: x0, ymax: y1, cellSize: CITY_CELL, width: w, height: h };
        const extent = new Extent({ xmin: x0, ymin: y1 - h * CITY_CELL, xmax: x0 + w * CITY_CELL, ymax: y1, spatialReference: SpatialReference.WebMercator });
        return { grid, extent, detail: false, key: "city" };
      };

      const basePoints = (): BasePoint[] => {
        const samples = weatherAt(store.state);
        return config.weatherLocations.flatMap((loc) => {
          const w = samples[loc.id];
          if (w?.windSpeed == null || w.windDirection == null) return [];
          const to = ((w.windDirection + 180) * Math.PI) / 180;
          const [x, y] = toMercator(loc.longitude, loc.latitude);
          return [{ x, y, u: Math.sin(to) * w.windSpeed, v: Math.cos(to) * w.windSpeed }];
        });
      };

      const renderer = () => {
        const s = windStore.state;
        return new FlowRenderer({
          density: s.density,
          flowSpeed: s.flowSpeed,
          trailLength: s.trailLength,
          trailWidth: "2.5px",
          flowRepresentation: "flow-to",
          visualVariables: [{ type: "color", field: "Magnitude", stops: RAMPS[store.state.theme] }],
        });
      };

      const build = async () => {
        if (!visible) return;
        controller?.abort();
        const ctrl = new AbortController();
        controller = ctrl;
        const base = basePoints();
        if (!base.length) {
          if (flow) map.remove(flow);
          flow = null;
          return;
        }
        const { grid, extent, detail, key } = chooseGrid();

        // Real buildings are only read for the fine local grid (where they matter and are loaded).
        if (windStore.state.buildingEffect && detail && key !== obstaclesKey) {
          try {
            obstacles = await sceneBuildingObstacles(view, extent, ctrl.signal);
            obstaclesKey = key;
          } catch {
            return; // aborted
          }
        } else if (!detail) {
          obstacles = [];
          obstaclesKey = "";
        }
        if (ctrl.signal.aborted) return;

        const g = greeningStore.state;
        const all = windStore.state.buildingEffect
          ? [...obstacles, ...whatIfObstacles(windStore.state.whatIf), ...treeObstacles(g.plantings, g.species)]
          : [];
        const field = await computeInWorker({ grid, base, obstacles: all, buildingEffect: windStore.state.buildingEffect });
        if (ctrl.signal.aborted) return;
        windStore.set({
          stats: field.stats,
          sceneBuildings: obstacles.length,
          gridInfo: detail ? `Grid detail ${grid.width}×${grid.height} @ ${grid.cellSize.toFixed(1)} m` : `Grid kota ${grid.width}×${grid.height} @ ${CITY_CELL} m`,
        });

        const pixelBlock = new PixelBlock({
          width: grid.width,
          height: grid.height,
          pixelType: "f32",
          pixels: [field.u, field.v],
          mask: field.mask,
          statistics: [
            { minValue: -20, maxValue: 20 },
            { minValue: -20, maxValue: 20 },
          ],
        });
        const next = new ImageryTileLayer({
          title: "Aliran angin",
          // `dataType` marks the two bands as a u/v vector field (read by the in-memory raster).
          source: { extent, pixelBlock, dataType: "vector-uv" } as never,
          renderer: renderer(),
          popupEnabled: false,
          listMode: "hide",
        });
        map.add(next);
        try {
          await view.whenLayerView(next);
        } catch (err) {
          console.warn("Wind flow layer failed", err);
        }
        if (ctrl.signal.aborted) {
          map.remove(next);
          return;
        }
        const old = flow;
        flow = next;
        // Remove the previous field a moment later so the animation doesn't blink.
        if (old) setTimeout(() => map.remove(old), 400);
        lastBuild = performance.now();
      };

      /** Debounce rebuilds; while the timeline plays, rebuild at most once per second. */
      const schedule = (delay = 250) => {
        window.clearTimeout(rebuildTimer);
        const wait = store.state.playing ? Math.max(delay, 1000 - (performance.now() - lastBuild)) : delay;
        rebuildTimer = window.setTimeout(() => void build(), wait);
      };

      store.on(["weather", "timeIndex"], () => schedule());
      store.on(["theme"], () => flow && (flow.renderer = renderer()));
      windStore.on(["density", "flowSpeed", "trailLength"], () => flow && (flow.renderer = renderer()));
      windStore.on(["buildingEffect", "detail", "whatIf"], () => {
        obstaclesKey = "";
        schedule(50);
      });
      greeningStore.on(["plantings"], () => schedule());
      // Camera moved: new grid; also give scene layers time to load their buildings.
      reactiveUtils.watch(
        () => view.stationary,
        (stationary) => {
          if (!stationary) return;
          schedule(300);
          window.setTimeout(() => {
            obstaclesKey = "";
            schedule(0);
          }, 2500);
        },
      );

      // What-if buildings: render + place by click.
      const renderWhatIf = () => {
        whatIfLayer.removeAll();
        whatIfLayer.addMany(
          windStore.state.whatIf.map((b) => {
            const [x, y] = toMercator(b.longitude, b.latitude);
            const half = b.sizeM / 2 / Math.cos((b.latitude * Math.PI) / 180);
            const ring = [
              [x - half, y - half],
              [x - half, y + half],
              [x + half, y + half],
              [x + half, y - half],
              [x - half, y - half],
            ].map(([px, py]) => fromMercator(px, py));
            return new Graphic({
              geometry: new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } }),
              symbol: {
                type: "polygon-3d",
                symbolLayers: [{ type: "extrude", size: b.heightM, material: { color: [255, 170, 60, 0.85] }, edges: { type: "solid", color: [60, 30, 0, 0.6], size: 1 } }],
              } as never,
              attributes: { id: b.id },
            });
          }),
        );
      };
      windStore.on(["whatIf"], renderWhatIf, true);

      view.on("click", (event) => {
        if (store.state.mapTool !== "place-building" || !event.mapPoint) return;
        event.stopPropagation();
        const s = windStore.state;
        windStore.set({
          whatIf: [
            ...s.whatIf,
            { id: `g${Date.now().toString(36)}`, longitude: event.mapPoint.longitude!, latitude: event.mapPoint.latitude!, heightM: s.placeHeight, sizeM: s.placeSize },
          ],
        });
      });

      requestBuild = () => schedule(0);
      schedule(500);
    },

    setVisible(value) {
      visible = value;
      whatIfLayer.visible = value;
      if (flow) flow.visible = value;
      if (value && !flow) requestBuild();
    },
  };
}
