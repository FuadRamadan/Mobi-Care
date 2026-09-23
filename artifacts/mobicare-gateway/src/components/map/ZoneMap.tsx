import { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  createMap,
  outlineToLatLngs,
  pinIcon,
  zoneColours,
  type Position,
  type ZoneOutline,
} from './mapConfig';

export interface MapZone {
  id: string;
  name: string;
  boundary: ZoneOutline;
  isActive: boolean;
  feeLabel: string;
}

export interface MapPharmacy {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  zoneName: string | null;
}

/** Pixels within which a corner snaps onto a neighbour's corner or border. */
const SNAP_TO_CORNER_PX = 14;
const SNAP_TO_EDGE_PX = 9;

function cornerIcon(): L.DivIcon {
  const size = 14;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:4px;background:#fff;border:3px solid #0b3b2e;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:move"></span>`,
  });
}

const midpointIcon = L.divIcon({
  className: '',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  html: '<span style="display:block;width:12px;height:12px;border-radius:9999px;background:rgba(255,255,255,.85);border:2px dashed #0b3b2e;cursor:copy"></span>',
});

/**
 * The HQ zone map: every zone and pharmacy, plus an outline being drawn or
 * edited. While drawing, tap the map to add a corner, drag a corner to move
 * it, tap a corner to remove it, and tap a hollow midpoint to add a corner
 * between two others. Corners snap onto neighbouring zones so shared borders
 * line up exactly instead of overlapping by a few metres.
 */
