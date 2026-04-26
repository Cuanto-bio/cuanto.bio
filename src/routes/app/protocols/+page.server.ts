import { getProtocolsPage } from '$lib/server/db/survey-protocols';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  return { protocols: await getProtocolsPage() };
};
