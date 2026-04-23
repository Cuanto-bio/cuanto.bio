import { error } from '@sveltejs/kit';
import type { CachedProtocol } from '$lib/offline/db';
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
  const protocolRow = await getProtocolByUri(survey.protocolUri);
  if (!protocolRow) error(404, 'Protocol not found');
  const targetRows = await getTargetsForProtocols([protocolRow.at_uri]);
  const protocol: Omit<CachedProtocol, 'cachedAt'> = {
    atUri: protocolRow.at_uri,
    rkey: protocolRow.rkey,
    title: protocolRow.title,
    description: protocolRow.description,
    handle: protocolRow.handle,
    targets: targetRows.map((r) => ({ atUri: r.at_uri, scope: r.scope })),
  };

  return { survey, protocol };
};
