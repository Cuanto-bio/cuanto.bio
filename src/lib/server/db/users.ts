import sql from './index.js';

export async function insertUser(
  did: string,
  handle: string,
  avatarUrl?: string | null,
): Promise<void> {
  const normalizedHandle = handle.toLowerCase();
  await sql`
    INSERT INTO users (
      did,
      handle,
      avatar_url
    )
    VALUES (
      ${did},
      ${normalizedHandle},
      ${avatarUrl ?? null}
    )
    ON CONFLICT (did) DO UPDATE SET
      handle = EXCLUDED.handle,
      avatar_url = EXCLUDED.avatar_url
  `;
}
