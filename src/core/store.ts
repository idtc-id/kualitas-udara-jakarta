import type {
  AirQualityDataset,
  BmkgRegionForecast,
  Indicator,
  TimeMode,
  TimeRange,
  WeatherDataset,
} from "./types";

export interface AppState {
  mode: TimeMode;
  range: TimeRange;
  indicator: Indicator;
  /** Index into airQuality.times. */
  timeIndex: number;
  playing: boolean;
  /** Timeline steps per second during playback. */
  speed: number;
  /** In real-time mode: keep the timeline pinned to the latest hour after refreshes. */
  followLive: boolean;
  selectedStationId: string | null;
  theme: "dark" | "light";
  layerVisibility: Record<string, boolean>;
  airQuality: AirQualityDataset | null;
  weather: WeatherDataset | null;
  bmkg: BmkgRegionForecast[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

export type StateKey = keyof AppState;
type Listener = (state: AppState, changed: Set<StateKey>) => void;

/**
 * Minimal observable store. Modules subscribe to the keys they care about;
 * nothing else in the app needs to know they exist.
 */
export class Store {
  private current: AppState;
  private listeners = new Set<{ keys: Set<StateKey> | null; fn: Listener }>();

  constructor(initial: AppState) {
    this.current = initial;
  }

  get state(): Readonly<AppState> {
    return this.current;
  }

  set(patch: Partial<AppState>): void {
    const changed = new Set<StateKey>();
    for (const key of Object.keys(patch) as StateKey[]) {
      if (!Object.is(this.current[key], patch[key])) changed.add(key);
    }
    if (!changed.size) return;
    this.current = { ...this.current, ...patch };
    for (const listener of [...this.listeners]) {
      if (!listener.keys || [...listener.keys].some((k) => changed.has(k))) {
        listener.fn(this.current, changed);
      }
    }
  }

  /**
   * Subscribe to changes of the given keys (or every change when keys is omitted).
   * Set `immediate` to run the listener once right away. Returns an unsubscribe function.
   */
  on(keys: StateKey[] | null, fn: Listener, immediate = false): () => void {
    const entry = { keys: keys ? new Set(keys) : null, fn };
    this.listeners.add(entry);
    if (immediate) fn(this.current, new Set(keys ?? []));
    return () => this.listeners.delete(entry);
  }
}
