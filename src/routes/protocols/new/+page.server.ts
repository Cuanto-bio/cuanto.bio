import type { l } from '@atproto/lex';
import { fail, redirect } from '@sveltejs/kit';
import * as SurveyProtocol from '$lib/lexicons/bio/lexicons/temp/surveyProtocol';
import * as SurveyTarget from '$lib/lexicons/bio/lexicons/temp/surveyTarget';
import { client as oauthClient } from '$lib/server/auth';
import { insertProtocol, insertTarget } from '$lib/server/protocols';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.did) redirect(302, '/auth/signin');
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.did) redirect(302, '/auth/signin');
    const did = locals.did;

    const formData = await request.formData();
    const title = (formData.get('title') as string | null)?.trim();
    const description = (formData.get('description') as string | null)?.trim();
    const requiredFields = formData.getAll('requiredFields') as string[];
    const targetsJson = formData.get('targets') as string | null;

    if (!title) return fail(422, { error: 'Title is required' });
    if (!description) return fail(422, { error: 'Description is required' });

    let targets: { scope: unknown[] }[] = [];
    try {
      targets = JSON.parse(targetsJson ?? '[]');
    } catch {
      return fail(422, { error: 'Invalid targets' });
    }

    const session = await oauthClient.restore(did);

    const protocolRecord = SurveyProtocol.$build({
      title,
      description,
      createdAt: new Date().toISOString() as l.DatetimeString,
      ...(requiredFields.length ? { requiredFields } : {}),
    });

    const protocolResp = await session.fetchHandler(
      '/xrpc/com.atproto.repo.createRecord',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: did,
          collection: 'bio.lexicons.temp.surveyProtocol',
          record: protocolRecord,
        }),
      },
    );

    if (!protocolResp.ok) {
      const body = await protocolResp.text();
      return fail(502, { error: `PDS error: ${body}` });
    }

    const { uri: protocolUri } = (await protocolResp.json()) as {
      uri: string;
      cid: string;
    };
    const protocolRkey = protocolUri.split('/').at(-1)!;

    await insertProtocol(did, protocolRkey, protocolRecord, protocolUri);

    for (const target of targets) {
      const targetRecord = SurveyTarget.$build({
        protocol: protocolUri as l.AtUriString,
        scope: target.scope as any,
      });

      const targetResp = await session.fetchHandler(
        '/xrpc/com.atproto.repo.createRecord',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: did,
            collection: 'bio.lexicons.temp.surveyTarget',
            record: targetRecord,
          }),
        },
      );

      if (targetResp.ok) {
        const { uri: targetUri } = (await targetResp.json()) as {
          uri: string;
          cid: string;
        };
        const targetRkey = targetUri.split('/').at(-1)!;
        await insertTarget(did, targetRkey, targetRecord, targetUri);
      } else {
        console.error(
          'Failed to create survey target:',
          await targetResp.text(),
        );
      }
    }

    redirect(302, '/protocols');
  },
};
