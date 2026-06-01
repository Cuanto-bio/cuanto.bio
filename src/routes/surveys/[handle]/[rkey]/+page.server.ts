import { error, redirect } from '@sveltejs/kit';
import {
  getProtocolByUri,
  getTargetsForProtocols,
} from '$lib/server/db/survey-protocols';
import { getSurveyDetailByHandleAndRkey } from '$lib/server/db/surveys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const survey = await getSurveyDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!survey) error(404, 'Survey not found');

  if (locals.did && locals.did === survey.did)
    redirect(302, `/app/surveys/${params.handle}/${params.rkey}${url.search}`);

  const protocolRow = await getProtocolByUri(survey.record.protocol.uri);
  if (!protocolRow) error(404, 'Protocol not found');

  const targetRows = await getTargetsForProtocols([protocolRow.at_uri]);
  const protocol = {
    atUri: protocolRow.at_uri,
    rkey: protocolRow.rkey,
    handle: protocolRow.handle,
    record: protocolRow.record,
    targets: targetRows.map((r) => ({ atUri: r.at_uri, record: r.record })),
  };

  return { survey, protocol };
};
