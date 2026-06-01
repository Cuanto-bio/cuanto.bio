import { error, redirect } from '@sveltejs/kit';
import logger from '$lib/logger';
import {
  type CachedSurvey,
  cacheProtocol,
  cacheSurvey,
  getCachedProtocolByRkey,
  getCachedSurveyByRkey,
  type Protocol,
} from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-survey-detail' });

export const load: PageLoad = async ({ fetch, params, parent, url }) => {
  const { handle: userHandle } = await parent();

  if (userHandle !== params.handle)
    redirect(302, `/surveys/${params.handle}/${params.rkey}${url.search}`);

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

  let survey = await getCachedSurveyByRkey(params.rkey);
  const justUpdated = url.searchParams.get('updated') === '1';
  if (survey && !justUpdated) {
    // We have a local copy, update it in the background
    fetchAndCacheSurvey();
  } else {
    // We don't have a local copy, wait for the remote one
    survey = await fetchAndCacheSurvey();
  }
  if (!survey) return error(404, 'Survey not found');

  let protocol: Protocol | undefined = await getCachedProtocolByRkey(
    survey.protocolRkey,
  );
  if (!protocol) {
    try {
      const res = await fetch(
        `/api/protocols/${survey.protocolHandle}/${survey.protocolRkey}`,
      );
      if (res.ok) {
        const data: { protocol: Protocol } = await res.json();
        await cacheProtocol(data.protocol);
        protocol = data.protocol;
      }
    } catch (err) {
      log.error({ err }, 'Failed to fetch missing protocol');
    }
  }
  if (!protocol) return error(404, 'Protocol not found');

  return { survey, protocol, isOwner: true };
};
