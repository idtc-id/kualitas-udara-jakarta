import type SunLighting from "@arcgis/core/views/3d/environment/SunLighting";
import type { LayerModule } from "../core/modules";
import { average, cityWeather, readingsAt } from "../core/selectors";
import type { WeatherSample } from "../core/types";

type WeatherSetting =
  | { type: "sunny"; cloudCover: number }
  | { type: "cloudy"; cloudCover: number }
  | { type: "rainy"; cloudCover: number; precipitation: number }
  | { type: "foggy"; fogStrength: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Maps the twin's state onto the SceneView environment: sun position follows
 * the timeline, rain/cloud follow the weather, and PM2.5 drives haze (fog).
 * Weather effects are only rendered by the SDK near the ground.
 */
export function weatherFor(weather: WeatherSample | null, pm25: number | null): WeatherSetting {
  const cc = clamp((weather?.cloudCover ?? 30) / 100, 0, 1);
  switch (weather?.condition) {
    case "thunderstorm":
    case "heavy-rain":
      return { type: "rainy", cloudCover: 0.9, precipitation: 0.9 };
    case "rain":
      return { type: "rainy", cloudCover: 0.8, precipitation: 0.5 };
    case "drizzle":
      return { type: "rainy", cloudCover: 0.7, precipitation: 0.2 };
  }
  const hazy = weather?.condition === "fog" || weather?.condition === "haze" || weather?.condition === "smoke";
  if (hazy || (pm25 ?? 0) > 55) {
    return { type: "foggy", fogStrength: round1(clamp(((pm25 ?? 60) - 25) / 150, 0.1, 0.8)) };
  }
  if (cc > 0.6) return { type: "cloudy", cloudCover: round1(cc) };
  return { type: "sunny", cloudCover: round1(cc) };
}

export function createAtmosphereLayer(): LayerModule {
  let apply: (enabled: boolean) => void = () => {};

  return {
    id: "atmosphere",
    title: "Atmosfer & cahaya",
    description: "Matahari mengikuti waktu; hujan/awan dari data cuaca; kabut dari PM2.5. Efek cuaca tampil saat kamera dekat permukaan.",
    visibleByDefault: true,

    init({ view, store }) {
      let enabled = store.state.layerVisibility.atmosphere ?? true;
      let lastKey = "";
      view.environment.lighting = { type: "sun", directShadowsEnabled: true, cameraTrackingEnabled: false };

      const update = () => {
        const s = store.state;
        const t = s.airQuality?.times[s.timeIndex] ?? Date.now();
        (view.environment.lighting as SunLighting).date = new Date(t);
        const setting: WeatherSetting = enabled
          ? weatherFor(cityWeather(s), average(readingsAt(s).map((r) => r.concentrations.pm2_5 ?? null)))
          : { type: "sunny", cloudCover: 0.2 };
        const key = JSON.stringify(setting);
        if (key !== lastKey) {
          lastKey = key;
          view.environment.weather = setting;
        }
      };

      apply = (value) => {
        enabled = value;
        update();
      };
      store.on(["airQuality", "weather", "timeIndex"], update, true);
    },

    setVisible(visible) {
      apply(visible);
    },
  };
}
