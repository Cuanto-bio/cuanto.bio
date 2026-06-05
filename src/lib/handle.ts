// Client-safe handle normalization and validation. Lives outside $lib/server so
// both the sign-in form (browser) and the form action (server) share one
// implementation. The OAuth client's authorize() accepts a handle, a DID, or a
// PDS/entryway URL, so we treat all three as valid identifiers.

import { isValidHandle } from '@atproto/syntax';

/**
 * Cleans raw user input into something authorize() is likely to accept.
 *
 * Handles the common mistakes new Atmosphere users make, especially those
 * coming from Mastodon, where the `@user@server` convention is muscle memory:
 *
 *   `@kueda.bsky.social`  -> `kueda.bsky.social`  (stray leading @)
 *   `kueda@bsky.social`   -> `kueda.bsky.social`  (fediverse-style @)
 *   `@kueda@bsky.social`  -> `kueda.bsky.social`  (both at once)
 *
 * DIDs and PDS/entryway URLs are left untouched apart from trimming: they have
 * different casing and structure rules than handles, so rewriting `@` or
 * lowercasing them would corrupt valid input.
 */
export function sanitizeHandleInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('did:') || trimmed.includes('://')) return trimmed;
  return trimmed
    .replace(/^@+/, '') // strip leading @ symbols
    .replace(/@+$/, '') // strip trailing @ symbols
    .replace(/@+/g, '.') // convert remaining fediverse-style @ into dots
    .toLowerCase();
}

/**
 * Whether normalized input is something we can attempt OAuth with: a valid
 * handle, a DID, or a PDS/entryway URL. Used for inline feedback on the sign-in
 * form; the server still attempts authorize() and reports real failures.
 */
export function isLikelyIdentifier(normalized: string): boolean {
  if (normalized.startsWith('did:')) return true;
  if (normalized.includes('://')) return true;
  return isValidHandle(normalized);
}
