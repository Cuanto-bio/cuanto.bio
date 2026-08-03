import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * Bridges `navigator.vibrate()` to the native Taptic engine.
 *
 * WKWebView has no Vibration API, so the app's existing `navigator.vibrate()`
 * calls — the survey-count tap at SurveyForm — are silent no-ops on iOS. This
 * replaces `navigator.vibrate` on the native platform so those calls fire real
 * haptics, with zero changes to the live-served web code (which still calls the
 * standard API, and works unmodified in Android Chrome where it already exists).
 *
 * Called only on native (from hooks.client). The mapping is deliberately coarse
 * because iOS haptics are discrete events, not arbitrary durations: a short buzz
 * becomes a crisp light impact (the count-feedback feel); anything longer maps
 * to a real vibration of that length.
 */
const SHORT_MS = 40;

export function installVibrateBridge(): void {
  if (typeof navigator === 'undefined') return;

  // Viewed through an optional-vibrate shape: lib.dom declares navigator.vibrate
  // as always-present, which would narrow the post-guard branch to `never` and
  // make the assignment un-typeable. This view lets the presence check narrow
  // correctly.
  const nav = navigator as {
    vibrate?: (pattern: VibratePattern | Iterable<number>) => boolean;
  };

  // Only bridge where the platform lacks a native Vibration API — i.e. iOS
  // WKWebView. Android WebView (and every real browser, including Chrome on
  // Android) already implements navigator.vibrate, so leave those untouched
  // rather than route a working API through the plugin. The caller in
  // hooks.client also gates this on isNative(), so this never runs on the web.
  if (typeof nav.vibrate === 'function') return;

  nav.vibrate = (pattern: VibratePattern | Iterable<number>): boolean => {
    // Vibration API accepts a duration, a [vibrate, pause, …] pattern, or any
    // iterable of numbers. Take the first burst, which is all the Taptic engine
    // can meaningfully render.
    const ms =
      typeof pattern === 'number' ? pattern : (Array.from(pattern)[0] ?? 0);
    // 0 / empty is a cancel in the Vibration API; there is nothing to cancel on
    // the Taptic engine, so treat it as a successful no-op.
    if (!ms) return true;

    const done =
      ms <= SHORT_MS
        ? Haptics.impact({ style: ImpactStyle.Light })
        : Haptics.vibrate({ duration: ms });
    // Fire and forget: navigator.vibrate is synchronous and returns a boolean,
    // and a haptics failure must never break the caller.
    done.catch(() => {});
    return true;
  };
}
