import type { GpsTrackPoint } from '$lib/gpx';
import type { GpsSource } from './source';

/**
 * Browser `watchPosition`. Unchanged from what useGpsTrack did inline before
 * the native source existed.
 *
 * Does not survive backgrounding: iOS suspends JS on screen lock, which is the
 * entire reason the native shell exists. Callers compensate with a screen wake
 * lock, at the cost of burning the display for the length of a survey.
 */
export function webGpsSource(): GpsSource {
  let watchId: number | null = null;

  return {
    worksInBackground: false,

    async start(onFix, onError) {
      if (!('geolocation' in navigator)) {
        onError(new Error('Geolocation unavailable'));
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (pos: GeolocationPosition) => {
          const fix: GpsTrackPoint = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            timestamp: pos.timestamp,
            accuracy: pos.coords.accuracy,
          };
          onFix(fix);
        },
        // Permission denied, position unavailable, timeout, …
        (err) => onError(err),
        { enableHighAccuracy: true },
      );
    },

    async stop() {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    },
  };
}
