import sql from './index.js';

export interface ProtocolFollow {
  id: number;
  at_uri: string;
  did: string;
  rkey: string;
  protocol_uri: string;
  created_at: string;
  indexed_at: string;
}

export interface FollowWithProtocol extends ProtocolFollow {
  protocol_title: string;
  protocol_description: string;
  protocol_rkey: string;
  handle: string;
}

export async function createFollow(follow: {
  atUri: string;
  did: string;
  rkey: string;
  protocolUri: string;
  createdAt: string;
}): Promise<void> {
  await sql`
    INSERT INTO protocol_follows (at_uri, did, rkey, protocol_uri, created_at)
    VALUES (
      ${follow.atUri},
      ${follow.did},
      ${follow.rkey},
      ${follow.protocolUri},
      ${follow.createdAt}
    )
    ON CONFLICT ON CONSTRAINT uq_follow_did_protocol
      DO UPDATE SET at_uri = EXCLUDED.at_uri, rkey = EXCLUDED.rkey,
                    created_at = EXCLUDED.created_at
  `;
}

export async function deleteFollow(atUri: string): Promise<void> {
  await sql`DELETE FROM protocol_follows WHERE at_uri = ${atUri}`;
}

export async function getFollowByDidAndProtocol(
  did: string,
  protocolUri: string,
): Promise<ProtocolFollow | null> {
  const [row] = await sql<ProtocolFollow[]>`
    SELECT * FROM protocol_follows
    WHERE did = ${did} AND protocol_uri = ${protocolUri}
    LIMIT 1
  `;
  return row ?? null;
}

export async function getFollowerCount(protocolUri: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM protocol_follows
    WHERE protocol_uri = ${protocolUri}
  `;
  return row?.count ?? 0;
}
