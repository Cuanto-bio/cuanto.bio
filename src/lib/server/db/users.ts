import sql from './index.js';

export async function insertUser(did: string, handle: string): Promise<void> {
  const normalizedHandle = handle.toLowerCase();
  await sql`
    INSERT INTO users (
      did,
      handle
    )
    VALUES (
      ${did},
      ${normalizedHandle}
    )
    ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
  `;
}
