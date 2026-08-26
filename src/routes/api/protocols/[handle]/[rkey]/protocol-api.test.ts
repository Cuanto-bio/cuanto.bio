import { describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db/survey-protocols', () => ({
  getProtocolDetailByHandleAndRkey: vi.fn().mockResolvedValue({
    atUri: 'at://did:plc:dana/bio.cuanto.surveyProtocol/x',
    rkey: 'x',
    targets: [],
  }),
}));

vi.mock('$lib/server/db/protocol-follows', () => ({
  getFollowerCount: vi.fn().mockResolvedValue(0),
  getProtocolFollowerPreview: vi.fn().mockResolvedValue([]),
  getFollowByDidAndProtocol: vi.fn().mockResolvedValue(null),
}));

vi.mock('$lib/server/db/protocol-activity', () => ({
  getProtocolActivity: vi.fn().mockResolvedValue({}),
}));

import { GET } from './+server';

describe('GET /api/protocols/[handle]/[rkey]', () => {
  test('does not return a top-level `handle` key', async () => {
    // /app/protocols/[handle]/[rkey]/+page.ts spreads this response straight
    // into its own load data, and SvelteKit merges page data over the /app
    // layout's data by key — which carries `handle` for the *signed-in
    // visitor*. A top-level `handle` here (the protocol owner's) would
    // silently overwrite it, swapping a signed-in visitor's sidebar identity
    // to the protocol owner's while browsing someone else's protocol.
    // https://tangled.org/cuanto.bio/cuanto.bio/issues/62
    const res = await GET({
      params: { handle: 'dana', rkey: 'x' },
      locals: {},
    } as unknown as Parameters<typeof GET>[0]);

    const body = await res.json();
    expect(body).not.toHaveProperty('handle');
  });
});
