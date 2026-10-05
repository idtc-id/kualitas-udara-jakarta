import "@esri/calcite-components/main.css";
import "@arcgis/map-components/main.css";
import "./styles/main.css";
import "./ui/components";

import esriConfig from "@arcgis/core/config";
import Basemap from "@arcgis/core/Basemap";
import Camera from "@arcgis/core/Camera";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import { appConfig } from "./config/app.config";
import { createRegistry } from "./config/modules";
import { DataService } from "./core/dataService";
import type { AppContext } from "./core/modules";
import { Store, type AppState } from "./core/store";
import { defaultRange } from "./core/time";
import { startTimelinePlayer } from "./core/timeline";
import { configureBmkg } from "./providers/weather/bmkg";
import { mountHeader, mountWidgets } from "./ui/shell";
import { mountTimelineDock } from "./ui/timelineDock";

async function bootstrap(): Promise<void> {
  if (import.meta.env.VITE_ARCGIS_API_KEY) esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;
  configureBmkg(appConfig.bmkgBaseUrl);

  const registry = createRegistry();
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  const store = new Store<AppState>({
    mode: "historical",
    range: defaultRange("historical"),
    indicator: "pm2_5",
    timeIndex: 0,
    playing: false,
    speed: 4,
    followLive: false,
    selectedStationId: appConfig.stations[0].id,
    theme: prefersLight ? "light" : "dark",
    basemap: appConfig.basemaps[prefersLight ? "light" : "dark"],
    layerVisibility: Object.fromEntries(registry.layers.map((l) => [l.id, l.visibleByDefault])),
    airQuality: null,
    weather: null,
    bmkg: [],
    loading: false,
    error: null,
    lastUpdated: null,
    layerErrors: {},
    mapTool: null,
  });

  document.title = appConfig.title;
  const logo = document.querySelector("calcite-navigation-logo")!;
  logo.heading = appConfig.title;
  logo.description = appConfig.subtitle;

  store.on(
    ["theme"],
    (s) => {
      document.body.classList.toggle("calcite-mode-dark", s.theme === "dark");
      document.body.classList.toggle("calcite-mode-light", s.theme === "light");
    },
    true,
  );

  const sceneEl = document.querySelector("arcgis-scene")!;
  // "item:<id>" = a Web Scene / Web Map portal item used as basemap.
  const toBasemap = (id: string) => (id.startsWith("item:") ? new Basemap({ portalItem: { id: id.slice(5) } }) : id);
  sceneEl.basemap = toBasemap(store.state.basemap);
  sceneEl.ground = "world-elevation";
  // Explicit spatial reference: the view still becomes ready if the basemap is unreachable.
  sceneEl.spatialReference = SpatialReference.WebMercator;
  const { longitude, latitude, z, heading, tilt } = appConfig.camera;
  sceneEl.camera = new Camera({ position: { longitude, latitude, z }, heading, tilt });
  await sceneEl.viewOnReady();

  const view = sceneEl.view;
  const map = view.map!;
  store.on(["basemap"], (s) => (map.basemap = toBasemap(s.basemap) as never));
  // Follow the theme only while the user is on one of the theme defaults.
  store.on(["theme"], (s) => {
    const defaults = [...Object.values(appConfig.basemaps), ...Object.values(appConfig.fallbackBasemaps)];
    if (!defaults.includes(s.basemap)) return;
    const fallback = Object.values(appConfig.fallbackBasemaps).includes(s.basemap);
    store.set({ basemap: (fallback ? appConfig.fallbackBasemaps : appConfig.basemaps)[s.theme] });
  });

  const data = new DataService(appConfig, store, registry);
  const ctx: AppContext = { config: appConfig, store, data, view, map };
  if (import.meta.env.DEV) {
    const [{ windStore }, { greeningStore }] = await Promise.all([import("./wind/state"), import("./greening/state")]);
    Object.assign(window, { __twin: { ...ctx, windStore, greeningStore } });
  }
  store.on(["mapTool"], (s) => sceneEl.classList.toggle("tool-active", !!s.mapTool));

  for (const layer of registry.layers) {
    try {
      await layer.init(ctx);
    } catch (err) {
      console.error(`Layer "${layer.id}" failed to initialise`, err);
    }
  }
  store.on(["layerVisibility"], (s) => registry.layers.forEach((l) => l.setVisible(s.layerVisibility[l.id] ?? l.visibleByDefault)), true);

  mountHeader(ctx, document.getElementById("header-controls")!);
  mountWidgets(ctx, registry.widgets, document.getElementById("panel-start")!, document.getElementById("panel-end")!);
  mountTimelineDock(ctx, document.getElementById("dock")!);
  startTimelinePlayer(store);

  document.getElementById("boot")?.remove();
  await data.load();
}

bootstrap().catch((err) => {
  console.error(err);
  const boot = document.getElementById("boot-msg");
  if (boot) boot.textContent = `Gagal memuat aplikasi: ${err instanceof Error ? err.message : String(err)}`;
});
