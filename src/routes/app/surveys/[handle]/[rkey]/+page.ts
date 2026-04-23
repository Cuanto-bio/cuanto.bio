import { error } from '@sveltejs/kit';
import logger from '$lib/logger';
import {
  type CachedSurvey,
  cacheSurvey,
  getCachedProtocolByRkey,
  getCachedSurveyByRkey,
} from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-survey-detail' });

export const load: PageLoad = async ({ fetch, params }) => {
  async function fetchAndCacheSurvey() {
    try {
      const res = await fetch(`/api/surveys/${params.handle}/${params.rkey}`);
      if (res.ok) {
        survey = (await res.json()) as CachedSurvey;
        await cacheSurvey(survey);
        return survey;
      }
      if (res.status === 404) error(404, 'Survey not found');
    } catch (err) {
      log.error({ err }, 'Failed to fetch survey');
    }
  }

  let survey = await getCachedSurveyByRkey(params.rkey);
  if (survey) {
    fetchAndCacheSurvey();
  } else {
    survey = await fetchAndCacheSurvey();
  }
  if (!survey) return error(404, 'Survey not found');

  const protocol = await getCachedProtocolByRkey(survey.protocolRkey);
  if (!protocol) return error(404, 'Procotol not found');

  return { survey, protocol };
};
