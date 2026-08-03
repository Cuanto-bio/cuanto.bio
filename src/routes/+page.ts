import { fillUserFromCache } from '$lib/auth/fillUserFromCache';
import type { PageLoad } from './$types';

// +page.server.ts resolves the user from the `did` cookie (web). The native
// wrapper has no cookie, so fill the user in from the client cache there.
export const load: PageLoad = async ({ data }) => fillUserFromCache(data);
