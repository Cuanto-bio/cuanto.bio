<script lang="ts">
import type { Map as MaplibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { onDestroy, onMount } from 'svelte';
import type { TerraDraw } from 'terra-draw';
import Button from '$lib/components/Button.svelte';
import { buttonVariants } from '$lib/components/ui/button';
import { Label } from '$lib/components/ui/label';
import * as RadioGroup from '$lib/components/ui/radio-group';
import { type GpsTrackPoint, parseGpx, trackToBbox } from '$lib/gpx';
import {
  type Bbox,
  bboxToRectangleFeature,
  latLngToPointFeature,
  pointFeatureToLatLng,
  rectangleFeatureToBbox,
} from '$lib/map/locationGeometry';
import {
  DEFAULT_ZOOM,
  DEFAULT_ZOOM_WITH_COORDS,
  osmStyle,
} from '$lib/map/osmStyle';
import {
  createLocationDraw,
  fitMapToBbox,
  POINT,
  RECTANGLE,
  renderTrack,
  SELECT,
} from '$lib/map/terraDrawSetup';
import { cn } from '$lib/utils';

type Mode = 'none' | 'point' | 'bbox' | 'track';

type ChangePayload = {
  mode: Mode;
  latitude: string | null;
  longitude: string | null;
  bbox: Bbox | null;
  track: GpsTrackPoint[] | null;
  trackSource: 'uploaded' | null;
};

type Props = {
  mode?: Mode;
  latitude?: string | null;
  longitude?: string | null;
  bbox?: Bbox | null;
  track?: GpsTrackPoint[] | null;
  onchange: (payload: ChangePayload) => void;
  class?: string;
};

let {
  mode: initialMode = 'none',
  latitude: initialLat = null,
  longitude: initialLng = null,
  bbox: initialBbox = null,
  track: initialTrack = null,
  onchange,
  class: className = '',
}: Props = $props();

// ─── internal state (LocationPicker owns these after mount) ───────────────────
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let currentMode = $state<Mode>(initialMode);
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let latitude: string | null = initialLat;
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let longitude: string | null = initialLng;
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let bboxVal: Bbox | null = initialBbox;
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let trackPoints = $state<GpsTrackPoint[] | null>(initialTrack);
// Name of the uploaded GPX file. Resumed/seeded tracks have no original name,
// so fall back to a generic label.
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let trackFileName = $state<string | null>(
  initialTrack?.length ? 'GPX track' : null,
);
let gpxError = $state<string | null>(null);

let container: HTMLDivElement;
let map: MaplibreMap | undefined;
let draw: TerraDraw | undefined;
let mapReady = $state(false);

function parsedCoords(): [number, number] | null {
  const lat = parseFloat(latitude ?? '');
  const lng = parseFloat(longitude ?? '');
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return [lng, lat];
}

function emit() {
  onchange({
    mode: currentMode,
    latitude: currentMode === 'point' ? latitude : null,
    longitude: currentMode === 'point' ? longitude : null,
    bbox: currentMode === 'bbox' ? bboxVal : null,
    track: currentMode === 'track' ? trackPoints : null,
    trackSource:
      currentMode === 'track' && trackPoints?.length ? 'uploaded' : null,
  });
}

// Read whatever the user drew/edited back out of terra-draw and emit it.
function syncFromDraw() {
  if (!draw) return;
  const snap = draw.getSnapshot();
  if (currentMode === 'point') {
    const ll = pointFeatureToLatLng(
      snap.find((f) => f.geometry?.type === 'Point'),
    );
    latitude = ll?.latitude ?? null;
    longitude = ll?.longitude ?? null;
  } else if (currentMode === 'bbox') {
    bboxVal = rectangleFeatureToBbox(
      snap.find((f) => f.geometry?.type === 'Polygon'),
    );
  }
  emit();
}

// Configure terra-draw for the active mode, seeding any existing geometry so the
// user can edit it (drag) rather than only draw fresh.
function applyMode(m: Mode) {
  if (!draw) return;
  draw.clear();
  if (m === 'point') {
    if (latitude && longitude) {
      draw.addFeatures([latLngToPointFeature(latitude, longitude, POINT)]);
      draw.setMode(SELECT);
      const id = draw.getSnapshot()[0]?.id;
      if (id != null) draw.selectFeature(id);
    } else {
      draw.setMode(POINT);
    }
  } else if (m === 'bbox') {
    if (bboxVal) {
      draw.addFeatures([bboxToRectangleFeature(bboxVal, RECTANGLE)]);
      draw.setMode(SELECT);
      const id = draw.getSnapshot()[0]?.id;
      if (id != null) draw.selectFeature(id);
    } else {
      draw.setMode(RECTANGLE);
    }
  } else {
    // none and track keep terra-draw idle (track uses the file input below)
    draw.setMode(SELECT);
  }
}

function selectMode(m: Mode) {
  if (m === currentMode) return;
  if (m !== 'point') {
    latitude = null;
    longitude = null;
  }
  if (m !== 'bbox') bboxVal = null;
  if (m !== 'track') {
    trackPoints = null;
    trackFileName = null;
    gpxError = null;
  }
  currentMode = m;
  applyMode(m);
  emit();
}

async function onGpxFile(e: Event & { currentTarget: HTMLInputElement }) {
  const file = e.currentTarget.files?.[0];
  e.currentTarget.value = ''; // allow re-selecting the same file
  if (!file) return;
  const points = parseGpx(await file.text());
  if (points.length === 0) {
    gpxError = 'No track points found in that file.';
    return;
  }
  gpxError = null;
  trackPoints = points;
  trackFileName = file.name;
  latitude = null;
  longitude = null;
  bboxVal = null;
  currentMode = 'track';
  applyMode('track');
  emit();
}

// Remove the uploaded track: restores the file chooser, hides the point count,
// and (via the track-render effect) removes the line from the map.
function clearTrack() {
  trackPoints = null;
  trackFileName = null;
  gpxError = null;
  emit();
}

onMount(async () => {
  const [ml, td, adapter] = await Promise.all([
    import('maplibre-gl'),
    import('terra-draw'),
    import('terra-draw-maplibre-gl-adapter'),
  ]);

  const coords = parsedCoords();
  const tb = trackPoints?.length ? trackToBbox(trackPoints) : null;
  const seedBbox = bboxVal ?? tb;

  let center: [number, number] = [0, 0];
  if (seedBbox) {
    center = [
      (parseFloat(seedBbox.west) + parseFloat(seedBbox.east)) / 2,
      (parseFloat(seedBbox.south) + parseFloat(seedBbox.north)) / 2,
    ];
  } else if (coords) {
    center = coords;
  }
  const zoom = seedBbox || coords ? DEFAULT_ZOOM_WITH_COORDS : DEFAULT_ZOOM;

  map = new ml.Map({
    container,
    cooperativeGestures: true,
    style: osmStyle(),
    center,
    zoom,
    attributionControl: false,
  });
  map.addControl(new ml.AttributionControl({ compact: true }));

  map.once('load', () => {
    if (!map) return;
    draw = createLocationDraw(td, adapter, map);
    // Commit on draw completion and after drag edits (terra-draw fires `finish`
    // for both); switch a freshly drawn feature into select mode for editing.
    draw.on('finish', (id, ctx) => {
      syncFromDraw();
      if (ctx.action === 'draw' && draw) {
        draw.setMode(SELECT);
        draw.selectFeature(id);
      }
    });
    applyMode(currentMode);
    if (seedBbox) fitMapToBbox(map, seedBbox);
    mapReady = true;
  });
});

onDestroy(() => {
  draw?.stop();
  map?.remove();
});

// Render the uploaded track read-only (terra-draw doesn't edit it) and fit to it.
$effect(() => {
  mapReady; // re-run after the style loads
  const pts = trackPoints; // track for reactivity
  if (!map || !mapReady) return;
  renderTrack(map, pts, { fit: true });
});
</script>

<div class="flex flex-col gap-2 {className}">
  <fieldset class="flex flex-col gap-2">
    <legend class="text-sm font-medium leading-none">Coordinates</legend>
    <RadioGroup.Root
      bind:value={() => currentMode, (v) => selectMode(v as Mode)}
      class="flex flex-row flex-wrap gap-4"
    >
      <div class="flex items-center gap-2">
        <RadioGroup.Item value="none" id="loc-none" />
        <Label for="loc-none" class="font-normal">None</Label>
      </div>
      <div class="flex items-center gap-2">
        <RadioGroup.Item value="point" id="loc-point" />
        <Label for="loc-point" class="font-normal">Point</Label>
      </div>
      <div class="flex items-center gap-2">
        <RadioGroup.Item value="bbox" id="loc-bbox" />
        <Label for="loc-bbox" class="font-normal">Bounding box</Label>
      </div>
      <div class="flex items-center gap-2">
        <RadioGroup.Item value="track" id="loc-track" />
        <Label for="loc-track" class="font-normal">Track (GPX)</Label>
      </div>
    </RadioGroup.Root>
  </fieldset>

  {#if currentMode === 'track'}
    {#if trackPoints?.length}
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="font-medium">{trackFileName ?? 'GPX track'}</span>
        <span class="text-muted-foreground text-xs">
          ({trackPoints.length}
          {trackPoints.length === 1 ? 'point' : 'points'})
        </span>
        <Button type="button" variant="outline" size="sm" onclick={clearTrack}>
          Clear
        </Button>
      </div>
    {:else}
      <div class="flex flex-col gap-1 justify-start">
        <!-- A label opens the native file dialog without JS; the input is
             visually hidden so both browsers render this control identically. -->
        <label class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), "w-fit")}>
          Choose GPX file
          <input
            type="file"
            accept=".gpx,application/gpx+xml"
            onchange={onGpxFile}
            class="sr-only"
          />
        </label>
        {#if gpxError}
          <span class="text-destructive text-xs">{gpxError}</span>
        {/if}
      </div>
    {/if}
  {/if}

  <div bind:this={container} data-testid="location-picker-map" class="h-56 w-full rounded"></div>
  {#if currentMode === 'point'}
    <p class="text-muted-foreground text-xs">Tap the map to place a point, then drag it to adjust.</p>
  {:else if currentMode === 'bbox'}
    <p class="text-muted-foreground text-xs">Tap two opposite corners to draw a box, then drag the handles to adjust.</p>
  {/if}
</div>
