import { getProtocolsByUris } from '$lib/server/db/survey-protocols';
import { getSurveysPage, getTaxonName } from '$lib/server/db/surveys';
import { getHandleByDid } from '$lib/server/db/users';
import { urlToSurveyParams } from '$lib/surveys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const surveyParams = urlToSurveyParams(url);
  const taxonID = surveyParams.taxonID ?? null;
  const startDate = surveyParams.startDate || null;
  const stopDate = surveyParams.stopDate || null;
  // getSurveysPage only has to wait on the did->handle resolution below when
  // surveyedBy is actually in the URL. That's the uncommon case: most loads
  // have no surveyedBy at all, so the survey list has no such dependency and
  // can run in this same Promise.all instead of after it resolves.
  const [surveyedByHandle, protocols, taxonName, unfilteredSurveys] =
    await Promise.all([
      surveyParams.surveyedBy
        ? getHandleByDid(surveyParams.surveyedBy)
        : Promise.resolve(null),
      getProtocolsByUris(surveyParams.protocolUris ?? []),
      taxonID ? getTaxonName(taxonID) : Promise.resolve(null),
      surveyParams.surveyedBy
        ? Promise.resolve(null)
        : getSurveysPage(undefined, undefined, surveyParams),
    ]);

  // Only carried through when the did actually resolves to a known user, so a
  // stale or bogus surveyedBy in the URL degrades to an unfiltered list
  // rather than silently returning zero results for a user that doesn't exist.
  const surveys =
    unfilteredSurveys ??
    (await getSurveysPage(undefined, undefined, {
      ...surveyParams,
      surveyedBy: surveyedByHandle ? surveyParams.surveyedBy : undefined,
    }));

  const { north, south, east, west } = surveyParams.bbox ?? {};
  const activeBbox =
    north && south && east && west ? { north, south, east, west } : null;

  return {
    surveys,
    filters: {
      protocols,
      taxonID,
      taxonName,
      startDate,
      stopDate,
      bbox: activeBbox,
      surveyedByHandle,
    },
  };
};
