import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { createMap, outlineToLatLngs, pinIcon, type LatLng, type ZoneOutline } from './mapConfig';

const PHARMACY = '#0f8a6a';
const PATIENT = '#2563eb';

/**
 * A map with two pins: the pharmacy and the patient. Tap to place the next
 * pin, drag either to move it. Zones can be shaded for reference.
 */
export function TripMap({
  from,
  to,
  onChange,
  areas = [],
  height = 420,
}: {
  from: LatLng | null;
  to: LatLng | null;
  onChange: (pins: { from: LatLng | null; to: LatLng | null }) => void;
  areas?: Array<{ name: string; boundary: ZoneOutline }>;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const areaLayer = useRef<L.LayerGroup | null>(null);
  const state = useRef({ from, to, onChange });
  state.current = { from, to, onChange };

  useEffect(() => {
    if (!container.current) return;
    const instance = createMap(container.current);
    areaLayer.current = L.layerGroup().addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    // The first tap places the pharmacy, the next the patient; after that a
    // tap moves the patient.
    instance.on('click', (event: L.LeafletMouseEvent) => {
      const point = { latitude: event.latlng.lat, longitude: event.latlng.lng };
      const { from: f, to: t, onChange: change } = state.current;
      change(f ? { from: f, to: point } : { from: point, to: t });
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

  useEffect(() => {
    const group = areaLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const area of areas) {
      L.polygon(outlineToLatLngs(area.boundary), { color: PHARMACY, weight: 1, fillOpacity: 0.05, interactive: false })
        .bindTooltip(area.name, { sticky: true })
        .addTo(group);
    }
  }, [areas]);

  useEffect(() => {
    const group = layer.current;
    const instance = map.current;
    if (!group || !instance) return;
    group.clearLayers();
    const pin = (point: LatLng, colour: string, label: string, which: 'from' | 'to') => {
      const marker = L.marker([point.latitude, point.longitude], { icon: pinIcon(colour, 22), draggable: true })
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -12] })
        .addTo(group);
      marker.on('dragend', () => {
        const at = marker.getLatLng();
        const moved = { latitude: at.lat, longitude: at.lng };
        const { from: f, to: t, onChange: change } = state.current;
        change(which === 'from' ? { from: moved, to: t } : { from: f, to: moved });
      });
    };
    if (from) pin(from, PHARMACY, 'Pharmacy', 'from');
    if (to) pin(to, PATIENT, 'Patient', 'to');
    if (from && to) {
      L.polyline([[from.latitude, from.longitude], [to.latitude, to.longitude]], { color: '#334155', weight: 2, dashArray: '6 6', interactive: false }).addTo(group);
      instance.fitBounds(L.latLngBounds([[from.latitude, from.longitude], [to.latitude, to.longitude]]).pad(0.35), { maxZoom: 15 });
    }
  }, [from, to]);

  return <div ref={container} style={{ height }} className="rounded-xl border overflow-hidden z-0" data-testid="map-trip" />;
}
