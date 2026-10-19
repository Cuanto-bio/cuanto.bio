import { afterEach, describe, expect, test, vi } from 'vitest';
import { trackDistanceMeters } from '$lib/distance';
import type { GpsSource } from '$lib/gps/source';
import type { GpsTrackPoint } from '$lib/gpx';
import { useGpsTrack } from './gpsTrack.svelte';

// Track how many wake locks are currently held so a leak (a lock acquired but
// never released) is observable, independent of how the fix is implemented.
function stubBrowserEnv() {
  let activeLocks = 0;
  const request = vi.fn(async () => {
    activeLocks += 1;
    return {
      release: vi.fn(async () => {
        activeLocks -= 1;
      }),
    } as unknown as WakeLockSentinel;
  });
  vi.stubGlobal('navigator', { wakeLock: { request } });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return {
    get activeLocks() {
      return activeLocks;
    },
    request,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useGpsTrack', () => {
  test('does not hold a wake lock when the source errors synchronously on start', async () => {
    const env = stubBrowserEnv();
    // A web-style source (worksInBackground: false, so it needs the screen wake
    // lock) that fails immediately, e.g. geolocation unavailable, invoking
    // onError before start() resolves.
    const source: GpsSource = {
      worksInBackground: false,
      start: async (_onFix, onError) => {
        onError(new Error('geolocation unavailable'));
      },
      stop: async () => {},
    };
    const track = useGpsTrack([], { source });

    await track.start();

    expect(track.isRecording).toBe(false);
    expect(env.activeLocks).toBe(0);
  });

  test('holds a wake lock while recording and releases it on stop', async () => {
    const env = stubBrowserEnv();
    const source: GpsSource = {
      worksInBackground: false,
      start: async () => {},
      stop: async () => {},
    };
    const track = useGpsTrack([], { source });

    await track.start();
    expect(track.isRecording).toBe(true);
    expect(env.activeLocks).toBe(1);

    track.stop();
    expect(track.isRecording).toBe(false);
    expect(env.activeLocks).toBe(0);
  });

  // The Android foreground-service notification shows these while recording
  // (https://tangled.org/cuanto.bio/cuanto.bio/issues/91), so the source has to
  // hear about them before it starts, and again as the track grows.
  test('reports the start time and distance so far to the source before starting it', async () => {
    stubBrowserEnv();
    const initialPoints = [
      { lat: 37.8, lng: -122.24, timestamp: 1_000, accuracy: 5 },
      { lat: 37.801, lng: -122.24, timestamp: 11_000, accuracy: 5 },
    ];
    const setStatus = vi.fn();
    const start = vi.fn(async () => {});
    const source: GpsSource = {
      worksInBackground: true,
      start,
      stop: async () => {},
      setStatus,
    };
    const track = useGpsTrack(initialPoints, {
      source,
      startedAt: () => 1_700_000_000_000,
    });

    await track.start();

    expect(setStatus).toHaveBeenCalledWith({
      startedAt: 1_700_000_000_000,
      distanceMeters: trackDistanceMeters(initialPoints),
    });
    expect(setStatus.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0],
    );
  });

  test('reports the updated distance to the source as points are recorded', async () => {
    stubBrowserEnv();
    let deliver: (fix: GpsTrackPoint) => void = () => {};
    const setStatus = vi.fn();
    const source: GpsSource = {
      worksInBackground: true,
      start: async (onFix) => {
        deliver = onFix;
      },
      stop: async () => {},
      setStatus,
    };
    const track = useGpsTrack([], { source, startedAt: () => 42 });

    await track.start();
    // One fix a second for two minutes, walking north, so the windowing
    // commits several points that are well clear of each other's accuracy.
    for (let i = 0; i < 120; i++) {
      deliver({
        lat: 37.8 + i * 0.0001,
        lng: -122.24,
        timestamp: 1_700_000_000_000 + i * 1_000,
        accuracy: 5,
      });
    }

    expect(track.points.length).toBeGreaterThan(1);
    const distanceMeters = trackDistanceMeters(track.points);
    expect(distanceMeters).toBeGreaterThan(0);
    expect(setStatus).toHaveBeenLastCalledWith({
      startedAt: 42,
      distanceMeters,
    });
  });
});
