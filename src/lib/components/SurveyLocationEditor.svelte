<script lang="ts">
import type { Map as MaplibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { onDestroy, onMount } from 'svelte';
import type { TerraDraw } from 'terra-draw';
import Button from '$lib/components/Button.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import { buttonVariants } from '$lib/components/ui/button';
import { Input } from '$lib/components/ui/input';
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

// Track is a tri-state on save: keep the existing one, drop it, or replace it.
export type TrackChange =
  | { action: 'preserve' }
  | { action: 'remove' }
  | { action: 'replace'; points: GpsTrackPoint[] };

export type LocationEditPayload = {
  latitude: string | null;
  longitude: string | null;
  bbox: Bbox | null;
  track: TrackChange;
};

type Props = {
  latitude?: string | null;
  longitude?: string | null;
  bbox?: Bbox | null;
  // Points of the existing track, for display (may be null if none/unloaded).
  track?: GpsTrackPoint[] | null;
  // Whether the survey currently has a track at all (drives preserve default).
  trackPresent?: boolean;
  onchange: (payload: LocationEditPayload) => void;
  class?: string;
};

let {
  latitude: initialLat = null,
  longitude: initialLng = null,
  bbox: initialBbox = null,
  track: initialTrack = null,
  trackPresent = false,
  onchange,
  class: className = '',
}: Props = $props();

// ─── state ────────────────────────────────────────────────────────────────────
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let lat = $state<string | null>(initialLat);
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let lng = $state<string | null>(initialLng);
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let bboxVal = $state<Bbox | null>(initialBbox);
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let trackPoints = $state<GpsTrackPoint[] | null>(initialTrack);
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let trackFileName = $state<string | null>(
  initialTrack?.length ? 'GPX track' : null,
);
let trackAction = $state<'preserve' | 'remove' | 'replace'>('preserve');
let gpxError = $state<string | null>(null);
// Which shape is being actively edited (selected + draggable + inputs shown).
let editing = $state<'point' | 'bbox' | null>(null);
// Which shape is mid-draw (shows the placement hint).
let drawing = $state<'point' | 'bbox' | null>(null);
// Pending remove action: set to open the confirmation dialog, null to close.
let pendingRemove = $state<'point' | 'bbox' | 'track' | null>(null);

const hasPoint = $derived(!!(lat && lng));
const hasBbox = $derived(!!bboxVal);
const showTrackSummary = $derived(
  trackAction === 'replace' || (trackAction === 'preserve' && trackPresent),
);

let container: HTMLDivElement;
let map: MaplibreMap | undefined;
let draw: TerraDraw | undefined;
let selectedId: string | number | undefined;
let mapReady = $state(false);

function featureIdByType(
  type: 'Point' | 'Polygon',
): string | number | undefined {
  return draw?.getSnapshot().find((f) => f.geometry?.type === type)?.id;
}

// Validate manual coordinate input before pushing it to the map.
function validLngLat(
  la: string | null,
  lo: string | null,
): [number, number] | null {
  const a = parseFloat(la ?? '');
  const o = parseFloat(lo ?? '');
  if (Number.isNaN(a) || Number.isNaN(o)) return null;
  if (a < -90 || a > 90 || o < -180 || o > 180) return null;
  return [o, a]; // [lng, lat]
}

function validBboxRing(b: Bbox | null): [number, number][] | null {
  if (!b) return null;
  const n = parseFloat(b.north);
  const s = parseFloat(b.south);
  const e = parseFloat(b.east);
  const w = parseFloat(b.west);
  if ([n, s, e, w].some(Number.isNaN)) return null;
  if (n < -90 || n > 90 || s < -90 || s > 90) return null;
  if (e < -180 || e > 180 || w < -180 || w > 180) return null;
  if (n < s) return null;
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

function trackChange(): TrackChange {
  if (trackAction === 'replace' && trackPoints?.length) {
    return { action: 'replace', points: $state.snapshot(trackPoints) };
  }
  if (trackAction === 'remove') return { action: 'remove' };
  return { action: 'preserve' };
}

function emit() {
  onchange({
    latitude: lat,
    longitude: lng,
    bbox: bboxVal,
    track: trackChange(),
  });
}

// Read the drawn/dragged point + bbox back out of terra-draw and emit.
function syncFromDraw() {
  if (!draw) return;
  const snap = draw.getSnapshot();
  const ll = pointFeatureToLatLng(
    snap.find((f) => f.geometry?.type === 'Point'),
  );
  lat = ll?.latitude ?? null;
  lng = ll?.longitude ?? null;
  bboxVal = rectangleFeatureToBbox(
    snap.find((f) => f.geometry?.type === 'Polygon'),
  );
  emit();
}

// ─── point ──────────────────────────────────────────────────────────────────
function addPoint() {
  // Guard against re-entry while a draw is already in progress. The UI hides the
  // Add button mid-draw, but a stray call must not stack draw modes.
  if (!draw || drawing) return;
  drawing = 'point';
  draw.setMode(POINT);
}

// Select the terra-draw feature for the shape currently being edited. Driven by an
// effect (see below) so the point/bbox Edit buttons and the deferred map-load case
// share one path, rather than each having to remember to call this.
function selectForEditing() {
  if (!draw || !editing) return;
  const id = featureIdByType(editing === 'point' ? 'Point' : 'Polygon');
  if (id == null) return;
  draw.setMode(SELECT);
  draw.selectFeature(id);
  selectedId = id;
}

function editPoint() {
  editing = 'point';
}

function removePoint() {
  pendingRemove = 'point';
}

function confirmRemovePoint() {
  const id = featureIdByType('Point');
  if (id != null) draw?.removeFeatures([id]);
  lat = null;
  lng = null;
  if (editing === 'point') {
    editing = null;
    selectedId = undefined;
  }
  if (drawing === 'point') {
    drawing = null;
    draw?.setMode(SELECT);
  }
  emit();
}

function onPointInput() {
  const coords = validLngLat(lat, lng);
  const id = featureIdByType('Point');
  if (coords && id != null) {
    draw?.updateFeatureGeometry(id, { type: 'Point', coordinates: coords });
  }
  emit();
}

// ─── bounding box ─────────────────────────────────────────────────────────────
function addBbox() {
  // Guard against re-entry while a draw is already in progress (see addPoint).
  if (!draw || drawing) return;
  drawing = 'bbox';
  draw.setMode(RECTANGLE);
}

function editBbox() {
  editing = 'bbox';
}

function removeBbox() {
  pendingRemove = 'bbox';
}

function confirmRemoveBbox() {
  const id = featureIdByType('Polygon');
  if (id != null) draw?.removeFeatures([id]);
  bboxVal = null;
  if (editing === 'bbox') {
    editing = null;
    selectedId = undefined;
  }
  if (drawing === 'bbox') {
    drawing = null;
    draw?.setMode(SELECT);
  }
  emit();
}

function onBboxInput() {
  const ring = validBboxRing(bboxVal);
  const id = featureIdByType('Polygon');
  if (ring && id != null) {
    draw?.updateFeatureGeometry(id, { type: 'Polygon', coordinates: [ring] });
  }
  emit();
}

function doneEditing() {
  if (selectedId != null) draw?.deselectFeature(selectedId);
  selectedId = undefined;
  editing = null;
}

// ─── track ────────────────────────────────────────────────────────────────────
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
  trackAction = 'replace';
  emit();
}

function removeTrack() {
  pendingRemove = 'track';
}

function confirmRemoveTrack() {
  trackPoints = null;
  trackFileName = null;
  trackAction = 'remove';
  gpxError = null;
  emit();
}

onMount(async () => {
  const [ml, td, adapter] = await Promise.all([
    import('maplibre-gl'),
    import('terra-draw'),
    import('terra-draw-maplibre-gl-adapter'),
  ]);

  // Seed the initial center/zoom from the bbox, or the track's extent if there is
  // no bbox. This relies on SurveyForm deferring our mount (editTrackLoaded) until
  // any existing track has loaded, so `trackPoints` is already populated here. If
  // that gating ever changes, a track-only survey would briefly center at [0,0].
  const seedBbox =
    bboxVal ?? (trackPoints?.length ? trackToBbox(trackPoints) : null);
  const point =
    lat && lng
      ? ([parseFloat(lng), parseFloat(lat)] as [number, number])
      : null;

  let center: [number, number] = [0, 0];
  if (seedBbox) {
    center = [
      (parseFloat(seedBbox.west) + parseFloat(seedBbox.east)) / 2,
      (parseFloat(seedBbox.south) + parseFloat(seedBbox.north)) / 2,
    ];
  } else if (point) {
    center = point;
  }
  const zoom = seedBbox || point ? DEFAULT_ZOOM_WITH_COORDS : DEFAULT_ZOOM;

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
    // Selection is driven only by the Edit buttons, so disable click-to-select.
    draw = createLocationDraw(td, adapter, map, { manualSelection: false });
    draw.on('finish', (id, ctx) => {
      if (ctx.action === 'draw' && draw) {
        // A freshly drawn shape: keep it and drop straight into editing it.
        drawing = null;
        draw.setMode(SELECT);
        draw.selectFeature(id);
        selectedId = id;
        editing =
          draw.getSnapshotFeature(id)?.geometry?.type === 'Point'
            ? 'point'
            : 'bbox';
      }
      syncFromDraw();
    });

    // Seed existing point + bbox; they render read-only until edited.
    if (lat && lng) {
      draw.addFeatures([latLngToPointFeature(lat, lng, POINT)]);
    }
    if (bboxVal) {
      draw.addFeatures([bboxToRectangleFeature(bboxVal, RECTANGLE)]);
    }
    draw.setMode(SELECT);

    if (seedBbox) fitMapToBbox(map, seedBbox);
    // Flipping this true triggers the selection effect, covering the case where
    // the user pressed Edit while the map was still loading.
    mapReady = true;
  });
});

