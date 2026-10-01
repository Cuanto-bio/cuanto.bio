import type { l } from '@atproto/lex';
import { fail, redirect } from '@sveltejs/kit';
import { webSignInHref } from '$lib/auth/signin';
import * as ProtocolTarget from '$lib/lexicons/bio/cuanto/protocolTarget';
import type { Main as ProtocolTargetMain } from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as SurveyProtocol from '$lib/lexicons/bio/cuanto/surveyProtocol';
import sql from '$lib/server/db';
import {
  insertProtocol,
  insertProtocolTarget,
} from '$lib/server/db/survey-protocols';
import { followProtocol } from '$lib/server/follow-protocol';
import { classifyTargets } from '$lib/server/inat-taxa';
import { parseLocationOptions } from '$lib/server/locationOptions';
import logger from '$lib/server/logger';
import { createRecord } from '$lib/server/pds';
import { pdsAuthErrorFail } from '$lib/server/pds-error-response';
import type { Actions, PageServerLoad } from './$types';

const log = logger.child({ component: 'protocols/new' });

// returnTo so signing in lands back on this form rather than dumping the
// visitor on the home page having lost what they came here to do.
const SIGN_IN_HREF = webSignInHref('/protocols/new');

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.did) redirect(302, SIGN_IN_HREF);
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.did) redirect(302, SIGN_IN_HREF);
    const { did } = locals;

    const formData = await request.formData();
    const title = (formData.get('title') as string | null)?.trim();
    const description = (formData.get('description') as string | null)?.trim();
    const requiredFields = formData.getAll('requiredFields') as string[];
    const targetsJson = formData.get('targets') as string | null;
    const locationOptionsJson = formData.get('locationOptions') as
      | string
      | null;

    if (!title) return fail(422, { error: 'Title is required' });
    if (!description) return fail(422, { error: 'Description is required' });

    let targets: { scope: unknown[] }[] = [];
    try {
      targets = JSON.parse(targetsJson ?? '[]');
    } catch {
      return fail(422, { error: 'Invalid targets' });
    }
    // Valid JSON of the wrong shape (e.g. from a stale or hand-built form) would
    // otherwise throw once the targets are used
    if (
      !Array.isArray(targets) ||
      !targets.every((t) => Array.isArray((t as { scope?: unknown })?.scope))
    ) {
      return fail(422, { error: 'Invalid targets' });
    }

    let locationOptions: ReturnType<typeof parseLocationOptions>;
    try {
      locationOptions = parseLocationOptions(locationOptionsJson);
    } catch {
      return fail(422, { error: 'Invalid location options' });
    }

    // Fill in each iNat taxon's classification for the taxonomic sort, before
    // anything is written (issue https://tangled.org/cuanto.bio/cuanto.bio/issues/81)
    targets = await classifyTargets(targets);

    const protocolRecord = SurveyProtocol.$build({
      title,
      description,
      createdAt: new Date().toISOString() as l.DatetimeString,
      ...(requiredFields.length ? { requiredFields } : {}),
      ...(locationOptions.length ? { locationOptions } : {}),
    });

    let protocolUri: string;
    let protocolCid: string;
    try {
      ({ uri: protocolUri, cid: protocolCid } = await createRecord(
        did,
        'bio.cuanto.surveyProtocol',
        protocolRecord,
      ));
    } catch (err) {
      return (
        pdsAuthErrorFail(err) ??
        fail(502, { error: `PDS error: ${String(err)}` })
      );
    }
    const protocolRkey = protocolUri.split('/').at(-1) ?? '';

    await insertProtocol(
      did,
      protocolRkey,
      protocolRecord,
      protocolUri,
      protocolCid,
    );

    for (const target of targets) {
      const targetRecord = ProtocolTarget.$build({
        protocol: protocolUri as l.AtUriString,
        scope: target.scope as unknown as ProtocolTargetMain['scope'],
      });

      try {
        const { uri: targetUri } = await createRecord(
          did,
          'bio.cuanto.protocolTarget',
          targetRecord,
        );
        const targetRkey = targetUri.split('/').at(-1) ?? '';
        await insertProtocolTarget(did, targetRkey, targetRecord, targetUri);
      } catch (err) {
        console.error('Failed to create survey target:', err);
      }
    }

    // The author automatically follows their own protocol; a PDS hiccup here
    // must not fail the creation the author is waiting on, since it's already
    // written. materializeSurveyTargets (inside followProtocol) also runs
    // again on the author's first survey, so a missed follow just means a
    // manual follow click later.
    try {
      await followProtocol(did, protocolUri);
    } catch (err) {
      log.error(
        { err, did, protocolUri },
        'failed to auto-follow newly created protocol',
      );
    }

    const [user] = await sql<{ handle: string }[]>`
      SELECT handle FROM users WHERE did = ${did}
    `;
    if (!user?.handle) {
      return fail(500, {
        error: 'User handle not found after protocol creation',
      });
    }

    redirect(302, `/protocols/${user.handle}/${protocolRkey}`);
  },
};
