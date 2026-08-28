import {
  BackgroundGeolocation,
  type CallbackError,
  type Location,
} from '@capgo/background-geolocation';
import type { GpsTrackPoint } from '$lib/gpx';
import type { GpsSource } from './source';

/**
 * Maps a capgo fix onto our point shape.
 *
 * `time` is nullable in the plugin's own types, so it falls back to arrival
 * time. That is worse than a real fix timestamp but better than a null
 * propagating into the windowing, which sorts and diffs on it.
 *
 * Exported for testing: this mapping is the seam where the plugin's shape meets
 * ours, and it is the part most likely to break on a plugin upgrade.
 */
export function toTrackPoint(loc: Location, now = Date.now()): GpsTrackPoint {
  return {
    lat: loc.latitude,
    lng: loc.longitude,
    timestamp: loc.time ?? now,
    accuracy: loc.accuracy,
  };
}

/**
 * `@capgo/background-geolocation`, chosen in phase 0 over
 * `@capacitor-community/background-geolocation` on maintenance grounds (the
 * latter has an unanswered crash-on-backgrounding report against Capacitor 8).
 *
 * Verified on device 2026-07-21: two hours backgrounded, no termination,
 * metronomic 1Hz delivery into a live JS context.
 */
export function nativeGpsSource(): GpsSource {
  return {
    worksInBackground: true,

    async start(onFix, onError) {
      const startOptions = {
        backgroundMessage: 'Recording your survey track.',
        backgroundTitle: 'Cuanto',
        requestPermissions: false,
        // Never hand us a cached fix: a stale position silently misplaces a
        // survey, and accumulate() has no way to tell one from a real fix.
        stale: false,
        // No plugin-side filtering. Phase 0 measured our own 10s windowing
        // reducing 6987 raw fixes to 699 points with *better* median accuracy
        // than raw, because it picks best-per-window. Delegating to a distance
        // filter would throw away the fixes it selects from.
        distanceFilter: 0,
      };

      // capgo's start() is a callback-style plugin method: the promise resolves
      // as soon as the call is registered, and *every* later event, failures
      // included, arrives through this callback's `error` argument. Its own
      // types say so ("Don't rely on promise rejection for this"). So
      // ALREADY_STARTED has to be handled here, not in a try/catch.
      let recovering = false;
      const onUpdate = (location?: Location, error?: CallbackError) => {
        if (error) {
          // A WebView reload (the service-worker update prompt, issue #64) tears
          // down the JS context but not the native plugin, so the previous
          // survey's location session is still running. Capacitor's
          // bridge.reset() dropped that session's saved callback, so it now
          // delivers fixes nowhere, and this start() comes straight back here
          // with ALREADY_STARTED. Stop the orphaned session and start once
          // more, binding this context's callback. `recovering` guards against
          // looping if the restart keeps failing. stop() is a safe no-op when
          // nothing is running (both platforms).
          if (error.code === 'ALREADY_STARTED' && !recovering) {
            recovering = true;
            BackgroundGeolocation.stop()
              .then(() => BackgroundGeolocation.start(startOptions, onUpdate))
              .catch(onError);
            return;
          }
          onError(error);
          return;
        }
        if (location) onFix(toTrackPoint(location));
      };

      try {
        // We request permission ourselves and pass requestPermissions: false so
        // the plugin's own start()-time handling is skipped. It asks only for
        // 'location'; this app also needs Android's foreground-service
        // 'notification' permission (API 33+, a no-op on iOS) — without it the
        // tracking notification is silently suppressed while the service runs
        // anyway, looking like the notification is just missing. The prompt also
        // has to stay "While Using App": this app deliberately never declares
        // NSLocationAlwaysAndWhenInUseUsageDescription (see phase 3 §3.2, and
        // patches/@capgo__background-geolocation.patch, which forces the
        // plugin's own CLLocationManager calls to requestWhenInUseAuthorization).
        //
        // backgroundMessage in startOptions is what actually enables background
        // delivery — without it the plugin only guarantees foreground fixes.
        await BackgroundGeolocation.requestPermissions({
          permissions: ['location', 'notification'],
        });

        await BackgroundGeolocation.start(startOptions, onUpdate);
      } catch (err) {
        // requestPermissions() rejected, or start() failed before it even
        // registered. Runtime start() failures come through onUpdate above.
        onError(err);
      }
    },

    async stop() {
      await BackgroundGeolocation.stop();
    },
  };
}
