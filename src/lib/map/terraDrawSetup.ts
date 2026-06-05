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
export const RED = '#ef4444'; // tailwind red-500

const TRACK_SOURCE = 'picker-track';

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

// Add/update/remove the read-only track line layer. terra-draw doesn't edit
// tracks, so they are rendered directly on the map.
export function setTrackLayer(
  map: MaplibreMap,
  points: GpsTrackPoint[] | null | undefined,
): void {
  if (points && points.length > 0) {
    const lineData: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: points.map((p) => [p.lng, p.lat] as [number, number]),
      },
      properties: {},
    };
    const src = map.getSource(TRACK_SOURCE) as GeoJSONSource | undefined;
    if (src) {
      src.setData(lineData);
    } else {
      map.addSource(TRACK_SOURCE, { type: 'geojson', data: lineData });
      map.addLayer({
        id: TRACK_SOURCE,
        type: 'line',
        source: TRACK_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': RED, 'line-width': 2 },
      });
    }
  } else if (map.getSource(TRACK_SOURCE)) {
    if (map.getLayer(TRACK_SOURCE)) map.removeLayer(TRACK_SOURCE);
    map.removeSource(TRACK_SOURCE);
  }
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
