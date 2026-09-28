import type { GeoJSONStoreFeatures } from 'terra-draw';

// Uses the global GeoJSON namespace (from @types/geojson, a transitive
// maplibre-gl dependency), matching GeoMap.svelte.
type Feature<G extends GeoJSON.Geometry = GeoJSON.Geometry> =
  GeoJSON.Feature<G>;
type Point = GeoJSON.Point;
type Polygon = GeoJSON.Polygon;
type Position = GeoJSON.Position;

export type LatLng = { latitude: string; longitude: string };
export type Bbox = { north: string; south: string; east: string; west: string };

// Coordinate precision (~1cm) matching GeoMap's existing toFixed(7).
const COORD_PRECISION = 7;
const fmt = (n: number) => n.toFixed(COORD_PRECISION);
// Parse and round a stored coordinate for a terra-draw feature. terra-draw
// rejects coordinates with more decimals than it's configured for, and values
// derived from a track (e.g. a bbox centre) can carry float noise.
const coord = (s: string) => Number(fmt(parseFloat(s)));

// Cut typed or pasted coordinate text down to COORD_PRECISION decimals, so the
// fields can't hold more precision than the map (and terra-draw) accepts.
export function limitCoordDecimals(value: string): string {
  const dot = value.indexOf('.');
  if (dot === -1) return value;
  return value.slice(0, dot + 1 + COORD_PRECISION);
}

// Extract a lat/lng pair from a terra-draw Point feature.
// Returns null when the geometry is missing or not a usable point.
export function pointFeatureToLatLng(
  feature: Feature | undefined | null,
): LatLng | null {
  if (!feature || feature.geometry?.type !== 'Point') return null;
  const [lng, lat] = (feature.geometry as Point).coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: fmt(lat), longitude: fmt(lng) };
}

// Compute a bbox from a terra-draw Polygon (rectangle) feature's outer ring.
// Returns null when the geometry is missing or not a usable polygon.
export function rectangleFeatureToBbox(
  feature: Feature | undefined | null,
): Bbox | null {
  if (!feature || feature.geometry?.type !== 'Polygon') return null;
  const ring = (feature.geometry as Polygon).coordinates[0];
  if (!ring || ring.length === 0) return null;
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    north = Math.max(north, lat);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    west = Math.min(west, lng);
  }
  return {
    north: fmt(north),
    south: fmt(south),
    east: fmt(east),
    west: fmt(west),
  };
}

// Build a terra-draw Point feature for seeding an existing coordinate.
// `mode` must match an enabled terra-draw mode (e.g. 'point').
export function latLngToPointFeature(
  latitude: string,
  longitude: string,
  mode: string,
): GeoJSONStoreFeatures {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [coord(longitude), coord(latitude)],
    },
    properties: { mode },
  };
}

// Build a terra-draw Polygon (rectangle) feature for seeding an existing bbox.
// `mode` must match an enabled terra-draw mode (e.g. 'rectangle').
export function bboxToRectangleFeature(
  bbox: Bbox,
  mode: string,
): GeoJSONStoreFeatures {
  const n = coord(bbox.north);
  const s = coord(bbox.south);
  const e = coord(bbox.east);
  const w = coord(bbox.west);
  const ring: Position[] = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { mode },
  };
}
