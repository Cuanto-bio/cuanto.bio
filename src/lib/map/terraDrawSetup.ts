import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl';
import type { TerraDraw } from 'terra-draw';
import { type GpsTrackPoint, trackToBbox } from '$lib/gpx';

// north/south/east/west as strings — matches both GpsBbox and locationGeometry's Bbox.
type EdgeBbox = { north: string; south: string; east: string; west: string };

// terra-draw mode names
export const POINT = 'point';
export const RECTANGLE = 'rectangle';
export const SELECT = 'select';

// theme colors (match GeoMap.svelte)
export const BLUE = '#3b82f6'; // tailwind blue-500
// Tailwind fuchsia-600, the light-mode --highlight in src/routes/layout.css.
// MapLibre paint needs a literal color, not a CSS variable. OSM draws motorways
// in pink, so a softer pink would vanish on highways.
export const HIGHLIGHT = '#c026d3';
// What the trim chart's fill-muted-foreground/30 looks like on white: stone-500
// (--muted-foreground in src/routes/layout.css) at 30%, made opaque so trimmed
// points don't blend into the track they overlap.
export const MUTED = '#d7d4d3';

const TRACK_SOURCE = 'picker-track';
const TRIMMED_TRACK_SOURCE = 'picker-track-trimmed';

// Construct and start a TerraDraw configured for picking/editing a point and/or
// a bounding box: blue features with white outlines, and a select mode that keeps
// the active feature selected (so it is always draggable). The terra-draw and
// adapter modules are passed in because callers import them dynamically.
export function createLocationDraw(
  td: typeof import('terra-draw'),
  adapter: typeof import('terra-draw-maplibre-gl-adapter'),
  map: MaplibreMap,
  // manualSelection=false makes selection programmatic only (the editor drives it
  // with explicit Edit buttons); the default true lets a click select a feature.
  opts: { manualSelection?: boolean } = {},
): TerraDraw {
  const draw = new td.TerraDraw({
    adapter: new adapter.TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new td.TerraDrawPointMode({
        styles: {
          pointColor: BLUE,
          pointWidth: 6,
          // White outline to match the bbox corner handles
          pointOutlineColor: '#ffffff',
          pointOutlineWidth: 2,
        },
      }),
      new td.TerraDrawRectangleMode({
        styles: {
          fillColor: BLUE,
          fillOpacity: 0.15,
          outlineColor: BLUE,
          outlineWidth: 2,
        },
      }),
      new td.TerraDrawSelectMode({
        // The selected point feature uses these styles (not the point mode's);
        // give it the same white outline as the bbox corner handles.
        styles: {
          selectedPointColor: BLUE,
          selectedPointWidth: 6,
          selectedPointOutlineColor: '#ffffff',
          selectedPointOutlineWidth: 2,
        },
        // Keep the active feature selected so it is always draggable: clicking
        // off it must not deselect (which would require a re-click before the
        // next drag), and keyboard delete/rotate/scale are disabled.
        allowManualDeselection: false,
        allowManualSelection: opts.manualSelection ?? true,
        keyEvents: { deselect: null, delete: null, rotate: null, scale: null },
        flags: {
          point: { feature: { draggable: true } },
          rectangle: {
            feature: {
              draggable: true,
              coordinates: { draggable: true, resizable: 'opposite' },
            },
          },
        },
      }),
    ],
  });
  draw.start();
  return draw;
}

// Only position matters for drawing; GeoMap's tracks carry no timestamps.
type LatLng = { lat: number; lng: number };

// Add/update/remove a track drawn as a line with a dot on each point, under
// the source/layer ids `${id}` (line) and `${id}-points` (dots). Seeing each
// point makes it clear which fixes a trim keeps or drops.
function drawTrack(
  map: MaplibreMap,
  id: string,
  points: LatLng[] | null | undefined,
  style: { color: string; beforeId?: string },
): void {
  const pointsId = `${id}-points`;
  if (!points || points.length === 0) {
    for (const layer of [pointsId, id]) {
      if (map.getLayer(layer)) map.removeLayer(layer);
    }
    if (map.getSource(id)) map.removeSource(id);
    return;
  }
  const coords = points.map((p) => [p.lng, p.lat] as [number, number]);
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      },
      ...coords.map(
        (c): GeoJSON.Feature => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: c },
          properties: {},
        }),
      ),
    ],
  };
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    return;
  }
  const beforeId =
    style.beforeId && map.getLayer(style.beforeId) ? style.beforeId : undefined;
  map.addSource(id, { type: 'geojson', data });
  map.addLayer(
    {
      id,
      type: 'line',
      source: id,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': style.color,
        'line-width': 2,
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: pointsId,
      type: 'circle',
      source: id,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 3,
        'circle-color': style.color,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff',
      },
    },
    beforeId,
  );
}

// Add/update/remove the read-only track layers. terra-draw doesn't edit
// tracks, so they are rendered directly on the map.
export function setTrackLayer(
  map: MaplibreMap,
  points: LatLng[] | null | undefined,
): void {
  drawTrack(map, TRACK_SOURCE, points, { color: HIGHLIGHT });
}

// Add/update/remove a gray copy of the whole untrimmed track, drawn
// beneath the track layers so a trim preview shows what will be cut off.
export function setTrimmedTrackLayer(
  map: MaplibreMap,
  points: LatLng[] | null | undefined,
): void {
  drawTrack(map, TRIMMED_TRACK_SOURCE, points, {
    color: MUTED,
    beforeId: TRACK_SOURCE,
  });
}

// Fit the map viewport to a bounding box with the standard picker padding.
export function fitMapToBbox(map: MaplibreMap, bbox: EdgeBbox): void {
  map.fitBounds(
    [
      [parseFloat(bbox.west), parseFloat(bbox.south)],
      [parseFloat(bbox.east), parseFloat(bbox.north)],
    ],
    { padding: 40 },
  );
}

// Render the read-only track line, optionally fitting the viewport to its extent.
// Shared by LocationPicker (fit: true) and SurveyLocationEditor (display only).
export function renderTrack(
  map: MaplibreMap,
  points: GpsTrackPoint[] | null | undefined,
  opts: { fit?: boolean } = {},
): void {
  setTrackLayer(map, points);
  if (opts.fit && points && points.length > 0) {
    const tb = trackToBbox(points);
    if (tb) fitMapToBbox(map, tb);
  }
}
