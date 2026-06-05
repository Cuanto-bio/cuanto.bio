import type { StyleSpecification } from 'maplibre-gl';

// Default zoom when the map has no coordinates to anchor on (whole world)
export const DEFAULT_ZOOM = 1;
// Default zoom once we have a point or bbox to center on
export const DEFAULT_ZOOM_WITH_COORDS = 8;

// OpenStreetMap raster basemap. Returns a fresh object each call so multiple map
// instances don't share (and mutate) the same style definition.
export function osmStyle(): StyleSpecification {
  return {
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
  };
}
