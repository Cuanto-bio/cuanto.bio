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
        await BackgroundGeolocation.start(
          {
            // Setting backgroundMessage is what actually enables background
            // delivery — without it the plugin only guarantees foreground
            // fixes. On iOS it also makes the plugin call
            // requestAlwaysAuthorization(); we deliberately omit
            // NSLocationAlwaysAndWhenInUseUsageDescription from Info.plist so
            // that request is inert and the user is only ever asked for
            // "While Using App". See phase 3 §3.2.
            backgroundMessage: 'Recording your survey track.',
            backgroundTitle: 'Cuanto',
            requestPermissions: true,
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
