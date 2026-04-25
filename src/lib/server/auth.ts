import {
  buildAtprotoLoopbackClientMetadata,
  JoseKey,
  Keyset,
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedState,
  type OAuthClientMetadataInput,
} from '@atproto/oauth-client-node';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import sql from '$lib/server/db';

class PgStateStore {
  async get(key: string): Promise<NodeSavedState | undefined> {
    const rows = await sql<{ value: NodeSavedState }[]>`
      SELECT value FROM oauth_state
      WHERE key = ${key} AND expires_at > now()
    `;
    return rows[0]?.value;
  }

  async set(key: string, value: NodeSavedState): Promise<void> {
    // ATProto state expires after ~10 minutes; we keep it for 1 hour to be safe
    await sql`
      INSERT INTO oauth_state (key, value, expires_at)
      VALUES (${key}, ${sql.json(value as unknown as Parameters<typeof sql.json>[0])}, now() + interval '1 hour')
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
    `;
  }

  async del(key: string): Promise<void> {
    await sql`DELETE FROM oauth_state WHERE key = ${key}`;
  }
}

class PgSessionStore {
  async get(key: string): Promise<NodeSavedSession | undefined> {
    const rows = await sql<{ value: NodeSavedSession }[]>`
      SELECT value FROM oauth_sessions WHERE key = ${key}
    `;
    return rows[0]?.value;
  }

  async set(key: string, value: NodeSavedSession): Promise<void> {
    await sql`
      INSERT INTO oauth_sessions (key, value, updated_at)
      VALUES (${key}, ${sql.json(value as unknown as Parameters<typeof sql.json>[0])}, now())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()
    `;
  }

  async del(key: string): Promise<void> {
    await sql`DELETE FROM oauth_sessions WHERE key = ${key}`;
  }
}

const SCOPE = 'atproto transition:generic';

// Loopback client is only for local development. In prod we need a
// publicly-accessible URL
const isLoopback =
  publicEnv.PUBLIC_OAUTH_CLIENT_ID?.startsWith('http://localhost') ?? false;

function buildClientMetadata() {
  if (isLoopback) {
    // Loopback client for local dev. PDS won't fetch metadata; scope and redirect_uri
    // are encoded in the client_id URL. token_endpoint_auth_method is 'none'.
    return buildAtprotoLoopbackClientMetadata({
      scope: SCOPE,
      redirect_uris: [`${publicEnv.PUBLIC_URL}/oauth/callback`],
    });
  }
  if (!publicEnv.PUBLIC_OAUTH_CLIENT_ID) {
    throw new Error(
      'PUBLIC_OAUTH_CLIENT_ID env var is required for production OAuth',
    );
  }
  // Discoverable client for production: PDS fetches metadata from the client_id URL.
  return {
    client_id: publicEnv.PUBLIC_OAUTH_CLIENT_ID,
    client_name: 'Cuanto.bio',
    client_uri: publicEnv.PUBLIC_URL,
    redirect_uris: [`${publicEnv.PUBLIC_URL}/oauth/callback`],
    scope: SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    application_type: 'web',
  } as OAuthClientMetadataInput;
}

// Keyset is only used for the production discoverable client (private_key_jwt).
// Loopback clients use token_endpoint_auth_method='none' and need no keyset.
async function buildKeyset(): Promise<Keyset | undefined> {
  if (isLoopback) return undefined;
  if (!privateEnv.PRIVATE_OAUTH_KEY)
    throw new Error(
      'PRIVATE_OAUTH_KEY env var is required for production OAuth',
    );
  return new Keyset([
    await JoseKey.fromJWK(JSON.parse(privateEnv.PRIVATE_OAUTH_KEY)),
  ]);
}

// Stored as a promise so concurrent calls on cold start share a single
// construction — if stored as the resolved value, two callers could both see
// undefined and race to build two NodeOAuthClient instances.
let _clientPromise: Promise<NodeOAuthClient> | undefined;

async function getClient(): Promise<NodeOAuthClient> {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const keyset = await buildKeyset();
      return new NodeOAuthClient({
        clientMetadata: buildClientMetadata(),
        keyset,
        stateStore: new PgStateStore(),
        sessionStore: new PgSessionStore(),
      });
    })();
    // Clear on failure so the next call retries rather than returning the
    // cached rejection permanently.
    _clientPromise.catch(() => {
      _clientPromise = undefined;
    });
  }
  return _clientPromise;
}

export { getClient };
