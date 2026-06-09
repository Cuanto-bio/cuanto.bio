// Flags users who still have records under the pre-bio.cuanto.* lexicon NSIDs,
// so the migration banner appears for them. Read-only against each PDS; writes
// only the users.needs_lexicon_migration flag. Run after deploying PR1+PR2+PR3:
//   pnpm stamp-lexicon-migration
import { IdResolver } from '@atproto/identity';
import postgres from 'postgres';

const OLD_COLLECTIONS = [
  'bio.lexicons.temp.v0-1.surveyProtocol',
  'bio.lexicons.temp.v0-1.surveyTarget',
  'bio.lexicons.temp.v0-1.survey',
];

const idResolver = new IdResolver();

async function hasRecords(
  did: string,
  collection: string,
  pdsUrl: string,
): Promise<boolean> {
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', collection);
  url.searchParams.set('limit', '1');
  const resp = await fetch(url);
  if (!resp.ok) return false;
  const body = (await resp.json()) as { records: unknown[] };
  return body.records.length > 0;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }
  const sql = postgres(dbUrl);
  try {
    const sessions = await sql<
      { key: string }[]
    >`SELECT key FROM oauth_sessions`;
    let flagged = 0;
    for (const { key: did } of sessions) {
      let pdsUrl: string;
      try {
        pdsUrl = (await idResolver.did.resolveAtprotoData(did)).pds;
      } catch (err) {
        console.warn(`Skipping ${did}: could not resolve PDS (${String(err)})`);
        continue;
      }
      let stale = false;
      for (const collection of OLD_COLLECTIONS) {
        if (await hasRecords(did, collection, pdsUrl)) {
          stale = true;
          break;
        }
      }
      if (stale) {
        await sql`UPDATE users SET needs_lexicon_migration = true WHERE did = ${did}`;
        flagged++;
        console.log(`Flagged ${did}`);
      }
    }
    console.log(`Done. Flagged ${flagged} of ${sessions.length} session(s).`);
  } finally {
    await sql.end();
  }
}

main();
