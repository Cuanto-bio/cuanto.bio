import { fetchDefaultRemarkLicense } from '$lib/licenses';
import type { PageLoad } from './$types';

// The default-license setting is a server-side preference, so it is fetched
// here rather than folded into /api/me (which the /app layout guard reads on
// every navigation). A failure is not fatal: /app is offline-capable and the
// rest of this page still works, so the setting hides itself instead.
export const load: PageLoad = async ({ fetch, parent }) => {
  const { did } = await parent();
  if (!did) return { defaultRemarkLicense: undefined };
  return { defaultRemarkLicense: await fetchDefaultRemarkLicense(fetch) };
};
