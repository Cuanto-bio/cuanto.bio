import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ default: vi.fn() }));

import sql from '$lib/server/db';
import {
  hashToken,
  isBearerHeader,
  issueToken,
  resolveBearerDid,
  revokeToken,
  TOKEN_TTL_MS,
} from './app-tokens';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const DID = 'did:test:app-tokens';

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: clear only wipes call history, leaving
  // any mockResolvedValue from a previous test in place. That made the
  // last_used_at tests below pass for the wrong reason — the un-awaited
  // bookkeeping write only had something to .catch() because an earlier test
  // had set a persistent default. Reset, then state the default explicitly.
  vi.resetAllMocks();
  mockSql.mockResolvedValue([]);
});

describe('hashToken', () => {
  test('is stable for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  test('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  // The whole point of storing a hash is that the DB never sees the secret.
  test('never returns the plaintext', () => {
    const token = 'a-secret-token-value';
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// hooks.server relies on this to tell "no Bearer header" (fall back to the
// cookie) apart from "a Bearer header that did not resolve" (must not).
describe('isBearerHeader', () => {
  test.each([
    ['Bearer tok', true],
    ['bearer tok', true],
    ['BEARER tok', true],
    ['  Bearer tok  ', true],
    ['Bearer\ttok', true],
    ['Basic abc', false],
    ['Bearer', false],
    ['BearerToken', false],
    ['', false],
    [undefined, false],
  ])('%s -> %s', (header, expected) => {
    expect(isBearerHeader(header)).toBe(expected);
  });
});

describe('issueToken', () => {
  test('returns a high-entropy token and stores only its hash', async () => {
    mockSql.mockResolvedValueOnce([]);

    const { token } = await issueToken(DID, 'ios-app');

    // 32 bytes base64url — long enough that guessing is not a threat model.
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

    const params = mockSql.mock.calls[0].slice(1);
    expect(params).toContain(hashToken(token));
    expect(params).not.toContain(token);
  });

  test('issues a different token every call', async () => {
    mockSql.mockResolvedValue([]);
    const a = await issueToken(DID);
    const b = await issueToken(DID);
    expect(a.token).not.toBe(b.token);
  });

  test('sets an expiry TOKEN_TTL_MS in the future', async () => {
    mockSql.mockResolvedValueOnce([]);
    const before = Date.now();
    const { expiresAt } = await issueToken(DID);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + TOKEN_TTL_MS);
  });
});

// These are the security-critical assertions: a token that should not
// authenticate must resolve to undefined, never to a DID.
describe('resolveBearerDid', () => {
  test('resolves the DID for a live token', async () => {
    mockSql.mockResolvedValueOnce([{ did: DID }]);
    await expect(resolveBearerDid('Bearer sometoken')).resolves.toBe(DID);
  });

  test('looks the token up by hash, never by plaintext', async () => {
    mockSql.mockResolvedValueOnce([{ did: DID }]);
    await resolveBearerDid('Bearer sometoken');
    const params = mockSql.mock.calls[0].slice(1);
    expect(params).toContain(hashToken('sometoken'));
    expect(params).not.toContain('sometoken');
  });

  test('returns undefined when the query matches nothing', async () => {
    // Expired, revoked and unknown tokens all fall out of the WHERE clause, so
    // they are indistinguishable here by design.
    mockSql.mockResolvedValueOnce([]);
    await expect(resolveBearerDid('Bearer nope')).resolves.toBeUndefined();
  });

  test.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    ['a bare token with no scheme', 'sometoken'],
    ['the wrong scheme', 'Basic sometoken'],
    ['Bearer with no value', 'Bearer'],
    ['Bearer with only whitespace', 'Bearer    '],
  ])('returns undefined for %s without querying', async (_label, header) => {
    await expect(resolveBearerDid(header)).resolves.toBeUndefined();
    expect(mockSql).not.toHaveBeenCalled();
  });

  test('accepts the scheme case-insensitively, per RFC 7235', async () => {
    mockSql.mockResolvedValueOnce([{ did: DID }]);
    await expect(resolveBearerDid('bearer sometoken')).resolves.toBe(DID);
  });
});

// Authentication is a SELECT; the last_used_at bump is throttled and fired
// without awaiting, so a dozen parallel requests on one token do not queue on a
// single row's lock. These pin that it stays a bookkeeping detail and can never
// affect whether a request authenticates.
describe('resolveBearerDid — last_used_at bookkeeping', () => {
  test('bumps when the token has never been used', async () => {
    mockSql.mockResolvedValueOnce([{ did: DID, last_used_at: null }]);
    await expect(resolveBearerDid('Bearer tok')).resolves.toBe(DID);
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('bumps when last_used_at is stale', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    mockSql.mockResolvedValueOnce([{ did: DID, last_used_at: old }]);
    await expect(resolveBearerDid('Bearer tok')).resolves.toBe(DID);
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('does NOT write when last_used_at is fresh', async () => {
    mockSql.mockResolvedValueOnce([{ did: DID, last_used_at: new Date() }]);
    await expect(resolveBearerDid('Bearer tok')).resolves.toBe(DID);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  test('still authenticates when the bookkeeping write fails', async () => {
    mockSql
      .mockResolvedValueOnce([{ did: DID, last_used_at: null }])
      .mockRejectedValueOnce(new Error('db went away'));
    await expect(resolveBearerDid('Bearer tok')).resolves.toBe(DID);
  });
});

describe('revokeToken', () => {
  test('revokes by hash rather than plaintext', async () => {
    mockSql.mockResolvedValueOnce([]);
    await revokeToken('sometoken');
    const params = mockSql.mock.calls[0].slice(1);
    expect(params).toContain(hashToken('sometoken'));
    expect(params).not.toContain('sometoken');
  });
});
