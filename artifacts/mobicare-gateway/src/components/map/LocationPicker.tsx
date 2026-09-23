import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createMap,
  currentPosition,
  outlineToLatLngs,
  pinIcon,
  type LatLng,
  type ZoneOutline,
} from './mapConfig';

/**
 * A map to put one pin on: tap to place it, drag to adjust, or use the
 * device's location. Served areas can be shaded so people see where the pin
 * needs to go.
 */
export function LocationPicker({
  value,
  onChange,
  areas = [],
  locateLabel = 'Use my location',
  height = 260,
  testId,
}: {
  value: LatLng | null;
  onChange: (value: LatLng) => void;
  areas?: Array<{ name: string; boundary: ZoneOutline }>;
  locateLabel?: string;
  height?: number;
  testId?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const areaLayer = useRef<L.LayerGroup | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const instance = createMap(container.current);
    instance.on('click', (event: L.LeafletMouseEvent) =>
      onChangeRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng }),
    );
    areaLayer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    // Inside a dialog the map is created before it has its final size; redraw
    // the tiles whenever the box changes size.
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      instance.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = areaLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const area of areas) {
      L.polygon(outlineToLatLngs(area.boundary), {
        color: '#0f8a6a',
        weight: 1.5,
        fillOpacity: 0.08,
        interactive: false,
      })
        .bindTooltip(area.name, { sticky: true })
        .addTo(layer);
    }
  }, [areas]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const point: L.LatLngTuple = [value.latitude, value.longitude];
    if (!marker.current) {
      marker.current = L.marker(point, { draggable: true, icon: pinIcon('#dc2626', 22) }).addTo(instance);
      marker.current.on('dragend', () => {
        const at = marker.current!.getLatLng();
        onChangeRef.current({ latitude: at.lat, longitude: at.lng });
      });
      instance.setView(point, Math.max(instance.getZoom(), 15));
    } else {
      marker.current.setLatLng(point);
    }
  }, [value]);

  async function locate() {
    setLocating(true);
    setLocateError(null);
    try {
      const position = await currentPosition();
      onChangeRef.current(position);
      map.current?.setView([position.latitude, position.longitude], 16);
    } catch (error) {
      setLocateError(error instanceof Error ? error.message : 'Your location could not be found.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="space-y-2">
      <div
        ref={container}
        style={{ height }}
        className="w-full rounded-2xl border overflow-hidden bg-secondary/40 z-0"
        data-testid={testId}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={locate} disabled={locating}>
          {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
          {locateLabel}
        </Button>
        <span className="text-xs text-muted-foreground">
          {value
            ? `Pin at ${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)} — drag it to adjust.`
            : 'Or tap the map to drop a pin.'}
        </span>
      </div>
      {locateError && <p className="text-xs text-destructive">{locateError}</p>}
    </div>
  );
}
