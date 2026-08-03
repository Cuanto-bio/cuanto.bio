import { beforeEach, describe, expect, test, vi } from 'vitest';

const { impact, vibrate } = vi.hoisted(() => ({
  impact: vi.fn().mockResolvedValue(undefined),
  vibrate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact, vibrate },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

import { installVibrateBridge } from './haptics';

beforeEach(() => {
  vi.clearAllMocks();
  // Simulate a platform with no native Vibration API (iOS WKWebView): remove
  // any vibrate a previous test installed, so the bridge sees the API missing
  // and patches. Deleting, not setting undefined — the bridge keys on
  // `'vibrate' in navigator`, and an undefined own property still counts as
  // present.
  // biome-ignore lint/suspicious/noExplicitAny: resetting the patched global
  delete (navigator as any).vibrate;
  installVibrateBridge();
});

describe('navigator.vibrate bridge', () => {
  test('a short buzz becomes a light impact', () => {
    expect(navigator.vibrate(10)).toBe(true);
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(vibrate).not.toHaveBeenCalled();
  });

  test('a long buzz becomes a vibration of that duration', () => {
    navigator.vibrate(200);
    expect(vibrate).toHaveBeenCalledWith({ duration: 200 });
    expect(impact).not.toHaveBeenCalled();
  });

  test('a pattern uses its first burst', () => {
    navigator.vibrate([12, 50, 12]);
    expect(impact).toHaveBeenCalledTimes(1);
  });

  test('0 is a no-op (nothing to cancel on the Taptic engine)', () => {
    expect(navigator.vibrate(0)).toBe(true);
    expect(impact).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  test('an empty pattern is a no-op', () => {
    navigator.vibrate([]);
    expect(impact).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  // navigator.vibrate must stay synchronous and boolean-returning; a rejected
  // haptics promise must not surface to the caller.
  test('swallows a haptics failure and still returns true', async () => {
    impact.mockRejectedValueOnce(new Error('no taptic engine'));
    expect(navigator.vibrate(5)).toBe(true);
    await Promise.resolve();
  });

  // Where the platform already implements vibration (Android WebView, Chrome),
  // leave it alone rather than route a working API through the plugin.
  test('does not replace an existing native vibrate', () => {
    const nativeVibrate = vi.fn(() => true);
    // biome-ignore lint/suspicious/noExplicitAny: installing a fake native API
    (navigator as any).vibrate = nativeVibrate;
    installVibrateBridge();
    navigator.vibrate(10);
    expect(nativeVibrate).toHaveBeenCalledWith(10);
    expect(impact).not.toHaveBeenCalled();
  });
});
