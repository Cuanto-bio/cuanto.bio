import { json } from '@sveltejs/kit';
import { client } from '$lib/server/auth';

export const GET = () => json(client.clientMetadata);
