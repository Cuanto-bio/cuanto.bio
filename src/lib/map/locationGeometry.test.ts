import { describe, expect, test } from 'vitest';
import {
  bboxToRectangleFeature,
  latLngToPointFeature,
  pointFeatureToLatLng,
  rectangleFeatureToBbox,
} from './locationGeometry';

describe('pointFeatureToLatLng', () => {
  test('extracts lat/lng with 7-decimal precision', () => {
    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [-122.4194, 37.7749] },
      properties: { mode: 'point' },
    };
    expect(pointFeatureToLatLng(feature)).toEqual({
      latitude: '37.7749000',
      longitude: '-122.4194000',
    });
  });

  test('returns null for non-point geometry', () => {
    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: [] },
      properties: {},
    };
    expect(pointFeatureToLatLng(feature)).toBeNull();
  });

  test('returns null for missing feature', () => {
    expect(pointFeatureToLatLng(undefined)).toBeNull();
    expect(pointFeatureToLatLng(null)).toBeNull();
  });
});

describe('rectangleFeatureToBbox', () => {
  test('computes north/south/east/west from a polygon ring', () => {
    const feature = {
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-122.5, 37.7],
            [-122.3, 37.7],
            [-122.3, 37.8],
            [-122.5, 37.8],
            [-122.5, 37.7],
          ],
        ],
      },
      properties: { mode: 'rectangle' },
    };
    expect(rectangleFeatureToBbox(feature)).toEqual({
      north: '37.8000000',
      south: '37.7000000',
      east: '-122.3000000',
      west: '-122.5000000',
    });
  });

  test('returns null for non-polygon geometry', () => {
    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [0, 0] },
      properties: {},
    };
    expect(rectangleFeatureToBbox(feature)).toBeNull();
  });
});

describe('round trips', () => {
  test('latLngToPointFeature -> pointFeatureToLatLng', () => {
    const f = latLngToPointFeature('37.7749000', '-122.4194000', 'point');
    expect(f.geometry.type).toBe('Point');
    expect(f.properties.mode).toBe('point');
    expect(pointFeatureToLatLng(f)).toEqual({
      latitude: '37.7749000',
      longitude: '-122.4194000',
    });
  });

  test('bboxToRectangleFeature -> rectangleFeatureToBbox', () => {
    const bbox = {
      north: '37.8000000',
      south: '37.7000000',
      east: '-122.3000000',
      west: '-122.5000000',
    };
    const f = bboxToRectangleFeature(bbox, 'rectangle');
    expect(f.geometry.type).toBe('Polygon');
    expect(rectangleFeatureToBbox(f)).toEqual(bbox);
  });
});
