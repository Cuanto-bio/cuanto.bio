<script lang="ts">
import type { Map as MaplibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { onDestroy, onMount } from 'svelte';

type Props = {
  latitude: string;
  longitude: string;
  oncoordinate?: (lat: string, lng: string) => void;
  class?: string;
};

let {
  latitude,
  longitude,
  oncoordinate,
  class: className = '',
}: Props = $props();

let container: HTMLDivElement;
let map: MaplibreMap | undefined;
let marker: Marker | undefined;
let MarkerCls: typeof Marker | undefined;
// Reactive flag so $effect re-runs after async onMount completes
let mapReady = $state(false);
let suppressNextClick = false;

function parsedCoords(): [number, number] | null {
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}

onMount(async () => {
  const ml = await import('maplibre-gl');
  MarkerCls = ml.Marker;
  const coords = parsedCoords();
  map = new ml.Map({
    container,
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxzoom: 19,
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
    center: coords ?? [0, 0],
    zoom: coords ? 12 : 1,
    attributionControl: false,
  });
  map.on('click', (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    oncoordinate?.(e.lngLat.lat.toFixed(7), e.lngLat.lng.toFixed(7));
  });
  mapReady = true;
});

onDestroy(() => {
  marker?.remove();
  map?.remove();
});

$effect(() => {
  mapReady; // track so effect re-runs after mount
  const coords = parsedCoords(); // tracks latitude, longitude
  if (!map || !MarkerCls) return;
  if (coords) {
    map.panTo(coords);
    if (marker) {
      marker.setLngLat(coords);
    } else {
      map.setZoom(12);
      const m = new MarkerCls({ draggable: true }).setLngLat(coords).addTo(map);
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
});
</script>

<div bind:this={container} data-testid="geo-map" class="h-40 w-full rounded {className}"></div>
