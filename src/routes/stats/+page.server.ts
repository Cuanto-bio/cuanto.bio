import { getProtocolsByUris } from '$lib/server/db/survey-protocols';
import { urlToSurveyParams } from '$lib/surveys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const { protocolUris, startDate, stopDate, bbox } = urlToSurveyParams(url);

  const initialProtocols = protocolUris
    ? await getProtocolsByUris(protocolUris)
    : [];

  const { north, south, east, west } = bbox ?? {};
  const initialBbox =
    north && south && east && west ? { north, south, east, west } : null;

  return {
    initialProtocols,
    initialStart: startDate,
    initialEnd: stopDate,
    initialBbox,
  };
};
