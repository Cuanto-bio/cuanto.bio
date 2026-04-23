import { error, json } from '@sveltejs/kit';
import { getSurveyDetailByHandleAndRkey } from '$lib/server/db/surveys';
import type { RequestHandler } from './$types';

// Surveys are publicly readable. Auth is required only to prevent anonymous
// scraping; any authenticated user may view any other user's survey.
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const result = await getSurveyDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!result) error(404, 'Survey not found');

  return json(result);
};
