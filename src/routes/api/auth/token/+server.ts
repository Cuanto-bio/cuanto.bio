import { json } from '@sveltejs/kit';
import { CodeExchangeError, exchangeCode } from '$lib/server/native-auth';
import type { RequestHandler } from './$types';

/**
 * Exchanges the single-use code from the native OAuth handoff for a bearer
 * token. See src/lib/server/native-auth.ts for the flow and why the code alone
 * is not sufficient.
 *
 * Unauthenticated by design: the code plus the PKCE verifier *are* the
 * credential. There is nothing else the caller could present at this point.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: { code?: unknown; verifier?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, { status: 422 });
  }

  const { code, verifier, label } = body;
  if (typeof code !== 'string' || typeof verifier !== 'string') {
    return json({ error: 'code and verifier are required' }, { status: 422 });
  }

  try {
    const { token, expiresAt } = await exchangeCode(
      code,
      verifier,
      typeof label === 'string' ? label.slice(0, 100) : undefined,
    );
    return json({ token, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof CodeExchangeError) {
      // One opaque failure for unknown, expired, already-consumed and
      // wrong-verifier. Telling them apart would let an attacker holding a
      // stolen code learn whether it was still live.
      return json({ error: 'Invalid or expired code' }, { status: 401 });
    }
    throw err;
  }
};
