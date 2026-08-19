import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@capgo/background-geolocation', () => ({
  BackgroundGeolocation: {
    start: vi.fn(),
    stop: vi.fn(),
    requestPermissions: vi.fn(),
  },
}));

import {
  BackgroundGeolocation,
  type Location,
} from '@capgo/background-geolocation';
import { nativeGpsSource, toTrackPoint } from './nativeSource';

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

describe('nativeGpsSource', () => {
  beforeEach(() => {
    vi.mocked(BackgroundGeolocation.requestPermissions).mockReset();
    vi.mocked(BackgroundGeolocation.start).mockReset();
  });

  // The plugin's own start()-time permission handling calls
  // requestAlwaysAuthorization() whenever backgroundMessage is set, which is a
  // silent no-op on iOS unless Info.plist also declares
  // NSLocationAlwaysAndWhenInUseUsageDescription — it does not, and never
  // prompts, and never starts. We must request "When In Use" ourselves and
  // tell start() not to request permissions on its own.
  test('requests When In Use permission itself before starting, and tells start() not to', async () => {
    const requestPermissions = vi.mocked(
      BackgroundGeolocation.requestPermissions,
    );
    const start = vi.mocked(BackgroundGeolocation.start);
    requestPermissions.mockResolvedValue({
      location: 'granted',
      backgroundLocation: 'when_in_use',
    });
    start.mockResolvedValue(undefined);

    await nativeGpsSource().start(vi.fn(), vi.fn());

    expect(requestPermissions).toHaveBeenCalledWith({
      permissions: ['location'],
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ requestPermissions: false }),
      expect.any(Function),
    );
    expect(requestPermissions.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0],
    );
  });

  test('reports an error if requesting permission rejects, rather than starting anyway', async () => {
    const requestPermissions = vi.mocked(
      BackgroundGeolocation.requestPermissions,
    );
    const start = vi.mocked(BackgroundGeolocation.start);
    const permissionError = new Error('boom');
    requestPermissions.mockRejectedValue(permissionError);
    const onError = vi.fn();

    await nativeGpsSource().start(vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith(permissionError);
    expect(start).not.toHaveBeenCalled();
  });
});
