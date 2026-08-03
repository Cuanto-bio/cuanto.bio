import { describe, expect, test } from 'vitest';
import { nativeServerOrigin } from './serverUrl';

describe('nativeServerOrigin', () => {
  test('returns the origin for a public HTTPS URL', () => {
    expect(nativeServerOrigin('https://cuanto.bio')).toBe('https://cuanto.bio');
  });

  test('strips any path, keeping just the origin', () => {
    expect(nativeServerOrigin('https://carex.tail136ef8.ts.net/app')).toBe(
      'https://carex.tail136ef8.ts.net',
    );
  });

  test('throws when PUBLIC_URL is unset', () => {
    expect(() => nativeServerOrigin(undefined)).toThrow(/not set/i);
    expect(() => nativeServerOrigin('')).toThrow(/not set/i);
  });

  test('throws when PUBLIC_URL is not a valid URL', () => {
    expect(() => nativeServerOrigin('not-a-url')).toThrow(/not a valid url/i);
  });

  test('throws for the loopback dev default (http://127.0.0.1)', () => {
    expect(() => nativeServerOrigin('http://127.0.0.1:5173')).toThrow(
      /will not work/i,
    );
  });

  test('throws for plain http, even on a public host', () => {
    expect(() => nativeServerOrigin('http://cuanto.bio')).toThrow(
      /will not work/i,
    );
  });

  test('throws for https localhost', () => {
    expect(() => nativeServerOrigin('https://localhost')).toThrow(
      /will not work/i,
    );
  });

  test('throws for an IP-literal host (v4 loopback, LAN, v6)', () => {
    expect(() => nativeServerOrigin('https://127.0.0.1')).toThrow(
      /will not work/i,
    );
    expect(() => nativeServerOrigin('https://192.168.1.5')).toThrow(
      /will not work/i,
    );
    expect(() => nativeServerOrigin('https://[::1]')).toThrow(/will not work/i);
  });
});
