import Graphic from "@arcgis/core/Graphic";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import Point from "@arcgis/core/geometry/Point";
import type Polyline from "@arcgis/core/geometry/Polyline";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GroupLayer from "@arcgis/core/layers/GroupLayer";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer";
import esriRequest from "@arcgis/core/request";
import LineSymbol3D from "@arcgis/core/symbols/LineSymbol3D";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import type { LayerModule } from "../core/modules";
import { OTHER_COLOR, ROUTE_COLORS, transitStore, type RouteClass } from "./state";

/**
 * Transjakarta routes in 3D: every polyline sublayer of the route service is
 * drawn with a PathSymbol3DLayer (tube / ribbon, see the ArcGIS "Visualize
 * features with 3D paths" sample), lifted above the street and coloured per
 * route; stop sublayers become small 3D markers. Animated buses run along the
 * routes. The service structure (sublayers, field names) is discovered at
 * runtime, so another route service can be plugged in by URL.
 */

const FIELD_HINT = /koridor|corridor|rute|route|trayek|jurusan|kode|code|nama|name|layanan|line/i;
const MAX_BUS_ROUTES = 400;

interface RoutePath {
  value: string;
  coords: [number, number][];
  /** Cumulative length (m) at each vertex. */
  cum: number[];
  length: number;
}

interface Bus {
  path: RoutePath;
  /** Distance along the path (m). */
  s: number;
  dir: 1 | -1;
  graphic: Graphic;
}

const metres = (a: [number, number], b: [number, number]) => {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot((b[0] - a[0]) * 111_320 * k, (b[1] - a[1]) * 110_574);
};

function routeSymbol(color: string, s: { profile: "circle" | "quad"; width: number; height: number }, dim = false) {
  return new LineSymbol3D({
    symbolLayers: [
      {
        type: "path",
        profile: s.profile,
        width: s.width,
        height: s.profile === "quad" ? Math.max(2, s.height * 0.35) : s.height,
        anchor: "center",
        cap: "round",
        join: "round",
        profileRotation: s.profile === "quad" ? "heading" : "all",
        material: { color: dim ? [140, 143, 152, 0.18] : color },
        castShadows: false,
      },
    ],
  });
}

