import {
  buildAtprotoLoopbackClientMetadata,
  JoseKey,
  Keyset,
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedState,
  type OAuthClientMetadataInput,
} from '@atproto/oauth-client-node';
import { PRIVATE_OAUTH_KEY } from '$env/static/private';
import { PUBLIC_OAUTH_CLIENT_ID, PUBLIC_URL } from '$env/static/public';
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
const isLoopback = PUBLIC_OAUTH_CLIENT_ID.startsWith('http://localhost');

function buildClientMetadata() {
  if (isLoopback) {
    // Loopback client for local dev. PDS won't fetch metadata; scope and redirect_uri
    // are encoded in the client_id URL. token_endpoint_auth_method is 'none'.
    return buildAtprotoLoopbackClientMetadata({
      scope: SCOPE,
      redirect_uris: [`${PUBLIC_URL}/oauth/callback`],
    });
  }
  // Discoverable client for production: PDS fetches metadata from the client_id URL.
  return {
    client_id: PUBLIC_OAUTH_CLIENT_ID,
    client_name: 'Cuanto.bio',
    client_uri: PUBLIC_URL,
    redirect_uris: [`${PUBLIC_URL}/oauth/callback`],
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
  if (!PRIVATE_OAUTH_KEY)
    throw new Error(
      'PRIVATE_OAUTH_KEY env var is required for production OAuth',
    );
  return new Keyset([await JoseKey.fromJWK(JSON.parse(PRIVATE_OAUTH_KEY))]);
}

const keyset = await buildKeyset();

const client = new NodeOAuthClient({
  clientMetadata: buildClientMetadata(),
  keyset,
  stateStore: new PgStateStore(),
  sessionStore: new PgSessionStore(),
});

export { client };
