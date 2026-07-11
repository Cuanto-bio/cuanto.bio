import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reads the `browser` flag from $app/environment; force it true so
// the localStorage-backed paths run under the node test environment.
vi.mock('$app/environment', () => ({ browser: true }));

describe('distance unit preference', () => {
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

  it('defaults to kilometers', async () => {
    const { readDistanceUnit } = await import('./distanceUnit');
    expect(readDistanceUnit()).toBe('km');
  });

  it('round-trips a stored unit', async () => {
    const { readDistanceUnit, writeDistanceUnit } = await import(
      './distanceUnit'
    );
    writeDistanceUnit('mi');
    expect(readDistanceUnit()).toBe('mi');
  });

  it('falls back to the default when the stored value is not a known unit', async () => {
    localStorage.setItem('cuanto:distance-unit', 'furlongs');
    const { readDistanceUnit } = await import('./distanceUnit');
    expect(readDistanceUnit()).toBe('km');
  });

  it('returns the default without throwing when localStorage denies access', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const { readDistanceUnit, writeDistanceUnit } = await import(
      './distanceUnit'
    );
    expect(() => writeDistanceUnit('ft')).not.toThrow();
    expect(readDistanceUnit()).toBe('km');
  });
});
