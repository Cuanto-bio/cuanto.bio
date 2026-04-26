import { getSurveysPage } from '$lib/server/db/surveys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  return { surveys: await getSurveysPage() };
};
