import { describe, expect, test, vi } from 'vitest';

vi.mock('@capgo/background-geolocation', () => ({
  BackgroundGeolocation: { start: vi.fn(), stop: vi.fn() },
}));

import type { Location } from '@capgo/background-geolocation';
import { toTrackPoint } from './nativeSource';

function loc(overrides: Partial<Location> = {}): Location {
  return {
    latitude: 37.8,
    longitude: -122.24,
    accuracy: 8,
    altitude: null,
    altitudeAccuracy: null,
    simulated: false,
    bearing: null,
    speed: null,
    time: 1_700_000_000_000,
    ...overrides,
  };
}

describe('toTrackPoint', () => {
  test('maps the fields the track cares about', () => {
    expect(toTrackPoint(loc())).toEqual({
      lat: 37.8,
      lng: -122.24,
      timestamp: 1_700_000_000_000,
      accuracy: 8,
    });
  });

  // `time` is nullable in the plugin's own types. A null reaching the windowing
  // would poison it — accumulate() diffs timestamps to decide when a window
  // closes — so arrival time stands in.
  test('falls back to arrival time when the fix has no timestamp', () => {
    expect(toTrackPoint(loc({ time: null }), 123).timestamp).toBe(123);
  });

  test('keeps a zero timestamp rather than treating it as missing', () => {
    // 0 is a real epoch value and must not be swallowed by a falsy check.
    expect(toTrackPoint(loc({ time: 0 }), 123).timestamp).toBe(0);
  });

  test('preserves accuracy, which best-per-window selection depends on', () => {
    expect(toTrackPoint(loc({ accuracy: 42.5 })).accuracy).toBe(42.5);
  });
});
