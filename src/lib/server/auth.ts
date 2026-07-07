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

// Collections Cuanto reads and writes in the user's own repo. Keep in sync with
// the lexicons under src/lib/lexicons/bio (their $nsid values). Used to build a
// granular OAuth scope so the consent screen names only what the app touches,
// instead of the alarming, do-anything `transition:generic` (issue #18).
const REPO_COLLECTIONS = [
  'bio.cuanto.surveyProtocol',
  'bio.cuanto.surveyProtocol.follow',
  'bio.cuanto.protocolTarget',
  'bio.cuanto.survey',
  'bio.cuanto.surveyTarget',
  'bio.lexicons.temp.v0-1.occurrence',
  'bio.lexicons.temp.v0-1.identification',
  'bio.lexicons.temp.v0-1.media',
];

// Old-namespace collections the admin lexicon cleanup (cleanupMigratedRecords
// in migrate-lexicons.ts) deletes from the user's repo after migrating them to
// the bio.cuanto.* namespace. We only need delete on these, and only until every
// user is migrated + cleaned up — then this list (and the cleanup) can go away.
const LEGACY_DELETE_COLLECTIONS = [
  'bio.lexicons.temp.v0-1.surveyProtocol',
  'bio.lexicons.temp.surveyProtocol',
  'bio.lexicons.temp.v0-1.surveyTarget',
  'bio.lexicons.temp.surveyTarget',
  'bio.lexicons.temp.v0-1.survey',
  'bio.lexicons.temp.survey',
];

// Granular permission scope (https://atproto.com/specs/permission):
// - `atproto`: required base scope (session + identity resolution).
// - `repo:<nsid>`: create/update/delete records in each collection above. All
//   of the app's PDS writes go through com.atproto.repo.* which this covers.
// - `repo:<legacy>?action=delete`: let the migration cleanup delete old records.
// - `blob:*/*`: upload GPX track blobs and photos (com.atproto.repo.uploadBlob).
// NOTE: not yet verified against a live PDS OAuth flow — see
// docs/2026-07-05-issue-18-oauth-scopes.md before deploying. `identity`/`rpc`
// (guessed in the issue) appear unnecessary: the app never changes the user's
// handle and makes no appview RPC calls.
const SCOPE = [
  'atproto',
  ...REPO_COLLECTIONS.map((nsid) => `repo:${nsid}`),
  ...LEGACY_DELETE_COLLECTIONS.map((nsid) => `repo:${nsid}?action=delete`),
  'blob:*/*',
].join(' ');

// Compares a session's actually-granted scope (from its stored OAuth token
// set) against what the app currently requires. A session predating a newly
// added `repo:<nsid>` entry in SCOPE, or one the user only partially
// consented to, will fail here — callers should treat that like an expired
// session and force re-authorization, since refreshing a token can never
// widen its granted scope; only a fresh /authorize round trip can.
export function isScopeSufficient(
  grantedScope: string | undefined,
  requiredScope: string = SCOPE,
): boolean {
  if (!grantedScope) return false;
  const granted = new Set(grantedScope.split(/\s+/));
  return requiredScope.split(/\s+/).every((token) => granted.has(token));
}

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
