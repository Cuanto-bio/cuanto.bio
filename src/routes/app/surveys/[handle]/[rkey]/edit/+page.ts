import { error } from '@sveltejs/kit';
import logger from '$lib/logger';
import {
  type CachedSurvey,
  cacheSurvey,
  getCachedProtocolByRkey,
  getCachedSurveyByRkey,
} from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-survey-edit' });

export const load: PageLoad = async ({ fetch, params, parent }) => {
  const { handle: userHandle } = await parent();

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
  if (!survey) error(404, 'Survey not found');

  if (survey.handle !== userHandle) error(403, 'Forbidden');

  const protocol = await getCachedProtocolByRkey(survey.protocolRkey);
  if (!protocol) error(404, 'Protocol not found');

  return { survey, protocol };
};
