import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearToken, getToken, setToken } from './token';

// The native bearer token lives in localStorage. The vitest environment is node
// (see vite.config.ts), where localStorage is absent by default — which is also
// the SSR/server condition token.ts guards against, so the "no storage" tests
// need no setup and the storage tests install a fake.

function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

describe('native bearer token storage', () => {
  describe('in the native webview (localStorage present)', () => {
    beforeEach(() => {
      vi.stubGlobal('localStorage', fakeLocalStorage());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('round-trips a token', () => {
      expect(getToken()).toBeNull();
      setToken('bearer-abc');
      expect(getToken()).toBe('bearer-abc');
    });

    test('overwrites an existing token', () => {
      setToken('first');
      setToken('second');
      expect(getToken()).toBe('second');
    });

    test('setToken(null) removes the token', () => {
      setToken('bearer-abc');
      setToken(null);
      expect(getToken()).toBeNull();
    });

    test('clearToken removes the token', () => {
      setToken('bearer-abc');
      clearToken();
      expect(getToken()).toBeNull();
    });

    test('clearToken on an empty store is a no-op', () => {
      expect(() => clearToken()).not.toThrow();
      expect(getToken()).toBeNull();
    });
  });

  describe('during SSR / on the server (no localStorage)', () => {
    // No stub: node has no localStorage, matching the server render where the
    // token cannot and must not exist. The module must degrade silently rather
    // than throw and take down the render.
    test('getToken returns null instead of throwing', () => {
      expect(getToken()).toBeNull();
    });

    test('setToken is a silent no-op', () => {
      expect(() => setToken('bearer-abc')).not.toThrow();
      expect(getToken()).toBeNull();
    });

    test('clearToken is a silent no-op', () => {
      expect(() => clearToken()).not.toThrow();
    });
  });
});
