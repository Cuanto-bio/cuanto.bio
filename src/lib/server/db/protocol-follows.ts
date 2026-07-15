import { parseAtUri } from '$lib/atUri';
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

// Re-points an existing follow's protocol_uri while preserving its at_uri. Used
// by the lexicon migration, where a follow keeps its record (and at_uri) but its
// subject moves to the protocol's new NSID. Keyed on at_uri (not the
// did+protocol_uri pair createFollow conflicts on) because the protocol_uri is
// precisely what changes; upserts so a missing index row is created.
export async function reindexFollowSubject(
  atUri: string,
  protocolUri: string,
): Promise<void> {
  const { did, rkey } = parseAtUri(atUri);
  await sql`
    INSERT INTO protocol_follows (at_uri, did, rkey, protocol_uri, created_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${protocolUri}, now())
    ON CONFLICT ON CONSTRAINT protocol_follows_at_uri_key
      DO UPDATE SET protocol_uri = EXCLUDED.protocol_uri
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

export interface FollowerPreview {
  handle: string;
  avatarUrl: string | null;
}

// The most-recent handful of followers, for the "Followed by …" social-proof
// line. `excludeDid` drops the viewer so the line reads as other people who
// follow this protocol; pass it undefined for the signed-out public page
// where there is no viewer.
export async function getProtocolFollowerPreview(
  protocolUri: string,
  limit = 3,
  excludeDid?: string,
): Promise<FollowerPreview[]> {
  const rows = await sql<{ handle: string; avatar_url: string | null }[]>`
    SELECT u.handle, u.avatar_url
    FROM protocol_follows pf
    JOIN users u ON u.did = pf.did
    WHERE pf.protocol_uri = ${protocolUri}
      ${excludeDid ? sql`AND pf.did <> ${excludeDid}` : sql``}
    ORDER BY pf.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ handle: r.handle, avatarUrl: r.avatar_url }));
}
