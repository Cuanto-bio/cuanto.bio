import { describe, expect, test } from 'vitest';
import {
  convertFromMeters,
  DISTANCE_UNITS,
  type DistanceUnit,
  formatDistance,
  formatDistanceValue,
  trackDistanceMeters,
} from './distance';
import type { GpsTrackPoint } from './gpx';

const t0 = new Date('2026-05-27T10:00:00.000Z').getTime();

function pt(lat: number, lng: number, offsetMs = 0): GpsTrackPoint {
  return { lat, lng, timestamp: t0 + offsetMs };
}

describe('trackDistanceMeters', () => {
  test('returns 0 for an empty track', () => {
    expect(trackDistanceMeters([])).toBe(0);
  });

  test('returns 0 for a single point', () => {
    expect(trackDistanceMeters([pt(37.7749, -122.4194)])).toBe(0);
  });

  test('returns 0 when both points are identical', () => {
    const p = pt(37.7749, -122.4194);
    expect(trackDistanceMeters([p, pt(37.7749, -122.4194, 1000)])).toBe(0);
  });

  test('measures a one-degree step along the equator', () => {
    // One degree of longitude at the equator is ~111.19 km on a sphere.
    const meters = trackDistanceMeters([pt(0, 0), pt(0, 1, 1000)]);
    expect(meters).toBeGreaterThan(111_000);
    expect(meters).toBeLessThan(111_400);
  });

  test('measures a one-degree step along a meridian', () => {
    const meters = trackDistanceMeters([pt(0, 0), pt(1, 0, 1000)]);
    expect(meters).toBeGreaterThan(111_000);
    expect(meters).toBeLessThan(111_400);
  });

  test('sums consecutive segments', () => {
    const oneLeg = trackDistanceMeters([pt(0, 0), pt(0, 1, 1000)]);
    const twoLegs = trackDistanceMeters([
      pt(0, 0),
      pt(0, 1, 1000),
      pt(0, 2, 2000),
    ]);
    expect(twoLegs).toBeCloseTo(oneLeg * 2, 0);
  });

  test('measures a short walk to within a metre', () => {
    // ~100 m north of the start: 100 / 6371008.8 rad of latitude.
    const dLat = (100 / 6_371_008.8) * (180 / Math.PI);
    const meters = trackDistanceMeters([
      pt(37.7749, -122.4194),
      pt(37.7749 + dLat, -122.4194, 1000),
    ]);
    expect(meters).toBeCloseTo(100, 0);
  });

  test('accounts for longitude convergence at high latitude', () => {
    // A degree of longitude at 60°N spans about half what it does at the equator.
    const atEquator = trackDistanceMeters([pt(0, 0), pt(0, 1, 1000)]);
    const atSixty = trackDistanceMeters([pt(60, 0), pt(60, 1, 1000)]);
    expect(atSixty).toBeCloseTo(atEquator / 2, -3);
  });

  test('measures across the antimeridian without wrapping the long way', () => {
    const meters = trackDistanceMeters([pt(0, 179.5), pt(0, -179.5, 1000)]);
    // One degree apart, not 359.
    expect(meters).toBeLessThan(112_000);
  });
});

describe('convertFromMeters', () => {
  test('leaves metres unchanged', () => {
    expect(convertFromMeters(1234, 'm')).toBe(1234);
  });

  test('converts metres to kilometres', () => {
    expect(convertFromMeters(1500, 'km')).toBeCloseTo(1.5, 6);
  });

  test('converts metres to feet', () => {
    expect(convertFromMeters(1, 'ft')).toBeCloseTo(3.28084, 4);
  });

  test('converts metres to miles', () => {
    expect(convertFromMeters(1609.344, 'mi')).toBeCloseTo(1, 6);
  });

  test('converts zero to zero in every unit', () => {
    for (const unit of DISTANCE_UNITS) {
      expect(convertFromMeters(0, unit.value)).toBe(0);
    }
  });
});

describe('DISTANCE_UNITS', () => {
  test('offers feet, miles, metres, and kilometres', () => {
    const values = DISTANCE_UNITS.map((u) => u.value).sort();
    expect(values).toEqual(['ft', 'km', 'm', 'mi']);
  });

  test('gives every unit a label', () => {
    for (const unit of DISTANCE_UNITS) {
      expect(unit.label.length).toBeGreaterThan(0);
    }
  });
});

describe('formatDistanceValue', () => {
  test('omits the unit', () => {
    expect(formatDistanceValue(1500, 'km')).toBe('1.50');
  });

  test('rounds metres to whole numbers', () => {
    expect(formatDistanceValue(1234.6, 'm')).toBe('1,235');
  });

  test('pads kilometres to two decimals', () => {
    expect(formatDistanceValue(2000, 'km')).toBe('2.00');
  });
});

describe('formatDistance', () => {
  test('renders whole metres', () => {
    expect(formatDistance(1234.6, 'm')).toBe('1,235 m');
  });

  test('renders whole feet', () => {
    expect(formatDistance(1000, 'ft')).toBe('3,281 ft');
  });

  test('renders kilometres to two decimals', () => {
    expect(formatDistance(1500, 'km')).toBe('1.50 km');
  });

  test('renders miles to two decimals', () => {
    expect(formatDistance(1609.344, 'mi')).toBe('1.00 mi');
  });

  test('renders zero in each unit', () => {
    const expected: Record<DistanceUnit, string> = {
      m: '0 m',
      ft: '0 ft',
      km: '0.00 km',
      mi: '0.00 mi',
    };
    for (const [unit, text] of Object.entries(expected)) {
      expect(formatDistance(0, unit as DistanceUnit)).toBe(text);
    }
  });
});
