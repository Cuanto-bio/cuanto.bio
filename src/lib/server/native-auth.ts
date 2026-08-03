import { createHash, randomBytes } from 'node:crypto';
import { hashToken, issueToken, safeEqual } from '$lib/server/app-tokens';
import sql from '$lib/server/db';

/**
 * The native OAuth handoff.
 *
 * The app cannot use the `did` cookie (cross-site from capacitor://localhost),
 * and it cannot run the PDS authorization inside its own webview either — that
 * is what a system browser is for. So:
 *
 *  1. App generates a random `verifier`, keeps it in memory, and opens
 *     `/auth/signin?client=native&challenge=<S256(verifier)>` in the system
 *     browser (ASWebAuthenticationSession).
 *  2. Normal atproto OAuth runs there, ending at /oauth/callback.
 *  3. The callback mints a single-use code and redirects to
 *     `bio.cuanto.app://auth?code=…`, which the app intercepts.
 *  4. The app POSTs `{ code, verifier }` to /api/auth/token and gets a bearer
 *     token, which it stores in the iOS Keychain.
 *
 * The code alone is worthless: on iOS any installed app can claim a custom URL
 * scheme, so the redirect must be assumed readable by an attacker. Only the app
 * that started the flow holds the verifier. This is RFC 7636 reasoning applied
 * to our own handoff rather than to the upstream PDS authorization.
 */

/**
 * Ten minutes, because redemption is paced by a human rather than a redirect.
 *
 * This was two minutes on the assumption that the callback redirected straight
 * into the app, so a code lived for seconds. It does not: SFSafariViewController
 * drops redirects to custom schemes without user interaction, so the handoff is
 * a page the user reads and taps through — and then iOS asks them to confirm
 * opening the app. Two minutes silently expired codes for anyone who paused,
 * producing a 401 that looked like a broken exchange rather than a timeout.
 *
 * Still short, still single-use, and still worthless without the PKCE verifier,
 * which is the control that actually matters here — the TTL is defence in
 * depth, not the thing standing between an intercepted code and a token.
 */
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_BYTES = 32;

/**
 * Custom URL scheme the native app registers, used only to hand the code back.
 * Must match the Capacitor `appId`. Not a secret and not a security boundary —
 * see the note above about other apps being able to claim it.
 */
export const NATIVE_REDIRECT_SCHEME = 'bio.cuanto.app';

/**
 * Cookie carrying the PKCE challenge across the OAuth round trip. It lives in
 * the *system browser*, which is a normal cookie jar — the cross-site problem
 * that motivates bearer tokens applies to the app's own webview, not here.
 */
export const NATIVE_CHALLENGE_COOKIE = 'native_challenge';

/** BASE64URL(SHA256(ASCII(verifier))) — RFC 7636 S256. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Whether a client-supplied challenge is well-formed, checked before it is
 * carried through the OAuth round trip. A 32-byte S256 digest is always 43
 * base64url characters, so anything else is a malformed or hostile client.
 */
export function isValidChallenge(
  challenge: string | undefined | null,
): boolean {
  return !!challenge && /^[A-Za-z0-9_-]{43}$/.test(challenge);
}

/** Constant-time check that `verifier` is the preimage of `challenge`. */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  return safeEqual(challengeFor(verifier), challenge);
}

/** Mints a single-use code bound to the caller's PKCE challenge. */
export async function issueCode(
  did: string,
  challenge: string,
): Promise<string> {
  const code = randomBytes(CODE_BYTES).toString('base64url');
  await sql`
    INSERT INTO app_token_codes (code_hash, did, challenge, expires_at)
    VALUES (
      ${hashToken(code)}, ${did}, ${challenge},
      ${new Date(Date.now() + CODE_TTL_MS)}
    )
  `;
  return code;
}

export class CodeExchangeError extends Error {}

/**
 * Redeems a code for a bearer token. Throws CodeExchangeError for every failure
 * mode — unknown, expired, already consumed, wrong verifier — because the
 * caller must not be able to tell them apart.
 *
 * The consume is a conditional UPDATE rather than a read-then-write so two
 * concurrent redemptions of the same code cannot both succeed: only one
 * statement can transition `consumed_at` from NULL.
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  label?: string,
): Promise<{ token: string; expiresAt: Date }> {
  if (!code || !verifier) throw new CodeExchangeError('Invalid code');

  const rows = await sql<{ did: string; challenge: string }[]>`
    UPDATE app_token_codes
    SET consumed_at = now()
    WHERE code_hash = ${hashToken(code)}
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING did, challenge
  `;
  const row = rows[0];
  if (!row) throw new CodeExchangeError('Invalid code');

  // The code is now spent either way. A wrong verifier does not get a second
  // attempt, which is what makes racing a stolen code a single-shot gamble
  // rather than something to brute-force.
  if (!verifierMatches(verifier, row.challenge)) {
    throw new CodeExchangeError('Invalid code');
  }

  return issueToken(row.did, label);
}

/** Drops expired rows. Called opportunistically; nothing depends on it. */
export async function sweepExpiredCodes(): Promise<void> {
  await sql`DELETE FROM app_token_codes WHERE expires_at < now()`;
}