onDestroy(() => {
  draw?.stop();
  map?.remove();
});

// Select the edited feature whenever the active shape changes or the map becomes
// ready. This is the single source of truth for selection, so editPoint/editBbox
// only set `editing` and the deferred (Edit-before-load) case is handled too.
$effect(() => {
  if (mapReady && editing) selectForEditing();
});

// Render the track read-only (terra-draw doesn't edit it).
$effect(() => {
  mapReady; // re-run after the style loads
  const pts = trackPoints; // track for reactivity
  if (!map || !mapReady) return;
  renderTrack(map, pts);
});
</script>

<div class="flex flex-col gap-3 {className}">
  <div class="flex flex-col gap-3 text-sm">

    <!-- Point -->
    <div class="flex flex-col sm:flex-row items-top gap-2">
      <span class="w-28 font-medium">Point</span>
      <div class="flex flex-col flex-1 gap-2">
        {#if hasPoint && editing === 'point'}
          <div class="flex flex-wrap gap-2 text-xs">
            <label class="flex flex-col gap-1">
              <span>Latitude</span>
              <Input
                type="text"
                inputmode="decimal"
                aria-label="Latitude"
                class="w-full"
                bind:value={lat}
                oninput={onPointInput}
                disabled={editing !== 'point'}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span>Longitude</span>
              <Input
                type="text"
                inputmode="decimal"
                aria-label="Longitude"
                class="w-full"
                bind:value={lng}
                oninput={onPointInput}
                disabled={editing !== 'point'}
              />
            </label>
          </div>
          <div class="flex flex-nowrap">
            <Button type="button" class="bg-primary" size="xs" data-testid="loc-done-point" onclick={doneEditing}>
              Done
            </Button>
            <Button type="button" variant="ghost" size="xs" data-testid="loc-remove-point" onclick={removePoint}>
              Remove
            </Button>
          </div>
        {:else if hasPoint}
          <span class="text-muted-foreground text-xs">{lat}, {lng}</span>
          <div class="flex flex-nowrap justify-self-end">
            <Button type="button" variant="outline" size="xs" data-testid="loc-edit-point" onclick={editPoint}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="xs" data-testid="loc-remove-point" onclick={removePoint}>
              Remove
            </Button>
          </div>
        {:else}
          <Button type="button" variant="outline" size="xs" data-testid="loc-add-point" onclick={addPoint}>
            Add point
          </Button>
        {/if}
      </div>
      
    </div>

    <!-- Bounding box -->
    <div class="flex flex-col sm:flex-row items-top gap-2">
      <span class="w-28 font-medium">Bounding box</span>
      <div class="flex flex-col flex-1 gap-2">
        {#if hasBbox && bboxVal && editing === 'bbox'}
          <div class="flex flex-col sm:flex-row gap-2 text-xs">
            <label class="flex flex-col gap-1">
              <span>North</span>
              <Input type="text" inputmode="decimal" aria-label="North" class="w-full" bind:value={bboxVal.north} oninput={onBboxInput} />
            </label>
            <label class="flex flex-col gap-1">
              <span>South</span>
              <Input type="text" inputmode="decimal" aria-label="South" class="w-full" bind:value={bboxVal.south} oninput={onBboxInput} />
            </label>
            <label class="flex flex-col gap-1">
              <span>East</span>
              <Input type="text" inputmode="decimal" aria-label="East" class="w-full" bind:value={bboxVal.east} oninput={onBboxInput} />
            </label>
            <label class="flex flex-col gap-1">
              <span>West</span>
              <Input type="text" inputmode="decimal" aria-label="West" class="w-full" bind:value={bboxVal.west} oninput={onBboxInput} />
            </label>
          </div>
          <div class="flex flex-nowrap gap-2">
            <Button type="button" class="bg-primary" size="xs" data-testid="loc-done-bbox" onclick={doneEditing}>
              Done
            </Button>
            <Button type="button" variant="ghost" size="xs" data-testid="loc-remove-bbox" onclick={removeBbox}>
              Remove
            </Button>
          </div>
        {:else if hasBbox && bboxVal}
          <span class="text-muted-foreground text-xs">
            N {bboxVal.north}, S {bboxVal.south}, E {bboxVal.east}, W {bboxVal.west}
          </span>
          <div class="flex flex-nowrap gap-2">
            <Button type="button" variant="outline" size="xs" data-testid="loc-edit-bbox" onclick={editBbox}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="xs" data-testid="loc-remove-bbox" onclick={removeBbox}>
              Remove
            </Button>
          </div>
        {:else}
          <Button type="button" variant="outline" size="xs" data-testid="loc-add-bbox" onclick={addBbox} class="w-fit">
            Add bounding box
          </Button>
        {/if}
      </div>
    </div>

    <!-- Track -->
    <div class="flex flex-col sm:flex-row items-top gap-2">
      <span class="w-28 font-medium">Track</span>
      <div class="flex flex-col flex-1 gap-2">
        {#if showTrackSummary}
          <span class="text-muted-foreground text-xs">
            {trackFileName ?? 'GPX track'}
            {#if trackPoints?.length}
              ({trackPoints.length}
              {trackPoints.length === 1 ? 'point' : 'points'})
            {/if}
          </span>
          <div class="flex flex-nowrap gap-2">
            <label class={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'w-fit')}>
              Replace
              <input type="file" accept=".gpx,application/gpx+xml" onchange={onGpxFile} class="sr-only" />
            </label>
            <Button type="button" variant="ghost" size="xs" data-testid="loc-remove-track" onclick={removeTrack}>
              Remove
            </Button>
          </div>
        {:else}
          <label class={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'w-fit')}>
            Choose GPX file
            <input type="file" accept=".gpx,application/gpx+xml" onchange={onGpxFile} class="sr-only" />
          </label>
        {/if}
      </div>
      {#if gpxError}
        <span class="text-destructive text-xs">{gpxError}</span>
      {/if}
    </div>
  </div>

  <AlertDialog.Root
    open={pendingRemove !== null}
    onOpenChange={(open) => { if (!open) pendingRemove = null; }}
  >
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Remove {pendingRemove === 'bbox' ? 'bounding box' : pendingRemove}?</AlertDialog.Title>
        <AlertDialog.Description>
          This {pendingRemove === 'bbox' ? 'bounding box' : pendingRemove} will be removed from the survey when you save.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Keep</AlertDialog.Cancel>
        <AlertDialog.Action
          onclick={() => {
            if (pendingRemove === 'point') confirmRemovePoint();
            else if (pendingRemove === 'bbox') confirmRemoveBbox();
            else if (pendingRemove === 'track') confirmRemoveTrack();
            pendingRemove = null;
          }}
        >
          Remove
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>

  <div bind:this={container} data-testid="location-editor-map" class="h-56 w-full rounded"></div>
  {#if drawing === 'point'}
    <p class="text-muted-foreground text-xs">Tap the map to place the point, then drag it to adjust.</p>
  {:else if drawing === 'bbox'}
    <p class="text-muted-foreground text-xs">Tap two opposite corners to draw the box, then drag the handles to adjust.</p>
  {:else if editing === 'point'}
    <p class="text-muted-foreground text-xs">Drag the point on the map or type coordinates above.</p>
  {:else if editing === 'bbox'}
    <p class="text-muted-foreground text-xs">Drag the box handles on the map or type edges above.</p>
  {/if}
</div>
