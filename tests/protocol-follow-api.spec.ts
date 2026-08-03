import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

// Follow/unfollow moved off SvelteKit form actions and onto this endpoint so
// /app can be built statically (adapter-static rejects +page.server.ts, and
// form actions need an origin server to POST to). See
// docs/2026-07-20-capacitor-phase-1-static-spa.md.
//
// The UI-level behaviour these back is covered end-to-end in
// tests/protocol-follows.spec.ts; this spec pins the HTTP contract, including
// the status codes the old form actions returned.

const DID = 'did:test:follow-api-spec';
const HANDLE = 'user-follow-api-spec';

function authCookie(did: string) {
  return {
    name: 'did',
    value: did,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

test.describe('/api/protocols/[handle]/[rkey]/follow', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('returns 401 when not authenticated', async ({ context, sql }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    const res = await context.request.post(
      `/api/protocols/${HANDLE}/${protocolRkey}/follow`,
    );
    expect(res.status()).toBe(401);
  });

  test('returns 404 for an unknown protocol', async ({ context, sql }) => {
    await seedProtocol(sql, DID);
    await context.addCookies([authCookie(DID)]);
    const res = await context.request.post(
      `/api/protocols/${HANDLE}/does-not-exist/follow`,
    );
    expect(res.status()).toBe(404);
  });

  test('returns 404 for an unknown handle', async ({ context, sql }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    await context.addCookies([authCookie(DID)]);
    const res = await context.request.post(
      `/api/protocols/nobody-here/${protocolRkey}/follow`,
    );
    expect(res.status()).toBe(404);
  });

  test('POST follows the protocol', async ({ context, sql }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    await context.addCookies([authCookie(DID)]);

    const res = await context.request.post(
      `/api/protocols/${HANDLE}/${protocolRkey}/follow`,
    );
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ isFollowing: true });

    const rows = await sql`
      SELECT did FROM protocol_follows WHERE did = ${DID}
    `;
    expect(rows.length).toBe(1);
  });

  // The form action returned { isFollowing: true } without writing a second
  // record when one already existed; keep that so a double-tap is harmless.
  test('POST is idempotent when already following', async ({
    context,
    sql,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    await context.addCookies([authCookie(DID)]);
    const url = `/api/protocols/${HANDLE}/${protocolRkey}/follow`;

    await context.request.post(url);
    const res = await context.request.post(url);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ isFollowing: true });

    const rows = await sql`
      SELECT did FROM protocol_follows WHERE did = ${DID}
    `;
    expect(rows.length).toBe(1);
  });

  test('DELETE unfollows the protocol', async ({ context, sql }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    await context.addCookies([authCookie(DID)]);
    const url = `/api/protocols/${HANDLE}/${protocolRkey}/follow`;

    await context.request.post(url);
    const res = await context.request.delete(url);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ isFollowing: false });

    const rows = await sql`
      SELECT did FROM protocol_follows WHERE did = ${DID}
    `;
    expect(rows.length).toBe(0);
  });

  test('DELETE is a no-op when not following', async ({ context, sql }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    await context.addCookies([authCookie(DID)]);

    const res = await context.request.delete(
      `/api/protocols/${HANDLE}/${protocolRkey}/follow`,
    );
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ isFollowing: false });
  });
});
