import { error, json } from '@sveltejs/kit';
import { searchProtocols } from '$lib/server/db/survey-protocols';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (!q) error(422, 'q parameter is required');
  const results = await searchProtocols(q, 10);
  return json({ results });
};
