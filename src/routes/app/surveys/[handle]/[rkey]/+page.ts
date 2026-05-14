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

export const load: PageLoad = async ({ fetch, params, parent }) => {
  async function fetchAndCacheSurvey() {
    try {
      const res = await fetch(`/api/surveys/${params.handle}/${params.rkey}`);
      if (res.ok) {
        survey = (await res.json()) as CachedSurvey;
        await cacheSurvey(survey);
        return survey;
      }
      if (res.status === 404) error(404, 'Survey not found');
      log.error(
        `[${params.handle}/${params.rkey}] failed to fetch survey, res.status: ${res.status}`,
      );
    } catch (err) {
      log.error({ err }, 'Failed to fetch survey');
    }
  }

  const [layoutData, cachedSurvey] = await Promise.all([
    parent(),
    getCachedSurveyByRkey(params.rkey),
  ]);

  let survey = cachedSurvey;
  if (survey) {
    // We have a local copy, update it in the background
    fetchAndCacheSurvey();
  } else {
    // We don't have a local copy, wait for the remote one
    survey = await fetchAndCacheSurvey();
  }
  if (!survey) return error(404, 'Survey not found');

  const protocol = await getCachedProtocolByRkey(survey.protocolRkey);
  // TODO get remote protocol if we don't have it in the cache
  if (!protocol) return error(404, 'Procotol not found');

  const isOwner = layoutData.handle === params.handle;

  return { survey, protocol, isOwner };
};
