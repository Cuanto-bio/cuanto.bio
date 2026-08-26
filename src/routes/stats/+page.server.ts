import { getProtocolsByUris } from '$lib/server/db/survey-protocols';
import { getHandleByDid } from '$lib/server/db/users';
import { urlToSurveyParams } from '$lib/surveys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const { protocolUris, startDate, stopDate, bbox } = urlToSurveyParams(url);
  const surveyedByDid = url.searchParams.get('surveyedBy');

  const [initialProtocols, surveyedByHandle] = await Promise.all([
    protocolUris ? getProtocolsByUris(protocolUris) : Promise.resolve([]),
    surveyedByDid ? getHandleByDid(surveyedByDid) : Promise.resolve(null),
  ]);

  const { north, south, east, west } = bbox ?? {};
  const initialBbox =
    north && south && east && west ? { north, south, east, west } : null;

  // Only carried through when the did actually resolves to a known user, so a
  // stale or bogus surveyedBy in the URL degrades to an unfiltered view
  // rather than showing a chip for a user that doesn't exist.
  const initialSurveyedBy =
    surveyedByDid && surveyedByHandle
      ? { did: surveyedByDid, handle: surveyedByHandle }
      : null;

  return {
    initialProtocols,
    initialStart: startDate,
    initialEnd: stopDate,
    initialBbox,
    initialSurveyedBy,
  };
};
