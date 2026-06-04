import { accumulate, emptyWindow, type WindowState } from '$lib/gpsTrackWindow';
import type { GpsTrackPoint } from '$lib/gpx';

export function useGpsTrack(initialPoints: GpsTrackPoint[] = []) {
  const points = $state<GpsTrackPoint[]>(initialPoints);
  let isRecording = $state(false);
  let watchId: number | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  let hiddenAt: number | null = null;
  let recordWindow: WindowState = emptyWindow();

  function onPosition(pos: GeolocationPosition) {
    // Keep the best (lowest-accuracy) fix per interval rather than the first
    // one to arrive; the device pushes better fixes between window boundaries.
    const result = accumulate(recordWindow, {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      timestamp: pos.timestamp,
      accuracy: pos.coords.accuracy,
    });
    recordWindow = result.state;
    if (result.emit) points.push(result.emit);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt !== null) {
      // Re-acquire wake lock after returning to foreground (it's released on hide)
      acquireWakeLock();
      hiddenAt = null;
    }
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Wake lock is best-effort; ignore if unavailable (e.g. battery saver mode)
    }
  }

  function releaseWakeLock() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  // Push the in-progress window's best point so the final partial window
  // (which never closes on its own) isn't lost when recording ends.
  function flushWindow() {
    if (recordWindow.best) points.push(recordWindow.best);
    recordWindow = emptyWindow();
  }

  async function start() {
    if (isRecording || !('geolocation' in navigator)) return;
    isRecording = true;
    recordWindow = emptyWindow();
    watchId = navigator.geolocation.watchPosition(onPosition, onWatchError, {
      enableHighAccuracy: true,
    });
    document.addEventListener('visibilitychange', onVisibilityChange);
    await acquireWakeLock();
  }

  function onWatchError() {
    // Geolocation failed (permission denied, position unavailable, timeout, …).
    // Reset recording state so the UI doesn't claim we're still tracking.
    if (!isRecording) return;
    isRecording = false;
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    releaseWakeLock();
    flushWindow();
  }

  function stop() {
    if (!isRecording) return;
    isRecording = false;
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    releaseWakeLock();
    flushWindow();
  }

  return {
    get points() {
      return points;
    },
    get isRecording() {
      return isRecording;
    },
    start,
    stop,
  };
}
