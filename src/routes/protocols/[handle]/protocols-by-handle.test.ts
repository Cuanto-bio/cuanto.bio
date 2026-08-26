import { describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({
  default: vi.fn().mockResolvedValue([{ did: 'did:plc:dana' }]),
}));

vi.mock('$lib/server/db/survey-protocols', () => ({
  getProtocolsPageByDid: vi.fn().mockResolvedValue([]),
}));

import { load } from './+page.server';

describe('GET /protocols/[handle] — signed-out visitor', () => {
  test('does not return a top-level `handle` key', async () => {
    // Same bug class fixed for /profile/[handle] in 6929a35: the root
    // layout's `handle` key carries the *signed-in visitor's* identity, and
    // SvelteKit merges page data over layout data by key. A page-level
    // `handle` here silently overwrote it, showing a signed-out visitor as
    // if signed in as this page's protocol owner.
    const result = await load({
      params: { handle: 'dana' },
    } as unknown as Parameters<typeof load>[0]);

    expect(result).not.toHaveProperty('handle');
    expect(result).toMatchObject({ ownerHandle: 'dana' });
  });
});
