import { createHash, randomBytes } from 'node:crypto';
import { expect, teardownDid, test } from './fixtures.js';

// Exercises the bearer-token path against a real database: token issue, the
// PKCE-bound code exchange, authenticating a real /api route, and revocation.
// The unit tests in src/lib/server/*.test.ts mock sql, so this is what proves
// the SQL actually does what those tests assume.

const DID = 'did:test:bearer-auth-spec';
const HANDLE = 'user-bearer-auth-spec';

function sha256hex(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

function challengeFor(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Mints a code the way /oauth/callback does, without running OAuth. */
async function seedCode(
  sql: Parameters<typeof teardownDid>[0],
  did: string,
  challenge: string,
  expiresAt = new Date(Date.now() + 60_000),
): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await sql`
    INSERT INTO app_token_codes (code_hash, did, challenge, expires_at)
    VALUES (${sha256hex(code)}, ${did}, ${challenge}, ${expiresAt})
  `;
  return code;
}

test.describe('bearer token auth', () => {
  test.beforeEach(async ({ sql }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
  });

  test.afterEach(async ({ sql }) => {
    await sql`DELETE FROM app_token_codes WHERE did = ${DID}`;
    await sql`DELETE FROM app_tokens WHERE did = ${DID}`;
    await teardownDid(sql, DID);
  });

  test('exchanges a valid code for a token that authenticates /api/me', async ({
    request,
    sql,
  }) => {
    const verifier = randomBytes(32).toString('base64url');
    const code = await seedCode(sql, DID, challengeFor(verifier));

    const exchange = await request.post('/api/auth/token', {
      data: { code, verifier, label: 'ios-app' },
    });
    expect(exchange.status()).toBe(200);
    const { token } = await exchange.json();
    expect(typeof token).toBe('string');

    // Only the hash is persisted.
    const [row] = await sql`
      SELECT token_hash, label FROM app_tokens WHERE did = ${DID}
    `;
    expect(row.token_hash).toBe(sha256hex(token));
    expect(row.token_hash).not.toBe(token);
    expect(row.label).toBe('ios-app');

    const me = await request.get('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status()).toBe(200);
    expect((await me.json()).did).toBe(DID);
  });

  test('rejects the wrong verifier and burns the code', async ({
    request,
    sql,
  }) => {
    const verifier = randomBytes(32).toString('base64url');
    const code = await seedCode(sql, DID, challengeFor(verifier));

    const bad = await request.post('/api/auth/token', {
      data: { code, verifier: randomBytes(32).toString('base64url') },
    });
    expect(bad.status()).toBe(401);

    // The code is spent even though the attempt failed, so guessing the
    // verifier is a single-shot gamble rather than something to grind at.
    const retry = await request.post('/api/auth/token', {
      data: { code, verifier },
    });
    expect(retry.status()).toBe(401);
    expect(await sql`SELECT 1 FROM app_tokens WHERE did = ${DID}`).toHaveLength(
      0,
    );
  });

  test('rejects a replayed code', async ({ request, sql }) => {
    const verifier = randomBytes(32).toString('base64url');
    const code = await seedCode(sql, DID, challengeFor(verifier));

    expect(
      (
        await request.post('/api/auth/token', { data: { code, verifier } })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post('/api/auth/token', { data: { code, verifier } })
      ).status(),
    ).toBe(401);
  });

  test('rejects an expired code', async ({ request, sql }) => {
    const verifier = randomBytes(32).toString('base64url');
    const code = await seedCode(
      sql,
      DID,
      challengeFor(verifier),
      new Date(Date.now() - 1000),
    );

    const res = await request.post('/api/auth/token', {
      data: { code, verifier },
    });
    expect(res.status()).toBe(401);
  });

  test('rejects an unknown code', async ({ request }) => {
    const res = await request.post('/api/auth/token', {
      data: {
        code: randomBytes(32).toString('base64url'),
        verifier: randomBytes(32).toString('base64url'),
      },
    });
    expect(res.status()).toBe(401);
  });

  test('422s when code or verifier is missing', async ({ request }) => {
    expect(
      (await request.post('/api/auth/token', { data: { code: 'x' } })).status(),
    ).toBe(422);
    expect((await request.post('/api/auth/token', { data: {} })).status()).toBe(
      422,
    );
  });

  test('a revoked token stops authenticating', async ({ request, sql }) => {
    const verifier = randomBytes(32).toString('base64url');
    const code = await seedCode(sql, DID, challengeFor(verifier));
    const { token } = await (
      await request.post('/api/auth/token', { data: { code, verifier } })
    ).json();
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request.get('/api/me', { headers: auth })).status()).toBe(
      200,
    );

    const out = await request.post('/api/auth/signout', { headers: auth });
    expect(out.status()).toBe(200);
    expect(await out.json()).toMatchObject({ signedOut: true, scope: 'token' });

    expect((await request.get('/api/me', { headers: auth })).status()).toBe(
      401,
    );
  });

  test('an expired token does not authenticate', async ({ request, sql }) => {
    const verifier = randomBytes(32).toString('base64url');
    const code = await seedCode(sql, DID, challengeFor(verifier));
    const { token } = await (
      await request.post('/api/auth/token', { data: { code, verifier } })
    ).json();

    await sql`
      UPDATE app_tokens SET expires_at = now() - interval '1 second'
      WHERE did = ${DID}
    `;

    const me = await request.get('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status()).toBe(401);
  });

  test('a garbage bearer token does not authenticate', async ({ request }) => {
    const me = await request.get('/api/me', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(me.status()).toBe(401);
  });
});
