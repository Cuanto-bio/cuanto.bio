import { nativeGpsSource } from '$lib/gps/nativeSource';
import type { GpsSource } from '$lib/gps/source';
import { webGpsSource } from '$lib/gps/webSource';
import { accumulate, emptyWindow, type WindowState } from '$lib/gpsTrackWindow';
import type { GpsTrackPoint } from '$lib/gpx';
import { isNative } from '$lib/platform';

export function useGpsTrack(
  initialPoints: GpsTrackPoint[] = [],
  // Injectable so tests and future callers can supply a source; defaults to
  // whichever one this platform can actually use.
  source: GpsSource = isNative() ? nativeGpsSource() : webGpsSource(),
) {
  const points = $state<GpsTrackPoint[]>(initialPoints);
  let isRecording = $state(false);
  let wakeLock: WakeLockSentinel | null = null;
  let hiddenAt: number | null = null;
  let recordWindow: WindowState = emptyWindow();

  // The screen wake lock exists only to stop the browser suspending JS while
  // the user walks. A source that keeps delivering in the background does not
  // need it, and holding it there would burn the display for the length of a
  // survey — the exact cost the native shell was built to remove.
  const needsWakeLock = !source.worksInBackground;

  function onFix(fix: GpsTrackPoint) {
    // Keep the best (lowest-accuracy) fix per interval rather than the first
    // one to arrive; the device pushes better fixes between window boundaries.
    const result = accumulate(recordWindow, fix);
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
    if (!needsWakeLock || !('wakeLock' in navigator)) {
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
    if (isRecording) return;
    isRecording = true;
    recordWindow = emptyWindow();
    if (needsWakeLock) {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    await source.start(onFix, onSourceError);
    // The source can fail synchronously (e.g. geolocation unavailable), which
    // runs onSourceError → teardown() before we get here. Only take the wake
    // lock if we're still recording, or we'd hold one nothing ever releases.
    if (isRecording) await acquireWakeLock();
  }

  function onSourceError() {
    // The source failed (permission denied, position unavailable, timeout, …).
    // Reset recording state so the UI doesn't claim we're still tracking.
    if (!isRecording) return;
    teardown();
  }

  function teardown() {
    isRecording = false;
    source.stop().catch(() => {
      // Already stopped, or the plugin is gone. Nothing useful to do, and the
      // local state is what the UI reads.
    });
    if (needsWakeLock) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    releaseWakeLock();
    flushWindow();
  }

  function stop() {
    if (!isRecording) return;
    teardown();
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
