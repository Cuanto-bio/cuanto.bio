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
}));

vi.mock('$lib/server/db/protocol-activity', () => ({
  getProtocolActivity: vi.fn().mockResolvedValue({}),
}));

import { load } from './+page.server';

describe('GET /protocols/[handle]/[rkey] — signed-out visitor', () => {
  test('does not return a top-level `handle` key', async () => {
    // The root layout's `handle` key carries the *signed-in visitor's*
    // identity, and SvelteKit merges page data over layout data by key. A
    // page-level `handle` here would silently overwrite it — same bug class
    // fixed for /profile/[handle] in 6929a35 — making a signed-out visitor
    // show up in the sidebar as if signed in as this protocol's owner.
    const result = await load({
      params: { handle: 'dana', rkey: 'x' },
      locals: {},
      url: new URL('http://localhost/protocols/dana/x'),
    } as unknown as Parameters<typeof load>[0]);

    expect(result).not.toHaveProperty('handle');
  });
});
