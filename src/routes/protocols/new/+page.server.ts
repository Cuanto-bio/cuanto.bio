import type { l } from '@atproto/lex';
import { fail, redirect } from '@sveltejs/kit';
import * as SurveyProtocol from '$lib/lexicons/bio/lexicons/temp/v0-1/surveyProtocol';
import * as SurveyTarget from '$lib/lexicons/bio/lexicons/temp/v0-1/surveyTarget';
import type { Main as SurveyTargetMain } from '$lib/lexicons/bio/lexicons/temp/v0-1/surveyTarget.defs';
import sql from '$lib/server/db';
import { insertProtocol, insertTarget } from '$lib/server/db/survey-protocols';
import { parseLocationOptions } from '$lib/server/locationOptions';
import { createRecord } from '$lib/server/pds';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.did) redirect(302, '/auth/signin');
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.did) redirect(302, '/auth/signin');
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

    let locationOptions: ReturnType<typeof parseLocationOptions>;
    try {
      locationOptions = parseLocationOptions(locationOptionsJson);
    } catch {
      return fail(422, { error: 'Invalid location options' });
    }

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
        'bio.lexicons.temp.v0-1.surveyProtocol',
        protocolRecord,
      ));
    } catch (err) {
      return fail(502, { error: `PDS error: ${String(err)}` });
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
      const targetRecord = SurveyTarget.$build({
        protocol: protocolUri as l.AtUriString,
        scope: target.scope as unknown as SurveyTargetMain['scope'],
      });

      try {
        const { uri: targetUri } = await createRecord(
          did,
          'bio.lexicons.temp.v0-1.surveyTarget',
          targetRecord,
        );
        const targetRkey = targetUri.split('/').at(-1) ?? '';
        await insertTarget(did, targetRkey, targetRecord, targetUri);
      } catch (err) {
        console.error('Failed to create survey target:', err);
      }
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
