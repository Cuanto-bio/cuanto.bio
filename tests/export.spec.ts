import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

const EXPORT_DID = 'did:test:export-spec';
const EXPORT_HANDLE = 'user-export-spec';

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

test.describe('DwC-DP export endpoint', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, EXPORT_DID);
  });

  test('returns 401 for unauthenticated requests', async ({ request, sql }) => {
    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const response = await request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(401);
  });

  test('returns 404 for unknown protocol', async ({ context }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);
    const response = await context.request.get(
      '/api/protocols/nonexistent-handle/nonexistent-rkey/export',
    );
    expect(response.status()).toBe(404);
  });

  test('returns gzip archive with correct headers', async ({
    context,
    sql,
  }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const response = await context.request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/gzip');
    expect(response.headers()['content-disposition']).toContain('attachment');
    expect(response.headers()['content-disposition']).toContain(
      `${EXPORT_HANDLE}-${protocolRkey}-dwcdp.tar.gz`,
    );
  });
});
