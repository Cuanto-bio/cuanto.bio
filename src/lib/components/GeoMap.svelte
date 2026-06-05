<script lang="ts">
import type { GeoJSONSource, Map as MaplibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { onDestroy, onMount } from 'svelte';
import { trackToBbox } from '$lib/gpx';
import {
  DEFAULT_ZOOM,
  DEFAULT_ZOOM_WITH_COORDS,
  osmStyle,
} from '$lib/map/osmStyle';

type BboxProp = { north: string; south: string; east: string; west: string };
type TrackPoint = { lat: number; lng: number };

type Props = {
  latitude?: string;
  longitude?: string;
  bbox?: BboxProp;
  track?: TrackPoint[];
  oncoordinate?: (lat: string, lng: string) => void;
  class?: string;
  zoom?: number;
};

let {
  latitude,
  longitude,
  bbox,
  track,
  oncoordinate,
  class: className = '',
  zoom: zoomProp,
}: Props = $props();

let container: HTMLDivElement;
let map: MaplibreMap | undefined;
let marker: Marker | undefined;
let MarkerCls: typeof Marker | undefined;
// Reactive flag — set inside map.once('load') so sources/layers can be added safely
let mapReady = $state(false);
let suppressNextClick = false;

function parsedCoords(): [number, number] | null {
  const lat = parseFloat(latitude ?? '');
  const lng = parseFloat(longitude ?? '');
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}

// Returns [[west, south], [east, north]] or null
function parsedBbox(): [[number, number], [number, number]] | null {
  if (!bbox) return null;
  const n = parseFloat(bbox.north);
  const s = parseFloat(bbox.south);
  const e = parseFloat(bbox.east);
  const w = parseFloat(bbox.west);
  if ([n, s, e, w].some(Number.isNaN)) return null;
  return [
    [w, s],
    [e, n],
  ];
}

onMount(async () => {
  const ml = await import('maplibre-gl');
  MarkerCls = ml.Marker;
  const coords = parsedCoords();
  const bounds = parsedBbox();

  let center: [number, number] = [0, 0];
  if (bounds) {
    center = [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2,
    ];
  } else if (coords) {
    center = coords;
  }
  const zoom =
    zoomProp ?? (bounds || coords ? DEFAULT_ZOOM_WITH_COORDS : DEFAULT_ZOOM);

  map = new ml.Map({
    container,
    cooperativeGestures: true,
    style: osmStyle(),
    center,
    zoom,
    attributionControl: false,
  });
  map.addControl(new ml.AttributionControl({ compact: true }));
  map.on('click', (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    oncoordinate?.(e.lngLat.lat.toFixed(7), e.lngLat.lng.toFixed(7));
  });
  // Defer mapReady until the style is loaded so sources/layers can be added
  map.once('load', () => {
    mapReady = true;
  });
});

onDestroy(() => {
  marker?.remove();
  map?.remove();
});

$effect(() => {
  mapReady; // track so effect re-runs after style loads
  if (!map || !MarkerCls) return;

  const coords = parsedCoords(); // tracks latitude, longitude
  const bounds = parsedBbox(); // tracks bbox

  // Marker
  if (coords) {
    if (marker) {
      marker.setLngLat(coords);
    } else {
      // #3b82f6 = tailwind blue-500 (point), #ef4444 = tailwind red-500 (track)
      const m = new MarkerCls({ draggable: !!oncoordinate, color: '#3b82f6' })
        .setLngLat(coords)
        .addTo(map);
      m.on('dragend', () => {
        suppressNextClick = true;
        const { lat, lng } = m.getLngLat();
        oncoordinate?.(lat.toFixed(7), lng.toFixed(7));
      });
      marker = m;
    }
  } else {
    marker?.remove();
    marker = undefined;
  }

  // Bbox rectangle
  if (bounds) {
    const polygon: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [bounds[0][0], bounds[0][1]],
            [bounds[1][0], bounds[0][1]],
            [bounds[1][0], bounds[1][1]],
            [bounds[0][0], bounds[1][1]],
            [bounds[0][0], bounds[0][1]],
          ],
        ],
      },
      properties: {},
    };
    const src = map.getSource('bbox') as GeoJSONSource | undefined;
    if (src) {
      src.setData(polygon);
    } else {
      map.addSource('bbox', { type: 'geojson', data: polygon });
      map.addLayer({
        id: 'bbox-fill',
        type: 'fill',
        source: 'bbox',
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: 'bbox-outline',
        type: 'line',
        source: 'bbox',
        paint: { 'line-color': '#3b82f6', 'line-width': 2 },
      });
    }
    map.fitBounds(bounds, { padding: 40 });
  } else {
    // Remove bbox layers if they were previously added
    if (map.getSource('bbox')) {
      if (map.getLayer('bbox-fill')) map.removeLayer('bbox-fill');
      if (map.getLayer('bbox-outline')) map.removeLayer('bbox-outline');
      map.removeSource('bbox');
    }
    // Pan to point only when there is no bbox
    if (coords) {
      map.panTo(coords);
      if (!marker) map.setZoom(DEFAULT_ZOOM_WITH_COORDS);
    }
  }

  // Track line and dots
  if (track && track.length > 0) {
    const trackCoords = track.map((p) => [p.lng, p.lat] as [number, number]);

    const lineData: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: trackCoords },
      properties: {},
    };
    const pointsData: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: trackCoords.map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c },
        properties: {},
      })),
    };

    const lineSrc = map.getSource('track-line') as GeoJSONSource | undefined;
    if (lineSrc) {
      lineSrc.setData(lineData);
    } else {
      map.addSource('track-line', { type: 'geojson', data: lineData });
      map.addLayer({
        id: 'track-line',
        type: 'line',
        source: 'track-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ef4444', 'line-width': 2 },
      });
    }

    const pointsSrc = map.getSource('track-points') as
      | GeoJSONSource
      | undefined;
    if (pointsSrc) {
      pointsSrc.setData(pointsData);
    } else {
      map.addSource('track-points', { type: 'geojson', data: pointsData });
      map.addLayer({
        id: 'track-points',
        type: 'circle',
        source: 'track-points',
        paint: {
          'circle-radius': 3,
          'circle-color': '#ef4444',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    // Fit to track extent only when there is no bbox or coords to anchor the view
    if (!bounds && !coords) {
      // Use trackToBbox (a reduce) rather than Math.min(...lngs) — spread will
      // blow the call stack on very long tracks (tens of thousands of points).
      const tb = trackToBbox(track);
      if (tb) {
        map.fitBounds(
          [
            [parseFloat(tb.west), parseFloat(tb.south)],
            [parseFloat(tb.east), parseFloat(tb.north)],
          ],
          { padding: 40 },
        );
      }
    }
  } else {
    if (map.getSource('track-points')) {
      if (map.getLayer('track-points')) map.removeLayer('track-points');
      map.removeSource('track-points');
    }
    if (map.getSource('track-line')) {
      if (map.getLayer('track-line')) map.removeLayer('track-line');
      map.removeSource('track-line');
    }
  }
});
</script>

<div bind:this={container} data-testid="geo-map" class="h-40 w-full rounded {className}"></div>
