import { describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ default: vi.fn() }));

import { challengeFor, isValidChallenge, verifierMatches } from './native-auth';

describe('challengeFor', () => {
  test('is the base64url sha256 of the verifier', () => {
    // Matches RFC 7636 S256: BASE64URL(SHA256(ASCII(verifier))).
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('is stable and collision-free for near-identical input', () => {
    expect(challengeFor('abc')).toBe(challengeFor('abc'));
    expect(challengeFor('abc')).not.toBe(challengeFor('abd'));
  });

  test('produces base64url with no padding', () => {
    expect(challengeFor('anything')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('isValidChallenge', () => {
  test.each([
    [
      'a real S256 challenge',
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      true,
    ],
    ['too short', 'abc', false],
    ['empty', '', false],
    ['base64 padding', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-c=', false],
    [
      'standard base64 chars',
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM',
      false,
    ],
    ['a path traversal attempt', '../../etc/passwd', false],
    [undefined, undefined, false],
  ])('%s -> %s', (_label, input, expected) => {
    expect(isValidChallenge(input)).toBe(expected);
  });
});

// The security property the whole handoff rests on: possession of the code is
// not enough, you must also hold the verifier that produced the challenge.
describe('verifierMatches', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = challengeFor(verifier);

  test('accepts the verifier that produced the challenge', () => {
    expect(verifierMatches(verifier, challenge)).toBe(true);
  });

  test('rejects a different verifier', () => {
    expect(verifierMatches('some-other-verifier', challenge)).toBe(false);
  });

  test('rejects an empty verifier', () => {
    expect(verifierMatches('', challenge)).toBe(false);
  });

  test('rejects when the challenge is the raw verifier', () => {
    // Guards against a server that forgot to hash: presenting the challenge
    // itself must never authenticate.
    expect(verifierMatches(challenge, challenge)).toBe(false);
  });
});
