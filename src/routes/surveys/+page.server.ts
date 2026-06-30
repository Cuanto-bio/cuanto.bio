import { getProtocolsByUris } from '$lib/server/db/survey-protocols';
import { getSurveysPage, getTaxonName } from '$lib/server/db/surveys';
import { urlToSurveyParams } from '$lib/surveys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const surveyParams = urlToSurveyParams(url);
  const taxonID = surveyParams.taxonID ?? null;
  const startDate = surveyParams.startDate || null;
  const stopDate = surveyParams.stopDate || null;
  const [surveys, protocols, taxonName] = await Promise.all([
    getSurveysPage(undefined, undefined, surveyParams),
    getProtocolsByUris(surveyParams.protocolUris ?? []),
    taxonID ? getTaxonName(taxonID) : Promise.resolve(null),
  ]);
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
    },
  };
};
