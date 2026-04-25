import { json } from '@sveltejs/kit';
import { getClient } from '$lib/server/auth';

export const GET = async () => json((await getClient()).jwks);
