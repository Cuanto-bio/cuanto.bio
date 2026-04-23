import sql from '$lib/server/db';

export async function loadUserHandle(
  did: string | undefined,
): Promise<{ did: string | undefined; handle: string | null }> {
  let handle: string | null = null;
  if (did) {
    const [user] = await sql<{ handle: string }[]>`
      SELECT handle FROM users WHERE did = ${did}
    `;
    handle = user?.handle ?? null;
  }
  return { did, handle };
}
