import type { Permission, PermissionSet } from '@atproto/lex';
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
import authFull from '$lib/lexicons/bio/cuanto/authFull';
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

// Collections Cuanto reads and writes in the user's own repo *except* for
// those specified in the bio.cuanto.authFull permission set. Keep in sync
// with the lexicons under src/lib/lexicons/bio (their $nsid values). Used to
// build a granular OAuth scope so the consent screen names only what the app
// touches, instead of the alarming, do-anything `transition:generic`
// (issue #18).
const REPO_COLLECTIONS = [
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

// Granular permission scope (https://atproto.com/specs/permission)
const SCOPE = [
  // required for basic identity resolution
  'atproto',
  // atproto permission set of bio.cuanto.* lexicons (consent-screen metadata
  // lives in the lexicon; see lexicons/bio/cuanto/authFull.json)
  `include:${authFull.nsid}`,
  // all the other lexicons we need full access to, including bio.lexicons.*
  ...REPO_COLLECTIONS.map((nsid) => `repo:${nsid}`),
  // lexicons we've used in the past that we might need to clean up
  ...LEGACY_DELETE_COLLECTIONS.map((nsid) => `repo:${nsid}?action=delete`),
  // we use blobs for GPX tracks
  'blob:*/*',
].join(' ');

function asStrings(value: unknown): string[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

// Expands a permission-set lexicon into the scope tokens the authorization
// server grants for it when it is requested via `include:<nsid>` — the AS
// resolves the reference and returns its expansion in the granted scope, never
// the `include:` token itself, so sufficiency has to be checked against the
// expansion. Only `repo` permissions are handled (all this app's sets use);
// anything else throws at module load so an unhandled permission fails loudly
// rather than making the scope check silently too lax.
function permissionSetTokens(set: PermissionSet): string[] {
  const permissions = set.permissions as Permission[];
  return permissions.flatMap((perm) => {
    if (perm.resource !== 'repo') {
      throw new Error(
        `Permission set "${set.nsid}" has an unsupported "${perm.resource}" ` +
          'permission; isScopeSufficient only understands repo permissions.',
      );
    }
    const options = perm.options as { collection?: unknown; action?: unknown };
    const query = asStrings(options.action)
      .map((action) => `action=${action}`)
      .join('&');
    return asStrings(options.collection).map(
      (collection) => `repo:${collection}${query ? `?${query}` : ''}`,
    );
  });
}

// `include:<nsid>` permission sets this client requests, each mapped to the
// scope tokens its grant expands to. Derived from the generated lexicon so it
// can't drift from what the consent screen shows.
const PERMISSION_SETS: Record<string, readonly string[]> = {
  [authFull.nsid]: permissionSetTokens(authFull),
};

// atproto repo permission actions. Bare `repo:<nsid>` (no `?action=`) grants
// all three; the spec: "If not defined, all operations are allowed."
const REPO_ACTIONS = ['create', 'update', 'delete'] as const;
type RepoAction = (typeof REPO_ACTIONS)[number];

interface ParsedScope {
  // Tokens with no structured meaning here that must be present verbatim
  // (`atproto`, `transition:generic`, `rpc:*`, an unknown `include:` set, …).
  literals: Set<string>;
  // collection NSID (or `*` for the repo wildcard) -> actions permitted on it.
  repo: Map<string, Set<RepoAction>>;
  // blob MIME patterns, e.g. `*/*`, `image/*`, `application/gpx+xml`.
  blob: Set<string>;
}

function grantRepo(
  parsed: ParsedScope,
  collection: string,
  actions: Iterable<RepoAction>,
): void {
  let set = parsed.repo.get(collection);
  if (!set) {
    set = new Set();
    parsed.repo.set(collection, set);
  }
  for (const action of actions) set.add(action);
}

// Parses one `repo…` token: `repo:<nsid>`, `repo:*`, `repo:<nsid>?action=…`, or
// the compact multi-collection form `repo?collection=a&collection=b[&action=…]`.
function parseRepoToken(parsed: ParsedScope, token: string): void {
  const q = token.indexOf('?');
  const head = q === -1 ? token : token.slice(0, q);
  const params = new URLSearchParams(q === -1 ? '' : token.slice(q + 1));

  const actions = params
    .getAll('action')
    .filter((a): a is RepoAction =>
      (REPO_ACTIONS as readonly string[]).includes(a),
    );
  const effective = actions.length > 0 ? actions : REPO_ACTIONS;

  const collections =
    head === 'repo'
      ? params.getAll('collection')
      : [head.slice('repo:'.length)];
  for (const collection of collections) {
    if (collection) grantRepo(parsed, collection, effective);
  }
}

function parseScope(scope: string): ParsedScope {
  const parsed: ParsedScope = {
    literals: new Set(),
    repo: new Map(),
    blob: new Set(),
  };
  for (const token of scope.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith('include:')) {
      const name = token.slice('include:'.length).split('?')[0];
      const expansion = PERMISSION_SETS[name];
      if (expansion) {
        for (const inner of expansion) parseRepoToken(parsed, inner);
      } else {
        // Unknown set: its contents can't be verified, so require it verbatim.
        parsed.literals.add(token);
      }
    } else if (
      token === 'repo' ||
      token.startsWith('repo:') ||
      token.startsWith('repo?')
    ) {
      parseRepoToken(parsed, token);
    } else if (token.startsWith('blob:')) {
      parsed.blob.add(token.slice('blob:'.length));
    } else {
      parsed.literals.add(token);
    }
  }
  return parsed;
}

// Whether some granted MIME pattern covers a required one, with `*` wildcards
// in either the type or subtype position (`*/*`, `image/*`).
function blobCovered(granted: Set<string>, required: string): boolean {
  const [reqType, reqSub] = required.split('/');
  for (const pattern of granted) {
    const [type, sub] = pattern.split('/');
    if ((type === '*' || type === reqType) && (sub === '*' || sub === reqSub)) {
      return true;
    }
  }
  return false;
}

// Compares a session's actually-granted scope (from its stored OAuth token set)
// against what the app currently requires, so a session that predates a scope
// change — or one the user only partially consented to — is treated like an
// expired session and forced through a fresh /authorize round trip (a refresh
// can never widen a token's granted scope).
//
// Both sides are normalized before comparison: `include:<set>` is expanded to
// its `repo:` permissions, the compact `repo?collection=a&collection=b` form is
// expanded per collection, and bare `repo:<nsid>` is treated as all three
// actions. A literal token match on the raw strings does not work — the
// authorization server rewrites the scope it grants (notably it never echoes
// the `include:` token), so the granted and requested strings legitimately
// differ token-for-token for the same underlying permissions.
export function isScopeSufficient(
  grantedScope: string | undefined,
  requiredScope: string = SCOPE,
): boolean {
  if (!grantedScope) return false;

  const granted = parseScope(grantedScope);
  const required = parseScope(requiredScope);

  for (const literal of required.literals) {
    if (!granted.literals.has(literal)) return false;
  }
  const grantedWildcard = granted.repo.get('*');
  for (const [collection, actions] of required.repo) {
    const grantedActions = granted.repo.get(collection);
    for (const action of actions) {
      if (!grantedActions?.has(action) && !grantedWildcard?.has(action)) {
        return false;
      }
    }
  }
  for (const pattern of required.blob) {
    if (!blobCovered(granted.blob, pattern)) return false;
  }
  return true;
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
    logo_uri: `${publicEnv.PUBLIC_URL}/favicon.svg`,
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
