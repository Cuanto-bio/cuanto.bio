import { describe, expect, test } from 'vitest';
import { isLikelyIdentifier, sanitizeHandleInput } from './handle';

describe('sanitizeHandleInput', () => {
  test('leaves a well-formed handle unchanged', () => {
    expect(sanitizeHandleInput('kueda.bsky.social')).toBe('kueda.bsky.social');
  });

  test('trims surrounding whitespace and lowercases', () => {
    expect(sanitizeHandleInput('  Kueda.Bsky.Social  ')).toBe(
      'kueda.bsky.social',
    );
  });

  test('strips a leading @ pasted from a profile', () => {
    expect(sanitizeHandleInput('@kueda.bsky.social')).toBe('kueda.bsky.social');
  });

  test('strips trailing @ symbols', () => {
    expect(sanitizeHandleInput('kueda.bsky.social@')).toBe('kueda.bsky.social');
  });

  test('converts a fediverse-style @user@server into a handle', () => {
    expect(sanitizeHandleInput('@kueda@bsky.social')).toBe('kueda.bsky.social');
    expect(sanitizeHandleInput('kueda@bsky.social')).toBe('kueda.bsky.social');
  });

  test('collapses repeated @ symbols into a single dot', () => {
    expect(sanitizeHandleInput('@@kueda@@bsky.social')).toBe(
      'kueda.bsky.social',
    );
  });

  test('leaves a DID untouched (no lowercasing or @ rewriting)', () => {
    expect(sanitizeHandleInput('did:web:Example.com')).toBe(
      'did:web:Example.com',
    );
    expect(sanitizeHandleInput('  did:plc:abc123  ')).toBe('did:plc:abc123');
  });

  test('leaves a PDS/entryway URL untouched apart from trimming', () => {
    expect(sanitizeHandleInput('  https://bsky.social  ')).toBe(
      'https://bsky.social',
    );
  });
});

describe('isLikelyIdentifier', () => {
  test('accepts a valid handle', () => {
    expect(isLikelyIdentifier('kueda.bsky.social')).toBe(true);
  });

  test('accepts a DID', () => {
    expect(isLikelyIdentifier('did:plc:abc123')).toBe(true);
  });

  test('accepts a PDS/entryway URL', () => {
    expect(isLikelyIdentifier('https://bsky.social')).toBe(true);
  });

  test('rejects input that is not a valid handle', () => {
    expect(isLikelyIdentifier('kueda@bsky.social')).toBe(false);
    expect(isLikelyIdentifier('not a handle')).toBe(false);
    expect(isLikelyIdentifier('')).toBe(false);
  });
});