export function createTransitLayer(defaultUrl: string): LayerModule {
  const group = new GroupLayer({ title: "Rute Transjakarta (3D)", visibilityMode: "independent" });
  const busLayer = new GraphicsLayer({ title: "Bus (animasi)", elevationInfo: { mode: "relative-to-ground" } });
  let routeLayers: FeatureLayer[] = [];
  let paths: RoutePath[] = [];
  let buses: Bus[] = [];
  let visible = true;

  const busSymbols = new Map<string, PointSymbol3D>();
  const busSymbol = (color: string, heading: number) => {
    const h = Math.round(heading / 15) * 15;
    const key = `${color}|${h}`;
    let sym = busSymbols.get(key);
    if (!sym) {
      // Bus size follows the path width so buses stay visible when zoomed out.
      const k = Math.max(1, transitStore.state.width / 14);
      sym = new PointSymbol3D({
        symbolLayers: [{ type: "object", resource: { primitive: "cube" }, width: 4 * k, depth: 14 * k, height: 4 * k, heading: h, anchor: "bottom", material: { color } }],
      });
      busSymbols.set(key, sym);
    }
    return sym;
  };

  const classColor = (value: string) => transitStore.state.classes.find((c) => c.value === value)?.color ?? OTHER_COLOR;

  const applyRenderer = () => {
    const s = transitStore.state;
    for (const layer of routeLayers) {
      layer.elevationInfo = { mode: "relative-to-ground", offset: s.offset };
      if (!s.colorField || !layer.fields?.some((f) => f.name === s.colorField)) {
        layer.renderer = { type: "simple", symbol: routeSymbol(ROUTE_COLORS[0], s) } as never;
        continue;
      }
      layer.renderer = new UniqueValueRenderer({
        field: s.colorField,
        defaultSymbol: routeSymbol(OTHER_COLOR, s, !!s.focus),
        defaultLabel: "Lainnya",
        uniqueValueInfos: s.classes
          .filter((c) => c.color !== OTHER_COLOR)
          .map((c) => ({ value: c.value, label: c.label, symbol: routeSymbol(c.color, s, !!s.focus && s.focus !== c.value) })),
      });
    }
    busLayer.elevationInfo = { mode: "relative-to-ground", offset: s.offset + s.height / 2 };
  };

  /** Classify routes by the colour field: top 8 values get palette colours, the rest fold into "Lainnya". */
  const classify = async () => {
    const field = transitStore.state.colorField;
    if (!field) return transitStore.set({ classes: [] });
    const counts = new Map<string, number>();
    for (const p of paths) counts.set(p.value, (counts.get(p.value) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "id", { numeric: true }));
    const classes: RouteClass[] = sorted.map(([value, count], i) => ({
      value,
      label: value || "(tanpa nama)",
      count,
      color: i < ROUTE_COLORS.length ? ROUTE_COLORS[i] : OTHER_COLOR,
    }));
    transitStore.set({ classes });
  };

  /** Fetch route geometry in WGS84 for the bus animation and the route statistics. */
  const loadPaths = async () => {
    const field = transitStore.state.colorField;
    const out: RoutePath[] = [];
    for (const layer of routeLayers) {
      const q = layer.createQuery();
      q.where = "1=1";
      q.outFields = field && layer.fields?.some((f) => f.name === field) ? [field] : [];
      q.returnGeometry = true;
      q.outSpatialReference = { wkid: 4326 } as never;
      q.maxAllowableOffset = 0.00005;
      const fs = await layer.queryFeatures(q);
      for (const f of fs.features) {
        const geom = f.geometry as Polyline | null;
        const value = field ? String(f.attributes?.[field] ?? "") : layer.title ?? "";
        for (const path of geom?.paths ?? []) {
          const coords = path.map((p) => [p[0], p[1]] as [number, number]);
          if (coords.length < 2) continue;
          const cum = [0];
          for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + metres(coords[i - 1], coords[i]));
          out.push({ value, coords, cum, length: cum[cum.length - 1] });
        }
      }
    }
    paths = out;
    transitStore.set({ routeCount: out.length, totalKm: Math.round(out.reduce((s, p) => s + p.length, 0) / 1000) });
  };

  const positionAt = (p: RoutePath, s: number): { pt: [number, number]; heading: number } => {
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const a = p.coords[i - 1];
    const b = p.coords[i];
    const seg = p.cum[i] - p.cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - p.cum[i - 1]) / seg));
    const k = Math.cos((a[1] * Math.PI) / 180);
    const heading = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
    return { pt: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: (heading + 360) % 360 };
  };

  const spawnBuses = () => {
    busLayer.removeAll();
    buses = [];
    const s = transitStore.state;
    const usable = paths.filter((p) => p.length > 300).slice(0, MAX_BUS_ROUTES);
    const total = usable.reduce((a, p) => a + p.length, 0);
    if (!s.buses || !total) return;
    // Distribute buses along the network proportionally to route length.
    for (let k = 0; k < s.busCount; k++) {
      let r = ((k + 0.5) / s.busCount) * total;
      const path = usable.find((p) => (r -= p.length) < 0) ?? usable[usable.length - 1];
      const pos = Math.random() * path.length;
      const dir = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
      const { pt, heading } = positionAt(path, pos);
      const graphic = new Graphic({
        geometry: new Point({ longitude: pt[0], latitude: pt[1] }),
        symbol: busSymbol(classColor(path.value), dir > 0 ? heading : heading + 180),
        attributes: { route: path.value },
      });
      buses.push({ path, s: pos, dir, graphic });
    }
    busLayer.addMany(buses.map((b) => b.graphic));
  };

  /** ~15 fps bus animation; speed = 20 km/h × multiplier. */
  let last = 0;
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    if (!visible || !buses.length || now - last < 66) return;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    const v = (20 / 3.6) * transitStore.state.busSpeed;
    const focus = transitStore.state.focus;
    for (const b of buses) {
      b.s += b.dir * v * dt;
      if (b.s > b.path.length) {
        b.s = b.path.length;
        b.dir = -1;
      } else if (b.s < 0) {
        b.s = 0;
        b.dir = 1;
      }
      const { pt, heading } = positionAt(b.path, b.s);
      b.graphic.geometry = new Point({ longitude: pt[0], latitude: pt[1] });
      b.graphic.symbol = busSymbol(classColor(b.path.value), b.dir > 0 ? heading : heading + 180);
      b.graphic.visible = !focus || focus === b.path.value;
    }
  };

  return {
    id: "transit",
    title: "Rute Transjakarta 3D",
    description: "Rute bus sebagai tabung/pita 3D (PathSymbol3DLayer) dengan animasi bus. Sumber: Jakarta Satu.",
    visibleByDefault: false,

    init({ map, view }) {
      map.addMany([group, busLayer]);
      group.visible = false;
      busLayer.visible = false;
      visible = false;
      requestAnimationFrame(tick);

      const load = async (url: string) => {
        const base = url.trim().replace(/\/+$/, "");
        group.removeAll();
        routeLayers = [];
        paths = [];
        busLayer.removeAll();
        buses = [];
        if (!base) return transitStore.set({ status: "Isi URL layanan rute.", error: null });
        transitStore.set({ loading: true, error: null, status: "Membaca layanan…", serviceUrl: base });
        try {
          const info = (await esriRequest(base, { query: { f: "json" }, responseType: "json" })).data as {
            layers?: { id: number; name: string; geometryType?: string; subLayerIds?: number[] | null }[];
          };
          const leaves = (info.layers ?? []).filter((l) => !l.subLayerIds?.length);
          const routes = leaves.filter((l) => l.geometryType === "esriGeometryPolyline");
          const stops = leaves.filter((l) => l.geometryType === "esriGeometryPoint");
          if (!routes.length) throw new Error("Tidak ada sublayer garis (rute) di layanan ini");

          routeLayers = routes.map(
            (l) => new FeatureLayer({ url: `${base}/${l.id}`, title: l.name, outFields: ["*"], popupEnabled: true }),
          );
          const stopLayers = stops.map(
            (l) =>
              new FeatureLayer({
                url: `${base}/${l.id}`,
                title: l.name,
                outFields: ["*"],
                elevationInfo: { mode: "relative-to-ground" },
                renderer: {
                  type: "simple",
                  symbol: {
                    type: "point-3d",
                    symbolLayers: [{ type: "icon", resource: { primitive: "circle" }, size: 7, material: { color: [245, 245, 245, 1] }, outline: { color: [30, 30, 30, 0.8], size: 1 } }],
                  },
                } as never,
              }),
          );
          await Promise.all(routeLayers.map((l) => l.load()));

          // Pick the most descriptive string field present on the route layers.
          const fields = routeLayers[0].fields.filter((f) => f.type === "string").map((f) => ({ name: f.name, alias: f.alias || f.name }));
          const colorField = fields.find((f) => FIELD_HINT.test(f.name) || FIELD_HINT.test(f.alias))?.name ?? fields[0]?.name ?? null;
          transitStore.set({
            routeLayers: routes.map((l) => ({ id: l.id, name: l.name })),
            stopLayers: stops.map((l) => ({ id: l.id, name: l.name })),
            fields,
            colorField,
          });

          group.addMany([...routeLayers, ...stopLayers]);
          await loadPaths();
          await classify();
          applyRenderer();
          spawnBuses();
          transitStore.set({ status: `${routes.length} layer rute, ${stops.length} layer halte dimuat.` });
          if (routeLayers[0].fullExtent && visible) void view.goTo(routeLayers[0].fullExtent).catch(() => {});
        } catch (err) {
          console.error("Transit service failed", err);
          transitStore.set({
            error: `Layanan rute gagal dimuat: ${err instanceof Error ? err.message : String(err)}. Periksa URL, koneksi, dan izin CORS server.`,
            status: "",
          });
        } finally {
          transitStore.set({ loading: false });
        }
      };

      // Debounced: each renderer change makes the layer re-tessellate its 3D paths.
      let rendererTimer = 0;
      transitStore.on(["profile", "width", "height", "offset", "focus"], () => {
        window.clearTimeout(rendererTimer);
        rendererTimer = window.setTimeout(applyRenderer, 400);
      });

      // Automatic width: ~1/70 of the camera height, in a few steps to avoid constant re-rendering.
      const autoWidth = () => {
        if (!transitStore.state.autoWidth) return;
        const z = view.camera?.position?.z ?? 5000;
        const steps = [8, 14, 24, 40, 60];
        const target = z / 70;
        const w = steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0]);
        if (w !== transitStore.state.width) transitStore.set({ width: w, height: w });
      };
      reactiveUtils.watch(() => view.stationary, (st) => st && autoWidth());
      transitStore.on(["autoWidth"], autoWidth, true);
      transitStore.on(["colorField"], async () => {
        if (!routeLayers.length) return;
        await loadPaths();
        await classify();
        applyRenderer();
        spawnBuses();
      });
      transitStore.on(["buses", "busCount"], spawnBuses);
      transitStore.on(["width"], () => busSymbols.clear());
      transitActions.reload = load;
      void load(defaultUrl);
    },

    setVisible(value) {
      visible = value;
      group.visible = value;
      busLayer.visible = value;
    },
  };
}

/** Reload the route service (used by the widget's URL field). */
export const transitActions = {
  reload: (_url: string): Promise<void> => Promise.resolve(),
};
