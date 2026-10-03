import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Map settings shared by every map in the app.
 *
 * Tiles default to OpenStreetMap's public servers, which are free but meant
 * for light use and require the attribution shown on the map. To move to
 * another provider (or a self-hosted tile server) set VITE_MAP_TILE_URL and
 * VITE_MAP_TILE_ATTRIBUTION at build time; nothing else changes.
 */
export const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// The credit link opens in a new tab: a mis-tap near the map's edge must not
// navigate away and throw away a zone or pin someone is placing.
export const TILE_ATTRIBUTION =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** Central Freetown: where every map opens until there is something to show. */
export const FREETOWN: L.LatLngTuple = [8.465, -13.235];

/** GeoJSON order: [longitude, latitude]. */
export type Position = [number, number];
export type ZoneOutline =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface LatLng {
  latitude: number;
  longitude: number;
}

export const ZONE_COLOURS = ['#0f8a6a', '#2563eb', '#c2410c', '#7c3aed', '#b45309', '#0e7490', '#be185d'];

/**
 * A colour for each zone. Each starts from a colour derived from its id, so it
 * rarely changes as zones come and go, then moves along the palette until it
 * differs from every neighbour already coloured, so shared borders stay
 * visible.
 */
export function zoneColours(zones: Array<{ id: string; boundary: ZoneOutline }>): Map<string, string> {
  const boxes = new Map(
    zones.map((zone) => {
      const points = outlineToLatLngs(zone.boundary).flat();
      const lats = points.map((p) => p[0]);
      const lngs = points.map((p) => p[1]);
      return [zone.id, { s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lngs), e: Math.max(...lngs) }];
    }),
  );
  const touches = (a: string, b: string) => {
    const x = boxes.get(a)!;
    const y = boxes.get(b)!;
    const margin = 1e-6;
    return x.w <= y.e + margin && y.w <= x.e + margin && x.s <= y.n + margin && y.s <= x.n + margin;
  };
  const colours = new Map<string, string>();
  for (const zone of [...zones].sort((a, b) => a.id.localeCompare(b.id))) {
    let hash = 0;
    for (const char of zone.id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    const start = Math.abs(hash) % ZONE_COLOURS.length;
    const taken = new Set(
      [...colours].filter(([id]) => touches(id, zone.id)).map(([, colour]) => colour),
    );
    let colour = ZONE_COLOURS[start]!;
    for (let step = 0; step < ZONE_COLOURS.length; step++) {
      const candidate = ZONE_COLOURS[(start + step) % ZONE_COLOURS.length]!;
      if (!taken.has(candidate)) {
        colour = candidate;
        break;
      }
    }
    colours.set(zone.id, colour);
  }
  return colours;
}

export function createMap(element: HTMLElement, options: L.MapOptions = {}): L.Map {
  const map = L.map(element, { zoomControl: true, attributionControl: true, ...options }).setView(
    FREETOWN,
    12,
  );
  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: TILE_ATTRIBUTION,
    // OpenStreetMap's tile servers refuse tiles requested without a referrer,
    // which once left every map blank. Tiles send only the site's origin
    // (https://mobicaresl.com/), never the page's path, whatever the site's
    // own Referrer-Policy says.
    referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map);
  // Leaflet's own credit link, also in a new tab (see TILE_ATTRIBUTION).
  map.attributionControl?.setPrefix(
    '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>',
  );
  return map;
}

/** The outer ring of each part of a zone, as Leaflet points. */
export function outlineToLatLngs(outline: ZoneOutline): L.LatLngTuple[][] {
  const rings =
    outline.type === 'Polygon' ? [outline.coordinates[0]] : outline.coordinates.map((p) => p[0]);
  return rings
    .filter((ring): ring is Position[] => Array.isArray(ring))
    .map((ring) => {
      const points = ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
      // Leaflet closes polygons itself; a repeated last point would show as a
      // doubled corner handle.
      const first = points[0];
      const last = points[points.length - 1];
      if (first && last && first[0] === last[0] && first[1] === last[1]) points.pop();
      return points;
    });
}

/** A round pin drawn in CSS: no marker images to go missing in the build. */
export function pinIcon(colour = '#0f8a6a', size = 18): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${colour};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></span>`,
  });
}

/** Asks the browser for the device's position. */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This device cannot share its location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? 'Location permission was refused. Tap the map to place the pin instead.'
              : 'Your location could not be found. Tap the map to place the pin instead.',
          ),
        ),
      // Always a fresh fix: a cached one from a minute ago may be the wrong street.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}
