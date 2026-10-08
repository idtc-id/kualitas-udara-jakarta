import { Store } from "../core/store";

export interface RouteClass {
  value: string;
  label: string;
  color: string;
  count: number;
}

export interface TransitState {
  serviceUrl: string;
  status: string;
  error: string | null;
  loading: boolean;
  /** Polyline (route) and point (stop) sublayers found in the service. */
  routeLayers: { id: number; name: string }[];
  stopLayers: { id: number; name: string }[];
  /** String fields available on the route layers. */
  fields: { name: string; alias: string }[];
  colorField: string | null;
  classes: RouteClass[];
  /** Route value currently isolated (null = all). */
  focus: string | null;
  profile: "circle" | "quad";
  /** Scale path width with camera distance so routes stay readable at city scale. */
  autoWidth: boolean;
  width: number;
  height: number;
  offset: number;
  buses: boolean;
  busCount: number;
  /** Visual speed multiplier relative to ~20 km/h. */
  busSpeed: number;
  routeCount: number;
  totalKm: number;
}

export const transitStore = new Store<TransitState>({
  serviceUrl: "",
  status: "",
  error: null,
  loading: false,
  routeLayers: [],
  stopLayers: [],
  fields: [],
  colorField: null,
  classes: [],
  focus: null,
  profile: "circle",
  autoWidth: true,
  width: 14,
  height: 14,
  offset: 18,
  buses: true,
  busCount: 160,
  busSpeed: 20,
  routeCount: 0,
  totalKm: 0,
});

/** Categorical slots of the validated palette (dark-surface steps), in fixed order; extra routes fold into "Lainnya". */
export const ROUTE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const OTHER_COLOR = "#8a8f98";
