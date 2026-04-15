import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ cookies }) => {
  cookies.delete('did', { path: '/' });
  redirect(302, '/');
};
