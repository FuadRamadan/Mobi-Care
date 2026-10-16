/** Where a point is, in words: its named delivery area, else its district. */
import { loadZones } from "./zones.js";
import { zoneContains, type Boundary, type Position } from "./geometry.js";
import { districtAt } from "../search/searchArea.js";

/** The named area (zone) and a readable area name for a point. */
export async function locate(point: Position): Promise<{ zoneId: string | null; areaName: string | null }> {
  const zones = (await loadZones()).filter((z) => z.isActive);
  const zone = zones.find((z) => zoneContains(z.boundary as Boundary, point));
  return { zoneId: zone?.id ?? null, areaName: zone?.name ?? districtAt(point) };
}
