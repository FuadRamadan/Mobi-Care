/**
 * The map page shown inside the app (a WebView on phones, an iframe in the web
 * test build): Leaflet with OpenStreetMap tiles, the same map the web app uses.
 * No map key is needed. EXPO_PUBLIC_MAP_TILE_URL can point at another tile
 * provider, like the web app's VITE_MAP_TILE_URL.
 *
 * Messages in:  { target: 'mc-map', type: 'set', value: LatLng | null, areas: Area[] }
 *               { target: 'mc-map', type: 'center', value: LatLng }
 * Messages out: { source: 'mc-map', type: 'ready' }
 *               { source: 'mc-map', type: 'pick', latitude, longitude }
 */
export const FREETOWN = { latitude: 8.465, longitude: -13.235 };

const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function mapHtml(): string {
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #e8efec; }
  .leaflet-control-attribution { font-size: 9px; }
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  function send(m) {
    m.source = 'mc-map';
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m));
    else window.parent.postMessage(m, '*');
  }
  var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([${FREETOWN.latitude}, ${FREETOWN.longitude}], 12);
  L.tileLayer(${JSON.stringify(TILE_URL)}, { maxZoom: 19, attribution: ${JSON.stringify(TILE_ATTRIBUTION)} }).addTo(map);
  map.attributionControl.setPrefix('Leaflet');
  var icon = L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
    html: '<span style="display:block;width:22px;height:22px;border-radius:9999px;background:#dc2626;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></span>' });
  var marker = null;
  var areas = L.layerGroup().addTo(map);
  map.on('click', function (e) { send({ type: 'pick', latitude: e.latlng.lat, longitude: e.latlng.lng }); });

  function handle(d) {
    if (!d || d.target !== 'mc-map') return;
    if (d.type === 'set') {
      areas.clearLayers();
      (d.areas || []).forEach(function (a) {
        L.polygon(a.rings, { color: '#0f8a6a', weight: 1.5, fillOpacity: 0.08, interactive: false }).addTo(areas);
      });
      if (!d.value) { if (marker) { marker.remove(); marker = null; } return; }
      var p = [d.value.latitude, d.value.longitude];
      if (!marker) {
        marker = L.marker(p, { draggable: true, icon: icon }).addTo(map);
        marker.on('dragend', function () {
          var at = marker.getLatLng();
          send({ type: 'pick', latitude: at.lat, longitude: at.lng });
        });
        map.setView(p, Math.max(map.getZoom(), 15));
      } else {
        marker.setLatLng(p);
      }
    }
    if (d.type === 'center') map.setView([d.value.latitude, d.value.longitude], 16);
  }
  window.__mcMap = handle;
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
    handle(d);
  });
  send({ type: 'ready' });
</script>
</body></html>`;
}
