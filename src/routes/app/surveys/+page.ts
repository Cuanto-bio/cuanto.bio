import logger from '$lib/logger';
import { cacheSurvey, getCachedSurveys } from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-surveys' });

export const load: PageLoad = async ({ fetch }) => {
  const cached = await getCachedSurveys();
  if (cached.length > 0) {
    fetch('/api/surveys')
      .then(async (res) => {
        if (res.ok) await Promise.all((await res.json()).map(cacheSurvey));
      })
      .catch((err) => {
        log.warn({ err }, 'Failed to update cached surveys');
      });
    return {
      surveys: cached,
    };
  }
  try {
    const res = await fetch('/api/surveys');
    if (res.ok) {
      const surveys = await res.json();
      await Promise.all(surveys.map(cacheSurvey));
      return { surveys };
    }
  } catch (err) {
    log.error({ err }, 'Failed to fetch surveys');
  }
  return { surveys: [] };
};
