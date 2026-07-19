import { loadUserHandle } from '$lib/server/user';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  return loadUserHandle(locals.did);
};
