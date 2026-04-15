import sql from './db.js';

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
    -- Handle changes on the PDS are not reflected here; this is a known
    -- tradeoff in favour of simplicity. Re-resolving stale handles is a
    -- future concern.
    ON CONFLICT (did) DO NOTHING
  `;
}
