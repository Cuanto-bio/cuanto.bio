import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@capgo/background-geolocation', () => ({
  BackgroundGeolocation: {
    start: vi.fn(),
    stop: vi.fn(),
    requestPermissions: vi.fn(),
    updateNotification: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: vi.fn(() => 'android') },
}));

import { Capacitor } from '@capacitor/core';

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
    vi.mocked(BackgroundGeolocation.requestPermissions).mockResolvedValue({
      location: 'granted',
      backgroundLocation: 'when_in_use',
    });
    vi.mocked(BackgroundGeolocation.updateNotification).mockReset();
    vi.mocked(BackgroundGeolocation.updateNotification).mockResolvedValue(
      undefined,
    );
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
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

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/91: the foreground-service
  // notification shows elapsed time (a native chronometer counting up from
  // notificationStartedAt) and the distance traveled so far.
  test('starts the notification with the reported start time and distance', async () => {
    const start = vi.mocked(BackgroundGeolocation.start);
    const source = nativeGpsSource();

    source.setStatus?.({ startedAt: 1_700_000_000_000, distanceMeters: 1234 });
    await source.start(vi.fn(), vi.fn());

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundTitle: 'Recording survey track',
        backgroundMessage: '1.23 km traveled',
        notificationStartedAt: 1_700_000_000_000,
      }),
      expect.any(Function),
    );
  });

  test('restarts with the latest status after recovering from ALREADY_STARTED', async () => {
    const start = vi.mocked(BackgroundGeolocation.start);
    const source = nativeGpsSource();

    source.setStatus?.({ startedAt: 1_000, distanceMeters: 0 });
    await source.start(vi.fn(), vi.fn());
    source.setStatus?.({ startedAt: 1_000, distanceMeters: 2500 });
    (start.mock.calls[0][1] as StartCallback)(undefined, alreadyStartedError());
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));

    expect(start.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        backgroundMessage: '2.50 km traveled',
        notificationStartedAt: 1_000,
      }),
    );
  });

  test('updates the notification when the status changes while recording', async () => {
    const updateNotification = vi.mocked(
      BackgroundGeolocation.updateNotification,
    );
    const source = nativeGpsSource();
    source.setStatus?.({ startedAt: 1_000, distanceMeters: 0 });
    expect(updateNotification).not.toHaveBeenCalled();

    await source.start(vi.fn(), vi.fn());
    source.setStatus?.({ startedAt: 1_000, distanceMeters: 500 });

    expect(updateNotification).toHaveBeenCalledWith({
      title: 'Recording survey track',
      message: '0.50 km traveled',
    });
  });

  test('stops updating the notification once recording stops', async () => {
    const updateNotification = vi.mocked(
      BackgroundGeolocation.updateNotification,
    );
    const source = nativeGpsSource();
    await source.start(vi.fn(), vi.fn());
    await source.stop();

    source.setStatus?.({ startedAt: 1_000, distanceMeters: 500 });

    expect(updateNotification).not.toHaveBeenCalled();
  });

  // iOS has no tracking notification; the plugin only implements this on
  // Android, and calling it on iOS would reject as unimplemented.
  test('does not update a notification on iOS', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    const updateNotification = vi.mocked(
      BackgroundGeolocation.updateNotification,
    );
    const source = nativeGpsSource();
    await source.start(vi.fn(), vi.fn());

    source.setStatus?.({ startedAt: 1_000, distanceMeters: 500 });

    expect(updateNotification).not.toHaveBeenCalled();
  });

  test('swallows a failed notification update rather than surfacing it', async () => {
    vi.mocked(BackgroundGeolocation.updateNotification).mockRejectedValue(
      new Error('NOT_STARTED'),
    );
    const onError = vi.fn();
    const source = nativeGpsSource();
    await source.start(vi.fn(), onError);

    source.setStatus?.({ startedAt: 1_000, distanceMeters: 500 });
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });
});
