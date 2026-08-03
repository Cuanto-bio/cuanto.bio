import { Capacitor } from '@capacitor/core';

/**
 * True when running inside the native shell rather than a browser.
 *
 * Kept behind a wrapper rather than importing Capacitor at each call site so
 * there is one place to reason about, and so web-only code paths read as
 * intent ("not native") instead of as a dependency on a native SDK.
 *
 * Safe on the web: @capacitor/core degrades to a web implementation when no
 * native bridge is present, so this is simply false in a browser.
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
