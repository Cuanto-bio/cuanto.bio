import { redirect } from '@sveltejs/kit';
import { client } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request }) => {
    const data = await request.formData();

    // Get the user's PDS authorization URL and send them there
    const handle = data.get('handle') as string;
    const url = await client.authorize(handle);
    redirect(302, url.toString());
  },
};
