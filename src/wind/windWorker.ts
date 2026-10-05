/// <reference lib="webworker" />
import { computeWindField, type BasePoint, type Grid } from "./windField";
import type { Obstacle } from "./obstacles";

export interface WindJob {
  id: number;
  grid: Grid;
  base: BasePoint[];
  obstacles: Obstacle[];
  buildingEffect: boolean;
}

self.onmessage = (e: MessageEvent<WindJob>) => {
  const { id, grid, base, obstacles, buildingEffect } = e.data;
  const r = computeWindField(grid, base, obstacles, buildingEffect);
  (self as unknown as Worker).postMessage({ id, ...r }, [r.u.buffer, r.v.buffer, r.mask.buffer]);
};
