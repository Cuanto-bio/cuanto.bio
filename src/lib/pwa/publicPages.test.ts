import { describe, expect, test } from 'vitest';

import { isPublicProtocolPath } from './publicPages';

describe('isPublicProtocolPath', () => {
  test('accepts the read-only protocol pages', () => {
    expect(isPublicProtocolPath('/protocols')).toBe(true);
    expect(isPublicProtocolPath('/protocols/')).toBe(true);
    expect(isPublicProtocolPath('/protocols/dana')).toBe(true);
    expect(isPublicProtocolPath('/protocols/dana/abc')).toBe(true);
  });

  test('accepts their data requests', () => {
    expect(isPublicProtocolPath('/protocols/__data.json')).toBe(true);
    expect(isPublicProtocolPath('/protocols/dana/__data.json')).toBe(true);
    expect(isPublicProtocolPath('/protocols/dana/abc/__data.json')).toBe(true);
  });

  test('rejects the authenticated forms and their data requests', () => {
    // Caching these serves a signed-out visitor's answer back to a signed-in
    // one: the load redirects to sign-in when there is no session, and
    // stale-while-revalidate would replay that redirect to a user who is
    // signed in, bouncing them to sign in again on a page they can edit.
    expect(isPublicProtocolPath('/protocols/new')).toBe(false);
    expect(isPublicProtocolPath('/protocols/new/__data.json')).toBe(false);
    expect(isPublicProtocolPath('/protocols/dana/abc/edit')).toBe(false);
    expect(isPublicProtocolPath('/protocols/dana/abc/edit/__data.json')).toBe(
      false,
    );
  });

  test('rejects paths outside /protocols, including sibling prefixes', () => {
    expect(isPublicProtocolPath('/')).toBe(false);
    expect(isPublicProtocolPath('/surveys/dana/abc')).toBe(false);
    expect(isPublicProtocolPath('/protocolsomething')).toBe(false);
  });
});
