import { isValidTid } from '@atproto/syntax';
import { describe, expect, test } from 'vitest';
import { deterministicTid, generateTid } from './tid';

describe('generateTid', () => {
  test('produces syntactically valid TIDs', () => {
    for (let i = 0; i < 1000; i++) {
      expect(isValidTid(generateTid())).toBe(true);
    }
  });

  test('is strictly increasing / unique across rapid calls', () => {
    const tids = Array.from({ length: 1000 }, () => generateTid());
    expect(new Set(tids).size).toBe(tids.length);
    const sorted = [...tids].sort();
    expect(sorted).toEqual(tids);
  });
});

describe('deterministicTid', () => {
  test('produces syntactically valid TIDs', () => {
    for (const seed of ['a', 'at://did:plc:x/c/1', 'survey/target', '🦋']) {
      expect(isValidTid(deterministicTid(seed))).toBe(true);
    }
  });

  test('is stable for the same seed', () => {
    expect(deterministicTid('at://did:plc:x/c/1')).toBe(
      deterministicTid('at://did:plc:x/c/1'),
    );
  });

  test('differs for different seeds', () => {
    expect(deterministicTid('rkeyA/target1')).not.toBe(
      deterministicTid('rkeyA/target2'),
    );
  });
});
