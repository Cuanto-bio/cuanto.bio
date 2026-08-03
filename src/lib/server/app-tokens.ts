import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import sql from '$lib/server/db';

/**
 * Opaque bearer tokens for non-browser clients (the Capacitor iOS app), which
 * cannot use the `did` cookie: the app loads from `capacitor://localhost` and
 * calls `https://cuanto.bio`, so the cookie is cross-site and WKWebView drops
 * it.
 *
 * A token carries exactly the authority the `did` cookie does — it names a DID
 * whose real OAuth session (including DPoP keys) lives in `oauth_sessions`.
 * Nothing here touches the PDS session layer.
 */

// 32 bytes of CSPRNG output. Guessing is not a threat model at this size, which
// is why there is no rate limiting on lookup.
const TOKEN_BYTES = 32;

/**
 * One year. Deliberately not the `did` cookie's 30 days: this is a field app
 * for multi-month survey seasons, and being logged out mid-survey on a
 * mountainside is a data-loss event, not an inconvenience. Revocation, not
 * expiry, is the real control here — see `revokeToken`.
 */
export const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * SHA-256, not a password hash. The stored value protects against a leaked
 * database dump yielding usable credentials; it is not guarding a low-entropy
 * secret, so the slow-KDF reasoning that applies to passwords does not apply.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Scheme match is case-insensitive per RFC 7235. Kept as one regex, used by
// both the parser and the "is this ours?" check, so callers cannot disagree
// about what counts as a Bearer header.
const BEARER_RE = /^Bearer[ \t]+(\S+)$/i;

/**
 * Whether an `Authorization` header is a Bearer credential we should act on.
 *
 * Callers need this separately from `resolveBearerDid` because "no Bearer
 * header" and "a Bearer header that did not resolve" must be handled
 * differently: the first falls back to cookie auth, the second must not.
 */
export function isBearerHeader(header: string | undefined | null): boolean {
  return !!header && /^Bearer[ \t]/i.test(header.trim());
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = BEARER_RE.exec(header.trim());
  return match ? match[1] : null;
}

export async function issueToken(
  did: string,
  label?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await sql`
    INSERT INTO app_tokens (token_hash, did, label, expires_at)
    VALUES (${hashToken(token)}, ${did}, ${label ?? null}, ${expiresAt})
  `;
  return { token, expiresAt };
}

/**
 * How stale `last_used_at` may get before a request refreshes it. It exists for
 * "last seen on this device" and idle-token policy, neither of which needs
 * per-request precision.
 */
const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

/**
 * Resolves an `Authorization` header to a DID, or undefined if it does not name
 * a live token. Unknown, expired and revoked tokens are indistinguishable to
 * the caller on purpose — the header either authenticates or it does not.
 *
 * Authentication is a plain SELECT rather than `UPDATE … RETURNING`. Every
 * authenticated request runs this, and the app fires a dozen /api calls in
 * parallel on the same token, so writing on each one would make them queue on a
 * single row's lock and keep one row permanently hot. The `last_used_at` bump
 * is therefore throttled to once per LAST_USED_REFRESH_MS and not awaited — it
 * is bookkeeping, and a request must not fail or wait on it.
 */
export async function resolveBearerDid(
  header: string | undefined | null,
): Promise<string | undefined> {
  const token = parseBearer(header);
  if (!token) return undefined;

  const tokenHash = hashToken(token);
  const rows = await sql<{ did: string; last_used_at: Date | null }[]>`
    SELECT did, last_used_at FROM app_tokens
    WHERE token_hash = ${tokenHash}
      AND revoked_at IS NULL
      AND expires_at > now()
  `;
  const row = rows[0];
  if (!row) return undefined;

  const stale =
    !row.last_used_at ||
    Date.now() - row.last_used_at.getTime() > LAST_USED_REFRESH_MS;
  if (stale) {
    // Fire and forget. A racing duplicate write is harmless: both set now().
    sql`
      UPDATE app_tokens SET last_used_at = now()
      WHERE token_hash = ${tokenHash}
    `.catch(() => {});
  }

  return row.did;
}

export async function revokeToken(token: string): Promise<void> {
  await sql`
    UPDATE app_tokens
    SET revoked_at = now()
    WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL
  `;
}

/** Revokes every live token for a DID — "sign out everywhere". */
export async function revokeAllTokensForDid(did: string): Promise<void> {
  await sql`
    UPDATE app_tokens
    SET revoked_at = now()
    WHERE did = ${did} AND revoked_at IS NULL
  `;
}

/**
 * Constant-time compare for the one place a secret is checked against a value
 * the caller supplies rather than looked up by hash: the one-time exchange code
 * in the native OAuth handoff.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
