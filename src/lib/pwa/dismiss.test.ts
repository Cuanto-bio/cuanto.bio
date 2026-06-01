import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reads the `browser` flag from $app/environment; force it true so
// the localStorage-backed paths run under the node test environment.
vi.mock('$app/environment', () => ({ browser: true }));

describe('install prompt dismissal', () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports not dismissed by default', async () => {
    const { isInstallPromptDismissed } = await import('./dismiss');
    expect(isInstallPromptDismissed()).toBe(false);
  });

  it('round-trips the dismissed flag', async () => {
    const { isInstallPromptDismissed, markInstallPromptDismissed } =
      await import('./dismiss');
    markInstallPromptDismissed();
    expect(isInstallPromptDismissed()).toBe(true);
  });

  it('returns false without throwing when localStorage reads throw', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const { isInstallPromptDismissed, markInstallPromptDismissed } =
      await import('./dismiss');
    expect(() => markInstallPromptDismissed()).not.toThrow();
    expect(isInstallPromptDismissed()).toBe(false);
  });
});
