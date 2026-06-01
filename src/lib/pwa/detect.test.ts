import { describe, expect, it } from 'vitest';
import { detectBrowserFamily, isIOS, isStandalone } from './detect';

// Representative real-world UA strings.
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/116.0.5845.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/116.0 Mobile/15E148 Safari/605.1.15',
  ipadSafariLegacy:
    'Mozilla/5.0 (iPad; CPU OS 13_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
  androidFirefox:
    'Mozilla/5.0 (Android 13; Mobile; rv:116.0) Gecko/116.0 Firefox/116.0',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/22.0 Chrome/111.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
  desktopFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:116.0) Gecko/20100101 Firefox/116.0',
  desktopEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.62',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  ipadDesktopSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  unknown: 'SomeWeirdBot/1.0',
};

describe('detectBrowserFamily', () => {
  it('classifies iOS Safari as webkit', () => {
    expect(detectBrowserFamily(UA.iphoneSafari)).toBe('webkit');
    expect(detectBrowserFamily(UA.ipadSafariLegacy)).toBe('webkit');
  });

  it('classifies non-Safari iOS browsers as other (not firefox/chromium)', () => {
    expect(detectBrowserFamily(UA.iphoneChrome)).toBe('other');
    expect(detectBrowserFamily(UA.iphoneFirefox)).toBe('other');
  });

  it('classifies desktop/Android Firefox as firefox', () => {
    expect(detectBrowserFamily(UA.androidFirefox)).toBe('firefox');
    expect(detectBrowserFamily(UA.desktopFirefox)).toBe('firefox');
  });

  it('classifies Chromium-family browsers as chromium', () => {
    expect(detectBrowserFamily(UA.androidChrome)).toBe('chromium');
    expect(detectBrowserFamily(UA.androidSamsung)).toBe('chromium');
    expect(detectBrowserFamily(UA.desktopChrome)).toBe('chromium');
    expect(detectBrowserFamily(UA.desktopEdge)).toBe('chromium');
  });

  it('classifies desktop Safari as webkit', () => {
    expect(detectBrowserFamily(UA.macSafari)).toBe('webkit');
  });

  it('falls back to other for unknown UAs', () => {
    expect(detectBrowserFamily(UA.unknown)).toBe('other');
  });
});

describe('isStandalone', () => {
  it('is true when display-mode standalone matches', () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
  });

  it('is true when iOS navigator.standalone is set', () => {
    expect(
      isStandalone({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: true },
      }),
    ).toBe(true);
  });

  it('is false in a normal browser tab', () => {
    expect(
      isStandalone({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: false },
      }),
    ).toBe(false);
  });
});

describe('isIOS', () => {
  it('is true for iPhone/iPad/iPod UAs', () => {
    expect(isIOS(UA.iphoneSafari)).toBe(true);
    expect(isIOS(UA.ipadSafariLegacy)).toBe(true);
    expect(isIOS(UA.iphoneFirefox)).toBe(true);
  });

  it('is true for iPadOS-reports-as-Mac when touch is present', () => {
    expect(
      isIOS(UA.ipadDesktopSafari, { navigator: { maxTouchPoints: 5 } }),
    ).toBe(true);
  });

  it('is false for a real Mac (no touch)', () => {
    expect(isIOS(UA.macSafari, { navigator: { maxTouchPoints: 0 } })).toBe(
      false,
    );
  });

  it('is false for Android/desktop', () => {
    expect(isIOS(UA.androidChrome)).toBe(false);
    expect(isIOS(UA.desktopChrome)).toBe(false);
  });
});
