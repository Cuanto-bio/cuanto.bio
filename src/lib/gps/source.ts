import type { GpsTrackPoint } from '$lib/gpx';

/**
 * A source of raw GPS fixes. `useGpsTrack` consumes one of these and is
 * otherwise unaware of the platform, so the windowing, persistence and UI logic
 * stay identical on web and native.
 */
export interface GpsSource {
  /**
   * Begins delivering fixes. `onFix` is called once per fix, in a live JS
   * context — phase 0 confirmed on device that iOS keeps the webview running
   * while a background location session is active, so there is no buffer to
   * drain and no batch to replay.
   */
  start(
    onFix: (fix: GpsTrackPoint) => void,
    onError: (err?: unknown) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  /**
   * Whether fixes keep arriving once the screen locks or the app is
   * backgrounded.
   *
   * This is what decides whether to hold a screen wake lock, rather than a
   * platform check at the call site: the wake lock exists *only* to stop the
   * browser suspending JS, so a source that survives backgrounding on its own
   * must not burn the display. Expressing it as a capability keeps that
   * reasoning next to the thing it depends on.
   */
  readonly worksInBackground: boolean;
}
