import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

describe('Navigation', () => {
  let nav: {
    previousUrl: string | null;
    navigate: (from: string, to: string) => void;
  };

  beforeEach(async () => {
    vi.resetModules();
    ({ nav } = await import('./navigation.svelte.js'));
  });

  test('returns null before any navigation', () => {
    expect(nav.previousUrl).toBeNull();
  });

  test('pushes from-url on forward navigation', () => {
    nav.navigate('http://localhost/a', 'http://localhost/b');
    expect(nav.previousUrl).toBe('http://localhost/a');
  });

  test('pops when navigating back to the previous url', () => {
    nav.navigate('http://localhost/a', 'http://localhost/b');
    nav.navigate('http://localhost/b', 'http://localhost/a');
    expect(nav.previousUrl).toBeNull();
  });

  test('accumulates history across multiple hops', () => {
    nav.navigate('http://localhost/a', 'http://localhost/b');
    nav.navigate('http://localhost/b', 'http://localhost/c');
    expect(nav.previousUrl).toBe('http://localhost/b');
  });

  test('unwinds each level when going back through multiple hops', () => {
    nav.navigate('http://localhost/a', 'http://localhost/b');
    nav.navigate('http://localhost/b', 'http://localhost/c');
    nav.navigate('http://localhost/c', 'http://localhost/b');
    expect(nav.previousUrl).toBe('http://localhost/a');
    nav.navigate('http://localhost/b', 'http://localhost/a');
    expect(nav.previousUrl).toBeNull();
  });
});
