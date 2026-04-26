import sql from '$lib/server/db';

export async function loadUserHandle(did: string | undefined): Promise<{
  did: string | undefined;
  handle: string | null;
  avatarUrl: string | null;
}> {
  let handle: string | null = null;
  let avatarUrl: string | null = null;
  if (did) {
    const [user] = await sql<{ handle: string; avatar_url: string | null }[]>`
      SELECT handle, avatar_url FROM users WHERE did = ${did}
    `;
    handle = user?.handle ?? null;
    avatarUrl = user?.avatar_url ?? null;
  }
  return { did, handle, avatarUrl };
}
