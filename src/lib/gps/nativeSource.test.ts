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
  type CallbackError,
  type Location,
} from '@capgo/background-geolocation';
import { nativeGpsSource, toTrackPoint } from './nativeSource';

type StartCallback = (location?: Location, error?: CallbackError) => void;

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

function alreadyStartedError(): CallbackError {
  return Object.assign(new Error('Service already started'), {
    code: 'ALREADY_STARTED',
  });
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
    vi.mocked(BackgroundGeolocation.stop).mockReset();
    vi.mocked(BackgroundGeolocation.stop).mockResolvedValue(undefined);
    // capgo's start() is a callback-style method: the promise resolves as soon
    // as the call is registered, and events (fixes and errors alike) arrive
    // through the callback afterwards.
    vi.mocked(BackgroundGeolocation.start).mockResolvedValue(undefined);
  });

  // The plugin's own start()-time permission handling only asks for 'location',
  // but this app also needs Android's foreground-service 'notification'
  // permission, so we request both ourselves and pass requestPermissions: false.
  test('requests location and notification permission itself before starting, and tells start() not to', async () => {
    const requestPermissions = vi.mocked(
      BackgroundGeolocation.requestPermissions,
    );
    const start = vi.mocked(BackgroundGeolocation.start);
    requestPermissions.mockResolvedValue({
      location: 'granted',
      backgroundLocation: 'when_in_use',
    });

    await nativeGpsSource().start(vi.fn(), vi.fn());

    expect(requestPermissions).toHaveBeenCalledWith({
      permissions: ['location', 'notification'],
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

  test('forwards a fix delivered through the callback to onFix', async () => {
    vi.mocked(BackgroundGeolocation.requestPermissions).mockResolvedValue({
      location: 'granted',
      backgroundLocation: 'when_in_use',
    });
    const start = vi.mocked(BackgroundGeolocation.start);
    const onFix = vi.fn();

    await nativeGpsSource().start(onFix, vi.fn());
    const callback = start.mock.calls[0][1] as StartCallback;
    callback(loc());

    expect(onFix).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 37.8, lng: -122.24, accuracy: 8 }),
    );
  });

  // A WebView reload (the service-worker update prompt, issue #64) tears down
  // the JS context but leaves the native location session running. Capacitor's
  // bridge.reset() drops the saved start() callback, so the old session now
  // delivers fixes nowhere, and this start() reports ALREADY_STARTED — through
  // the callback, not a promise rejection. The source must clear the orphaned
  // session and start a new one bound to this context's callback, not surface
  // an error.
  test('recovers from an ALREADY_STARTED error delivered through the start callback', async () => {
    vi.mocked(BackgroundGeolocation.requestPermissions).mockResolvedValue({
      location: 'granted',
      backgroundLocation: 'when_in_use',
    });
    const start = vi.mocked(BackgroundGeolocation.start);
    const stop = vi.mocked(BackgroundGeolocation.stop);

    const onFix = vi.fn();
    const onError = vi.fn();
    await nativeGpsSource().start(onFix, onError);

    const firstCallback = start.mock.calls[0][1] as StartCallback;
    firstCallback(undefined, alreadyStartedError());

    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));

    expect(onError).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    // stop() runs between the failed first start and the retry.
    expect(start.mock.invocationCallOrder[0]).toBeLessThan(
      stop.mock.invocationCallOrder[0],
    );
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[1],
    );

    // The retry registered a live callback: a fix now reaches this onFix.
    const retryCallback = start.mock.calls[1][1] as StartCallback;
    retryCallback(loc());
    expect(onFix).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 37.8, lng: -122.24 }),
    );
  });

  test('forwards a non-ALREADY_STARTED callback error to onError, without stopping or retrying', async () => {
    vi.mocked(BackgroundGeolocation.requestPermissions).mockResolvedValue({
      location: 'granted',
      backgroundLocation: 'when_in_use',
    });
    const start = vi.mocked(BackgroundGeolocation.start);
    const stop = vi.mocked(BackgroundGeolocation.stop);
    const onError = vi.fn();

    await nativeGpsSource().start(vi.fn(), onError);
    const callback = start.mock.calls[0][1] as StartCallback;
    const denied = Object.assign(new Error('denied'), {
      code: 'NOT_AUTHORIZED',
    });
    callback(undefined, denied);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(denied);
    expect(stop).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('surfaces the error, without looping, when the restart after ALREADY_STARTED also reports it', async () => {
    vi.mocked(BackgroundGeolocation.requestPermissions).mockResolvedValue({
      location: 'granted',
      backgroundLocation: 'when_in_use',
    });
    const start = vi.mocked(BackgroundGeolocation.start);
    const stop = vi.mocked(BackgroundGeolocation.stop);
    const onError = vi.fn();

    await nativeGpsSource().start(vi.fn(), onError);

    const persistent = alreadyStartedError();
    (start.mock.calls[0][1] as StartCallback)(undefined, persistent);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));

    (start.mock.calls[1][1] as StartCallback)(undefined, persistent);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(persistent);
    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
