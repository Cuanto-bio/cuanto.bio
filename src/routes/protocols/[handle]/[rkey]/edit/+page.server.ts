import type { l } from '@atproto/lex';
import { error, fail, redirect } from '@sveltejs/kit';
import * as SurveyProtocol from '$lib/lexicons/bio/lexicons/temp/surveyProtocol';
import * as SurveyTarget from '$lib/lexicons/bio/lexicons/temp/surveyTarget';
import type { Main as SurveyTargetMain } from '$lib/lexicons/bio/lexicons/temp/surveyTarget.defs';
import logger from '$lib/logger';
import sql from '$lib/server/db';
import {
  deleteTargetsByProtocolUri,
  getProtocolDetailByHandleAndRkey,
  insertProtocol,
  insertTarget,
} from '$lib/server/db/survey-protocols';
import { parseLocationOptions } from '$lib/server/locationOptions';
import { createRecord, deleteRecord, putRecord } from '$lib/server/pds';
import type { Actions, PageServerLoad } from './$types';

const log = logger.child({ component: 'edit-protocol' });

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.did) redirect(302, '/auth/signin');

  const protocol = await getProtocolDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!protocol) error(404, 'Protocol not found');

  const [row] = await sql<{ did: string }[]>`
    SELECT did FROM survey_protocols WHERE at_uri = ${protocol.atUri}
  `;
  if (!row || row.did !== locals.did) error(403, 'Forbidden');

  return { protocol };
};

export const actions: Actions = {
  default: async ({ request, locals, params }) => {
    if (!locals.did) redirect(302, '/auth/signin');
    const { did } = locals;
    const { handle, rkey } = params;

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

    const existing = await getProtocolDetailByHandleAndRkey(handle, rkey);
    if (!existing) return fail(404, { error: 'Protocol not found' });

    const [ownerRow] = await sql<{ did: string }[]>`
      SELECT did FROM survey_protocols WHERE at_uri = ${existing.atUri}
    `;
    if (!ownerRow || ownerRow.did !== did)
      return fail(403, { error: 'Forbidden' });

    const protocolRecord = SurveyProtocol.$build({
      title,
      description,
      createdAt: existing.record.createdAt,
      ...(requiredFields.length ? { requiredFields } : {}),
      ...(locationOptions.length ? { locationOptions } : {}),
    });

    let protocolCid: string;
    try {
      ({ cid: protocolCid } = await putRecord(
        did,
        'bio.lexicons.temp.surveyProtocol',
        rkey,
        protocolRecord,
      ));
    } catch (err) {
      return fail(502, { error: `PDS error: ${String(err)}` });
    }

    await insertProtocol(
      did,
      rkey,
      protocolRecord,
      existing.atUri,
      protocolCid,
    );

    const deletedTargets = await deleteTargetsByProtocolUri(existing.atUri);
    for (const { at_uri } of deletedTargets) {
      try {
        await deleteRecord(at_uri);
      } catch (err) {
        log.error({ err }, 'Failed to delete survey target from PDS');
      }
    }

    for (const target of targets) {
      const targetRecord = SurveyTarget.$build({
        protocol: existing.atUri as l.AtUriString,
        scope: target.scope as unknown as SurveyTargetMain['scope'],
      });

      try {
        const { uri: targetUri } = await createRecord(
          did,
          'bio.lexicons.temp.surveyTarget',
          targetRecord,
        );
        const targetRkey = targetUri.split('/').at(-1) ?? '';
        await insertTarget(did, targetRkey, targetRecord, targetUri);
      } catch (err) {
        log.error({ err }, 'Failed to create survey target');
      }
    }

    redirect(302, `/app/protocols/${handle}/${rkey}?updated=1`);
  },
};
