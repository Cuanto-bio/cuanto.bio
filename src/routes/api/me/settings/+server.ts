import { json } from '@sveltejs/kit';
import { DEFAULT_REMARK_LICENSE, isKnownLicense } from '$lib/licenses';
import {
  getDefaultRemarkLicense,
  setDefaultRemarkLicense,
} from '$lib/server/db/users';
import type { RequestHandler } from './$types';

// The signed-in user's own app-level preferences, edited on /app/account.
// Deliberately separate from /api/me: that response feeds the /app layout
// guard on every navigation and its IndexedDB user cache, both of which were
// kept minimal on purpose (#68, #70).

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const stored = await getDefaultRemarkLicense(locals.did);
  // A value we no longer offer (an SPDX id from an older build, say) would
  // reach the Select with no matching option, so it degrades to the default.
  return json({
    defaultRemarkLicense: isKnownLicense(stored)
      ? stored
      : DEFAULT_REMARK_LICENSE,
  });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as { defaultRemarkLicense?: string };
  if (!isKnownLicense(body.defaultRemarkLicense)) {
    return json(
      { error: 'defaultRemarkLicense must be a supported license URI' },
      { status: 422 },
    );
  }

  await setDefaultRemarkLicense(locals.did, body.defaultRemarkLicense);
  return json({ defaultRemarkLicense: body.defaultRemarkLicense });
};
