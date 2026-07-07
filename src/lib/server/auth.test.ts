import { describe, expect, test } from 'vitest';
import { isScopeSufficient } from './auth';

describe('isScopeSufficient', () => {
  const required =
    'atproto repo:bio.cuanto.survey repo:bio.cuanto.survey?action=delete';

  test('returns true for an exact match', () => {
    expect(isScopeSufficient(required, required)).toBe(true);
  });

  test('returns true when granted scope is a superset', () => {
    const granted = `${required} repo:bio.cuanto.protocolTarget blob:*/*`;
    expect(isScopeSufficient(granted, required)).toBe(true);
  });

  test('returns false when missing a required repo:<nsid> token', () => {
    const granted = 'atproto repo:bio.cuanto.survey?action=delete';
    expect(isScopeSufficient(granted, required)).toBe(false);
  });

  test('returns false when missing an action qualifier on an otherwise present nsid', () => {
    const granted = 'atproto repo:bio.cuanto.survey';
    expect(isScopeSufficient(granted, required)).toBe(false);
  });

  test('returns false for a pre-#18 transition:generic grant', () => {
    expect(isScopeSufficient('atproto transition:generic', required)).toBe(
      false,
    );
  });

  test('returns false for undefined granted scope', () => {
    expect(isScopeSufficient(undefined, required)).toBe(false);
  });

  test('returns false for empty granted scope', () => {
    expect(isScopeSufficient('', required)).toBe(false);
  });
});
