import { beforeEach, describe, expect, test, vi } from 'vitest';

const getCachedProtocols = vi.fn();
const getCachedFollowedProtocolByRkey = vi.fn();
const cacheProtocol = vi.fn();
vi.mock('$lib/offline/db', () => ({
  getCachedProtocols: (...args: unknown[]) => getCachedProtocols(...args),
  getCachedFollowedProtocolByRkey: (...args: unknown[]) =>
    getCachedFollowedProtocolByRkey(...args),
  cacheProtocol: (...args: unknown[]) => cacheProtocol(...args),
}));

import { load } from './+page';

const PROTOCOL = { handle: 'dana', rkey: 'x', title: 'A protocol' };

beforeEach(() => {
  getCachedProtocols.mockReset().mockResolvedValue([PROTOCOL]);
  getCachedFollowedProtocolByRkey.mockReset().mockResolvedValue(null);
  cacheProtocol.mockReset().mockResolvedValue(undefined);
});

describe('GET /app/protocols/[handle]/[rkey] — viewing another visitor', () => {
  test('does not return a top-level `handle` key from the cached-protocol path', async () => {
    // The /app layout's own `handle` key carries the *signed-in visitor's*
    // identity, and SvelteKit merges page data over layout data by key. A
    // page-level `handle` here for the protocol's owner would silently
    // overwrite it — swapping a signed-in visitor's sidebar identity to the
    // protocol owner's while they're still genuinely signed in as themselves.
    // https://tangled.org/cuanto.bio/cuanto.bio/issues/62
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ protocol: PROTOCOL }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await load({
      fetch: fetchFn,
      params: { handle: 'dana', rkey: 'x' },
      parent: async () => ({ handle: 'alice' }),
      url: new URL('https://cuanto.bio/app/protocols/dana/x'),
    } as unknown as Parameters<typeof load>[0]);

    expect(result).not.toHaveProperty('handle');
  });
});
