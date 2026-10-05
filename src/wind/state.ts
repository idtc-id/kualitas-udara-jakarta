import { Store } from "../core/store";

/** A hypothetical building placed by the user to test its effect on the wind. */
export interface WhatIfBuilding {
  id: string;
  longitude: number;
  latitude: number;
  heightM: number;
  sizeM: number;
}

export interface WindStats {
  /** Mean speed with obstacles / mean free-stream speed (non-building cells). */
  speedRatio: number;
  /** Share of open cells where wind is below half the free-stream speed. */
  calmShare: number;
  /** Free-stream mean speed (m/s). */
  freeSpeed: number;
  buildingCells: number;
}

export interface WindState {
  buildingEffect: boolean;
  /** Use a fine local grid around the camera when zoomed in. */
  detail: boolean;
  whatIf: WhatIfBuilding[];
  placeHeight: number;
  placeSize: number;
  density: number;
  flowSpeed: number;
  trailLength: number;
  stats: WindStats | null;
  /** Number of real buildings read from the scene for the current grid. */
  sceneBuildings: number;
  gridInfo: string;
}

export const windStore = new Store<WindState>({
  buildingEffect: true,
  detail: true,
  whatIf: [],
  placeHeight: 150,
  placeSize: 50,
  density: 1,
  flowSpeed: 20,
  trailLength: 400,
  stats: null,
  sceneBuildings: 0,
  gridInfo: "",
});
