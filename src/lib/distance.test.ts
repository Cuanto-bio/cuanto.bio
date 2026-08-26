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

function pt(
  lat: number,
  lng: number,
  offsetMs = 0,
  accuracy?: number,
): GpsTrackPoint {
  return { lat, lng, timestamp: t0 + offsetMs, accuracy };
}

// Latitude reached by moving `meters` due north of `lat`, for building test
// points at a known, small distance apart without depending on the function
// under test to compute it.
function northOf(lat: number, meters: number): number {
  return lat + (meters / 6_371_008.8) * (180 / Math.PI);
}

const sf = { lat: 37.7749, lng: -122.4194 };

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

describe('trackDistanceMeters accuracy-aware jitter filtering', () => {
  test('ignores jitter within the combined accuracy circle (stationary)', () => {
    const p0 = pt(sf.lat, sf.lng, 0, 8);
    const p1 = pt(northOf(sf.lat, 5), sf.lng, 1000, 8);
    const p2 = pt(northOf(sf.lat, -3), sf.lng, 2000, 8);
    const p3 = pt(northOf(sf.lat, 6), sf.lng, 3000, 8);
    expect(trackDistanceMeters([p0, p1, p2, p3])).toBe(0);
  });

  test('still counts a movement that exceeds the combined accuracy circle', () => {
    const p0 = pt(sf.lat, sf.lng, 0, 5);
    const p1 = pt(northOf(sf.lat, 50), sf.lng, 1000, 5);
    expect(trackDistanceMeters([p0, p1])).toBeCloseTo(50, 0);
  });

  test('does not inflate a real walk with jitter before or after it', () => {
    const p0 = pt(sf.lat, sf.lng, 0, 8);
    const p1 = pt(northOf(sf.lat, 4), sf.lng, 1000, 8); // jitter near start
    const p2 = pt(northOf(sf.lat, 100), sf.lng, 2000, 8); // real walk
    const p3 = pt(northOf(sf.lat, 105), sf.lng, 3000, 8); // jitter near end
    expect(trackDistanceMeters([p0, p1, p2, p3])).toBeCloseTo(100, 0);
  });

  test('accumulates slow real drift once it clears the noise threshold, even though each step alone would not', () => {
    const acc = 2; // combined threshold with itself: 4 m
    const points = [0, 1.5, 3, 4.5, 6, 7.5, 9].map((meters, i) =>
      pt(northOf(sf.lat, meters), sf.lng, i * 1000, acc),
    );
    // Real distance traveled is 9 m, even though a filter that only compared
    // each point to its immediate predecessor (1.5 m hops, each under the
    // 4 m threshold) would never register any movement at all.
    expect(trackDistanceMeters(points)).toBeCloseTo(9, 0);
  });

  test('does not filter movement when accuracy is missing on either point', () => {
    const p0 = pt(sf.lat, sf.lng, 0);
    const p1 = pt(northOf(sf.lat, 3), sf.lng, 1000);
    expect(trackDistanceMeters([p0, p1])).toBeCloseTo(3, 0);
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
