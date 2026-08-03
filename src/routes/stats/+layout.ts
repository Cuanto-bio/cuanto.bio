import { fillUserFromCache } from '$lib/auth/fillUserFromCache';
import type { LayoutLoad } from './$types';

// +layout.server.ts resolves the user from the `did` cookie (web). The native
// wrapper has no cookie, so fill the user in from the client cache there.
export const load: LayoutLoad = async ({ data }) => fillUserFromCache(data);
