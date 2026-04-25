import { error } from '@sveltejs/kit';
import {
  getProtocolByUri,
  getTargetsForProtocols,
} from '$lib/server/db/survey-protocols';
import { getSurveyDetailByHandleAndRkey } from '$lib/server/db/surveys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const survey = await getSurveyDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!survey) error(404, 'Survey not found');
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
