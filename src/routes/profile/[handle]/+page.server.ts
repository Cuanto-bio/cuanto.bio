import { error } from '@sveltejs/kit';
import { countProtocolsByDid } from '$lib/server/db/survey-protocols';
import { countSurveysByDid } from '$lib/server/db/surveys';
import { getCachedBskyProfile, getUserByHandle } from '$lib/server/db/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const user = await getUserByHandle(params.handle);
  if (!user) error(404, 'User not found');

  const [bskyProfile, protocolCount, surveyCount] = await Promise.all([
    getCachedBskyProfile(user.did),
    countProtocolsByDid(user.did),
    countSurveysByDid(user.did),
  ]);

  return {
    // Prefixed (not `did`/`handle`) because SvelteKit merges page data over
    // the root layout's data by key, and the root layout uses those exact
    // names for the *signed-in visitor's* identity. Reusing them here would
    // make a signed-out visitor viewing someone else's profile show up in
    // the sidebar as if they were signed in as that profile.
    profileDid: user.did,
    profileHandle: user.handle,
    bskyProfile,
    protocolCount,
    surveyCount,
  };
};
