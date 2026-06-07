import type { l } from '@atproto/lex';
import { error, fail, redirect } from '@sveltejs/kit';
import * as ProtocolTarget from '$lib/lexicons/bio/cuanto/protocolTarget';
import type { Main as ProtocolTargetMain } from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as SurveyProtocol from '$lib/lexicons/bio/cuanto/surveyProtocol';
import logger from '$lib/logger';
import sql from '$lib/server/db';
import {
  deleteTargetsByUris,
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

    let targets: { scope: unknown[]; atUri?: string }[] = [];
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
        'bio.cuanto.surveyProtocol',
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

    const existingByUri = new Map(existing.targets.map((t) => [t.atUri, t]));
    const submittedUris = new Set(
      targets.flatMap((t) => (t.atUri ? [t.atUri] : [])),
    );

    const toDelete = existing.targets.filter(
      (t) => !submittedUris.has(t.atUri),
    );
    const toAdd = targets.filter((t) => !t.atUri);
    const toUpdate = targets.filter((t) => {
      if (!t.atUri) return false;
      const existingTarget = existingByUri.get(t.atUri);
      if (!existingTarget) return false;
      return (
        JSON.stringify(t.scope) !== JSON.stringify(existingTarget.record.scope)
      );
    });

    await deleteTargetsByUris(toDelete.map((t) => t.atUri));
    for (const target of toDelete) {
      try {
        await deleteRecord(target.atUri);
      } catch (err) {
        log.error({ err }, 'Failed to delete survey target from PDS');
      }
    }

    for (const target of toUpdate) {
      if (!target.atUri) continue;
      const existingTarget = existingByUri.get(target.atUri);
      if (!existingTarget) continue;
      const targetRecord = ProtocolTarget.$build({
        protocol: existing.atUri as l.AtUriString,
        scope: target.scope as unknown as ProtocolTargetMain['scope'],
      });
      const targetRkey = existingTarget.atUri.split('/').at(-1) ?? '';
      try {
        await putRecord(
          did,
          'bio.cuanto.protocolTarget',
          targetRkey,
          targetRecord,
        );
        await insertTarget(did, targetRkey, targetRecord, existingTarget.atUri);
      } catch (err) {
        log.error({ err }, 'Failed to update survey target');
      }
    }

    for (const target of toAdd) {
      const targetRecord = ProtocolTarget.$build({
        protocol: existing.atUri as l.AtUriString,
        scope: target.scope as unknown as ProtocolTargetMain['scope'],
      });

      try {
        const { uri: targetUri } = await createRecord(
          did,
          'bio.cuanto.protocolTarget',
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
