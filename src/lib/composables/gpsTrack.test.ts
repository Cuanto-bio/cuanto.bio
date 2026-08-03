import { afterEach, describe, expect, test, vi } from 'vitest';
import type { GpsSource } from '$lib/gps/source';
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
    const track = useGpsTrack([], source);

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
    const track = useGpsTrack([], source);

    await track.start();
    expect(track.isRecording).toBe(true);
    expect(env.activeLocks).toBe(1);

    track.stop();
    expect(track.isRecording).toBe(false);
    expect(env.activeLocks).toBe(0);
  });
});
