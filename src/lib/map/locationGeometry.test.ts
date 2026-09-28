import { describe, expect, test } from 'vitest';
import {
  bboxToRectangleFeature,
  latLngToPointFeature,
  limitCoordDecimals,
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

// terra-draw rejects features with more decimal places than it's configured
// for, and values derived from a track (e.g. a bbox centre) can carry float
// noise like 37.77250000000001.
describe('feature builders', () => {
  test('latLngToPointFeature rounds coordinates terra-draw would reject', () => {
    const f = latLngToPointFeature(
      '37.77250000000001',
      '-122.4100000000003',
      'point',
    );
    expect(f.geometry.coordinates).toEqual([-122.41, 37.7725]);
  });

  test('bboxToRectangleFeature rounds coordinates terra-draw would reject', () => {
    const f = bboxToRectangleFeature(
      {
        north: '37.77300000000001',
        south: '37.77',
        east: '-122.4099999999999',
        west: '-122.42',
      },
      'rectangle',
    );
    expect(f.geometry.coordinates).toEqual([
      [
        [-122.42, 37.77],
        [-122.41, 37.77],
        [-122.41, 37.773],
        [-122.42, 37.773],
        [-122.42, 37.77],
      ],
    ]);
  });
});

describe('limitCoordDecimals', () => {
  test('drops digits past the seventh decimal place', () => {
    expect(limitCoordDecimals('37.123456789')).toBe('37.1234567');
    expect(limitCoordDecimals('-122.00000001')).toBe('-122.0000000');
  });

  test('leaves shorter or partial input alone', () => {
    expect(limitCoordDecimals('37.1234567')).toBe('37.1234567');
    expect(limitCoordDecimals('37.')).toBe('37.');
    expect(limitCoordDecimals('-')).toBe('-');
    expect(limitCoordDecimals('')).toBe('');
  });
});
