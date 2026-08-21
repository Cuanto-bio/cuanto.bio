import {
  BackgroundGeolocation,
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
      try {
        // Setting backgroundMessage below is what actually enables background
        // delivery — without it the plugin only guarantees foreground fixes.
        // On iOS it also makes the plugin's own start()-time permission
        // handling call requestAlwaysAuthorization() instead of
        // requestWhenInUseAuthorization(). That call is a silent no-op unless
        // Info.plist also declares NSLocationAlwaysAndWhenInUseUsageDescription
        // — it doesn't, deliberately, since this app only ever wants to ask
        // "While Using App" (see phase 3 §3.2) — so left to itself it never
        // prompts and never starts. We request permission ourselves instead
        // and tell start() below not to.
        //
        // 'notification' is Android's foreground-service notification
        // permission (API 33+, a no-op on iOS). Declaring it in the manifest
        // isn't enough — on 13+ it's a runtime permission like location, so
        // without requesting it here the tracking notification is silently
        // suppressed while the foreground service keeps running regardless,
        // making it look like the notification is simply missing.
        await BackgroundGeolocation.requestPermissions({
          permissions: ['location', 'notification'],
        });

        await BackgroundGeolocation.start(
          {
            backgroundMessage: 'Recording your survey track.',
            backgroundTitle: 'Cuanto',
            requestPermissions: false,
            // Never hand us a cached fix: a stale position silently misplaces a
            // survey, and accumulate() has no way to tell one from a real fix.
            stale: false,
            // No plugin-side filtering. Phase 0 measured our own 10s windowing
            // reducing 6987 raw fixes to 699 points with *better* median
            // accuracy than raw, because it picks best-per-window. Delegating
            // to a distance filter would throw away the fixes it selects from.
            distanceFilter: 0,
          },
          (location?: Location, error?: unknown) => {
            if (error) {
              onError(error);
              return;
            }
            if (location) onFix(toTrackPoint(location));
          },
        );
      } catch (err) {
        // Permission denied, location services off, plugin failure.
        onError(err);
      }
    },

    async stop() {
      await BackgroundGeolocation.stop();
    },
  };
}
