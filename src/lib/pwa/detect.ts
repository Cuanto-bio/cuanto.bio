// Pure, framework-free browser/platform detection for the PWA install prompt.
// Kept dependency-free so it runs in vitest's node environment.

export type BrowserFamily = 'chromium' | 'webkit' | 'firefox' | 'other';

// Maps a user-agent string to the browser family whose install instructions we
// should show. iOS-wrapped browsers are handled first because on iOS every
// browser is WebKit regardless of its badge:
//   - iOS Safari            -> webkit (gets the share-sheet steps)
//   - non-Safari iOS browsers (FxiOS/CriOS/EdgiOS) -> other (generic Share steps;
//     NOT firefox/chromium, which would show the wrong Android-style steps)
//   - desktop/Android Firefox -> firefox
//   - Chrome/Edge/Chromium/Samsung/Opera -> chromium
//   - else -> other
export function detectBrowserFamily(ua: string): BrowserFamily {
  if (/iPad|iPhone|iPod/.test(ua)) {
    if (/FxiOS|CriOS|EdgiOS|OPiOS/.test(ua)) return 'other';
    return 'webkit';
  }
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\/|Edg\/|EdgA\/|SamsungBrowser\/|OPR\//.test(ua)) {
    return 'chromium';
  }
  // Desktop Safari (WebKit): has Safari/ and Version/ but no Chrome token.
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'webkit';
  return 'other';
}

// True when the page is running as an installed/standalone PWA. Checks the
// standard display-mode media query and the legacy iOS Safari navigator flag.
export function isStandalone(win: {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
}): boolean {
  if (win.matchMedia?.('(display-mode: standalone)').matches) return true;
  return win.navigator?.standalone === true;
}

// True on iPhone/iPad/iPod, including iPadOS 13+ which reports a Macintosh UA
// and can only be told apart from a real Mac by its touch capability. Used to
// gate the bookmark alternative: iOS WebKit evicts the service-worker cache and
// IndexedDB after ~7 days of no interaction, so a bookmark is not a reliable
// offline path on iOS.
export function isIOS(
  ua: string,
  win?: { navigator?: { maxTouchPoints?: number } },
): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  const touchPoints = win?.navigator?.maxTouchPoints ?? 0;
  return /Macintosh/.test(ua) && touchPoints > 1;
}