export function ZoneMap({
  zones,
  pharmacies,
  draft,
  editingZoneId,
  onDraftChange,
  onSelectZone,
  height = 560,
}: {
  zones: MapZone[];
  pharmacies: MapPharmacy[];
  /** Corners of the outline being drawn, [lng, lat]; null when not drawing. */
  draft: Position[] | null;
  editingZoneId?: string | null;
  onDraftChange?: (corners: Position[]) => void;
  onSelectZone?: (id: string) => void;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const zoneLayer = useRef<L.LayerGroup | null>(null);
  const pharmacyLayer = useRef<L.LayerGroup | null>(null);
  const draftLayer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const drawing = draft !== null;

  // Handlers read the latest props through refs, so the map is built once.
  const latest = useRef({ draft, onDraftChange, onSelectZone, zones, editingZoneId });
  latest.current = { draft, onDraftChange, onSelectZone, zones, editingZoneId };

  useEffect(() => {
    if (!container.current) return;
    const instance = createMap(container.current, { doubleClickZoom: false });
    zoneLayer.current = L.layerGroup().addTo(instance);
    pharmacyLayer.current = L.layerGroup().addTo(instance);
    draftLayer.current = L.layerGroup().addTo(instance);
    instance.on('click', (event: L.LeafletMouseEvent) => {
      const { draft: corners, onDraftChange: change } = latest.current;
      if (!corners || !change) return;
      change([...corners, snap(event.latlng)]);
    });
    map.current = instance;
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);

  /** Moves a point onto a nearby corner or border of another zone. */
  function snap(at: L.LatLng): Position {
    const instance = map.current!;
    const target = instance.latLngToContainerPoint(at);
    const others = latest.current.zones.filter((zone) => zone.id !== latest.current.editingZoneId);
    let best: { distance: number; point: L.LatLng } | null = null;
    for (const zone of others) {
      for (const ring of outlineToLatLngs(zone.boundary)) {
        for (const corner of ring) {
          const distance = instance.latLngToContainerPoint(corner).distanceTo(target);
          if (distance <= SNAP_TO_CORNER_PX && (!best || distance < best.distance)) {
            best = { distance, point: L.latLng(corner) };
          }
        }
      }
    }
    if (!best) {
      for (const zone of others) {
        for (const ring of outlineToLatLngs(zone.boundary)) {
          for (let i = 0; i < ring.length; i++) {
            const a = instance.latLngToContainerPoint(ring[i]!);
            const b = instance.latLngToContainerPoint(ring[(i + 1) % ring.length]!);
            const closest = L.LineUtil.closestPointOnSegment(target, a, b);
            const distance = closest.distanceTo(target);
            if (distance <= SNAP_TO_EDGE_PX && (!best || distance < best.distance)) {
              best = { distance, point: instance.containerPointToLatLng(closest) };
            }
          }
        }
      }
    }
    const point = best?.point ?? at;
    return [round(point.lng), round(point.lat)];
  }

  // Zones
  useEffect(() => {
    const instance = map.current;
    const layer = zoneLayer.current;
    if (!instance || !layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);
    const colours = zoneColours(zones);
    zones.forEach((zone) => {
      if (zone.id === editingZoneId) return;
      const colour = zone.isActive ? colours.get(zone.id)! : '#8a948f';
      const polygon = L.polygon(outlineToLatLngs(zone.boundary), {
        color: colour,
        weight: 2,
        dashArray: zone.isActive ? undefined : '6 6',
        fillOpacity: zone.isActive ? 0.16 : 0.05,
        // While drawing, taps must reach the map to place corners.
        interactive: !drawing,
      })
        .bindTooltip(
          `<strong>${escapeHtml(zone.name)}</strong><br>${escapeHtml(zone.isActive ? zone.feeLabel : 'Switched off')}`,
          { permanent: true, direction: 'center', className: 'zone-label' },
        )
        .addTo(layer);
      polygon.on('click', () => latest.current.onSelectZone?.(zone.id));
      bounds.extend(polygon.getBounds());
    });
    if (!fitted.current && bounds.isValid()) {
      instance.fitBounds(bounds, { padding: [24, 24] });
      fitted.current = true;
    }
  }, [zones, editingZoneId, drawing]);

  // Pharmacies
  useEffect(() => {
    const layer = pharmacyLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const pharmacy of pharmacies) {
      if (pharmacy.latitude == null || pharmacy.longitude == null) continue;
      L.marker([pharmacy.latitude, pharmacy.longitude], {
        icon: pinIcon(pharmacy.zoneName ? '#0b3b2e' : '#d97706', 14),
        interactive: true,
        keyboard: false,
      })
        .bindTooltip(
          `${escapeHtml(pharmacy.name)}<br><span style="opacity:.75">${escapeHtml(
            pharmacy.zoneName ?? 'Outside every zone — collection only',
          )}</span>`,
        )
        .addTo(layer);
    }
  }, [pharmacies]);

  // The outline being drawn
  useEffect(() => {
    const layer = draftLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!draft) return;
    const points = draft.map(([lng, lat]) => L.latLng(lat, lng));
    if (points.length >= 2) {
      L.polygon(points, {
        color: '#0b3b2e',
        weight: 3,
        fillColor: '#10b981',
        fillOpacity: 0.22,
        interactive: false,
      }).addTo(layer);
    }
    points.forEach((point, index) => {
      const corner = L.marker(point, { icon: cornerIcon(), draggable: true, keyboard: false }).addTo(layer);
      corner.on('dragend', () => {
        const next = [...latest.current.draft!];
        next[index] = snap(corner.getLatLng());
        latest.current.onDraftChange?.(next);
      });
      corner.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        const next = latest.current.draft!.filter((_, i) => i !== index);
        latest.current.onDraftChange?.(next);
      });
    });
    if (points.length >= 3) {
      points.forEach((point, index) => {
        const next = points[(index + 1) % points.length]!;
        const middle = L.latLng((point.lat + next.lat) / 2, (point.lng + next.lng) / 2);
        const handle = L.marker(middle, { icon: midpointIcon, keyboard: false }).addTo(layer);
        handle.on('click', (event) => {
          L.DomEvent.stopPropagation(event);
          const corners = [...latest.current.draft!];
          corners.splice(index + 1, 0, [round(middle.lng), round(middle.lat)]);
          latest.current.onDraftChange?.(corners);
        });
      });
    }
  }, [draft]);

  return (
    <div
      ref={container}
      style={{ height }}
      className={`w-full rounded-xl border overflow-hidden bg-secondary/40 z-0 ${draft ? 'cursor-crosshair' : ''}`}
      data-testid="map-delivery-zones"
    />
  );
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
