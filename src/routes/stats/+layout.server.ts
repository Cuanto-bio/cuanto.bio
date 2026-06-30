import { loadUserHandle } from '$lib/server/user.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return loadUserHandle(locals.did);
};
