// Backfills survey data from PDS repos into the local index. tap only streams
// new events, so a dev database that was offline (or never had tap enabled)
// stays missing everything written in the meantime; this pulls it from the
// source of truth instead.
//
//   pnpm backfill-surveys                 # every DID in the users table
//   pnpm backfill-surveys did:plc:abc123  # just that repo
//
// Records are written in FK order: surveys and surveyTargets, then occurrences,
// then identifications. surveys.protocol_uri references survey_protocols, so a
// survey whose protocol is not indexed locally is skipped and counted; run
// `pnpm reindex-protocol <protocol-uri>` for those and re-run.
//
// NOTE: the INSERTs here duplicate insertSurvey/insertSurveyTarget/
// insertOccurrence/insertIdentification in src/lib/server/db/. Those import
// $env/dynamic/private (a SvelteKit virtual module) and so cannot be loaded by
// tsx, which is why every script in this directory opens its own connection.
// The webhook path remains the source of truth; if a column is added there, add
// it here too.
import { IdResolver } from '@atproto/identity';
import postgres, { type Sql } from 'postgres';

const SURVEY_NSID = 'bio.cuanto.survey';
const SURVEY_TARGET_NSID = 'bio.cuanto.surveyTarget';
const OCCURRENCE_NSID = 'bio.lexicons.temp.v0-1.occurrence';
const IDENTIFICATION_NSID = 'bio.lexicons.temp.v0-1.identification';

interface AtRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

const idResolver = new IdResolver();

function parseAtUri(uri: string): { did: string; rkey: string } {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) throw new Error(`Invalid AT-URI: ${uri}`);
  return { did: match[1], rkey: match[3] };
}

function parseCoords(
  lat: unknown,
  lon: unknown,
): { lat: number; lon: number } | null {
  if (typeof lat !== 'string' || typeof lon !== 'string') return null;
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;
  return { lat: latNum, lon: lonNum };
}

// Mirrors extractSurveyCoords in src/lib/server/db/surveys.ts.
function extractSurveyCoords(
  record: Record<string, unknown>,
): { lat: number; lon: number } | null {
  const location = record.location as Record<string, unknown> | undefined;
  const locations = location?.locations as
    | Record<string, unknown>[]
    | undefined;
  if (!locations) return null;
  for (const loc of locations) {
    if ('latitude' in loc && 'longitude' in loc) {
      return parseCoords(loc.latitude, loc.longitude);
    }
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function listAtRecords(
  did: string,
  collection: string,
  pdsUrl: string,
): Promise<AtRecord[]> {
  const all: AtRecord[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set('repo', did);
    url.searchParams.set('collection', collection);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const resp = await fetch(url);
    // A repo with no records of a collection 400s rather than returning an
    // empty list, which is not an error worth aborting the whole backfill for.
    if (resp.status === 400) return all;
    if (!resp.ok) {
      throw new Error(
        `Failed to list ${collection} for ${did}: ${resp.status}`,
      );
    }
    const body = (await resp.json()) as {
      records: AtRecord[];
      cursor?: string;
    };
    all.push(...body.records);
    cursor = body.cursor;
  } while (cursor);

  return all;
}

type Counts = {
  surveys: number;
  surveyTargets: number;
  occurrences: number;
  identifications: number;
  skippedNoProtocol: number;
  skippedNoSurvey: number;
  skippedNoOccurrence: number;
};

// Distinct protocol URIs that surveys referenced but that are not indexed
// locally, so the summary can name them rather than just count them.
const missingProtocols = new Set<string>();

// A repo listing should never repeat a URI, but ON CONFLICT DO UPDATE aborts
// the whole statement if one does ("cannot affect row a second time"), where
// the previous row-at-a-time loop would simply have upserted twice. Last write
// wins, matching the loop's behaviour.
function dedupeByUri<T extends { at_uri: string }>(rows: T[]): T[] {
  const byUri = new Map<string, T>();
  for (const row of rows) byUri.set(row.at_uri, row);
  return [...byUri.values()];
}

// Which of the given URIs the index already holds. Scoped to the URIs the
// records in hand actually reference: the unfiltered `SELECT at_uri FROM <t>`
// this replaces pulled every row of the table into memory, and did so once per
// DID, so a run over N users read the whole occurrences table N times.
// Undefined entries are dropped, so callers can pass a raw `.map()` of an
// optional field.
async function knownUris(
  sql: Sql,
  table: 'survey_protocols' | 'surveys' | 'occurrences',
  uris: (string | undefined)[],
): Promise<Set<string>> {
  const wanted = [...new Set(uris.filter((u): u is string => Boolean(u)))];
  if (wanted.length === 0) return new Set();
  const rows = await sql<{ at_uri: string }[]>`
    SELECT at_uri FROM ${sql(table)} WHERE at_uri = ANY(${wanted}::text[])
  `;
  return new Set(rows.map((r) => r.at_uri));
}

async function backfillDid(sql: Sql, did: string): Promise<Counts> {
  const counts: Counts = {
    surveys: 0,
    surveyTargets: 0,
    occurrences: 0,
    identifications: 0,
    skippedNoProtocol: 0,
    skippedNoSurvey: 0,
    skippedNoOccurrence: 0,
  };

  const atProtoData = await idResolver.did.resolveAtprotoData(did);
  const pdsUrl = atProtoData.pds;

  const [surveys, surveyTargets, occurrences, identifications] =
    await Promise.all([
      listAtRecords(did, SURVEY_NSID, pdsUrl),
      listAtRecords(did, SURVEY_TARGET_NSID, pdsUrl),
      listAtRecords(did, OCCURRENCE_NSID, pdsUrl),
      listAtRecords(did, IDENTIFICATION_NSID, pdsUrl),
    ]);

  // Which protocols this index already knows about; surveys referencing
  // anything else would violate surveys_protocol_uri_fkey.
  const knownProtocols = await knownUris(
    sql,
    'survey_protocols',
    surveys.map(
      (rec) => (rec.value.protocol as { uri?: string } | undefined)?.uri,
    ),
  );

  // Rows are gathered and written in one statement per table rather than one
  // per record. A repo with 10k occurrences previously paid 10k sequential
  // round-trips, each waiting a full network latency, for work with no
  // cross-record dependency.
  const surveyRows = dedupeByUri(
    surveys.flatMap((rec) => {
      const record = rec.value;
      const protocolUri = (record.protocol as { uri?: string } | undefined)
        ?.uri;
      if (!protocolUri || !knownProtocols.has(protocolUri)) {
        counts.skippedNoProtocol++;
        if (protocolUri) missingProtocols.add(protocolUri);
        return [];
      }
      const coords = extractSurveyCoords(record);
      return [
        {
          at_uri: rec.uri,
          rkey: parseAtUri(rec.uri).rkey,
          protocol_uri: protocolUri,
          // Timestamps travel as text and are cast per element below: a JS
          // Date[] parameter is inferred as a scalar timestamptz, and the
          // array cast then fails.
          event_date: parseDate(record.eventDate)?.toISOString() ?? null,
          created_at: (parseDate(record.createdAt) ?? new Date()).toISOString(),
          record: JSON.stringify(record),
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
        },
      ];
    }),
  );

  if (surveyRows.length > 0) {
    await sql`
      INSERT INTO surveys (at_uri, did, rkey, protocol_uri, event_date, created_at, record, geom, indexed_at)
      SELECT
        u.at_uri, ${did}, u.rkey, u.protocol_uri,
        u.event_date::timestamptz, u.created_at::timestamptz, u.record::jsonb,
        CASE
          WHEN u.lat IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(u.lon, u.lat), 4326)
        END,
        now()
      FROM UNNEST(
        ${surveyRows.map((r) => r.at_uri)}::text[],
        ${surveyRows.map((r) => r.rkey)}::text[],
        ${surveyRows.map((r) => r.protocol_uri)}::text[],
        ${surveyRows.map((r) => r.event_date)}::text[],
        ${surveyRows.map((r) => r.created_at)}::text[],
        ${surveyRows.map((r) => r.record)}::text[],
        ${surveyRows.map((r) => r.lat)}::float8[],
        ${surveyRows.map((r) => r.lon)}::float8[]
      ) AS u(at_uri, rkey, protocol_uri, event_date, created_at, record, lat, lon)
      ON CONFLICT (at_uri) DO UPDATE SET
        protocol_uri = EXCLUDED.protocol_uri,
        event_date = EXCLUDED.event_date,
        created_at = EXCLUDED.created_at,
        record = EXCLUDED.record,
        geom = EXCLUDED.geom
    `;
    counts.surveys += surveyRows.length;
  }

  const targetRows = dedupeByUri(
    surveyTargets.flatMap((rec) => {
      const record = rec.value;
      const protocolUri = record.protocol as string | undefined;
      const protocolTargetUri = record.protocolTargetID as string | undefined;
      if (!protocolUri || !protocolTargetUri) return [];
      return [
        {
          at_uri: rec.uri,
          rkey: parseAtUri(rec.uri).rkey,
          protocol_uri: protocolUri,
          protocol_target_uri: protocolTargetUri,
          record: JSON.stringify(record),
          created_at: parseDate(record.createdAt)?.toISOString() ?? null,
          retired_at: parseDate(record.retiredAt)?.toISOString() ?? null,
        },
      ];
    }),
  );

  if (targetRows.length > 0) {
    // rev is left NULL: there is no firehose commit behind a backfill, and a
    // NULL rev always applies, matching materializeSurveyTargets. The guard on
    // DO UPDATE is unchanged from the row-at-a-time form.
    await sql`
      INSERT INTO survey_targets (
        at_uri, did, rkey, protocol_uri, protocol_target_uri, record,
        indexed_at, created_at, retired_at, rev
      )
      SELECT
        u.at_uri, ${did}, u.rkey, u.protocol_uri, u.protocol_target_uri,
        u.record::jsonb, now(),
        u.created_at::timestamptz, u.retired_at::timestamptz, NULL
      FROM UNNEST(
        ${targetRows.map((r) => r.at_uri)}::text[],
        ${targetRows.map((r) => r.rkey)}::text[],
        ${targetRows.map((r) => r.protocol_uri)}::text[],
        ${targetRows.map((r) => r.protocol_target_uri)}::text[],
        ${targetRows.map((r) => r.record)}::text[],
        ${targetRows.map((r) => r.created_at)}::text[],
        ${targetRows.map((r) => r.retired_at)}::text[]
      ) AS u(
        at_uri, rkey, protocol_uri, protocol_target_uri, record,
        created_at, retired_at
      )
      ON CONFLICT (at_uri) DO UPDATE SET
        protocol_uri = EXCLUDED.protocol_uri,
        protocol_target_uri = EXCLUDED.protocol_target_uri,
        record = EXCLUDED.record,
        created_at = EXCLUDED.created_at,
        retired_at = EXCLUDED.retired_at,
        rev = EXCLUDED.rev
      WHERE EXCLUDED.rev IS NULL
         OR survey_targets.rev IS NULL
         OR EXCLUDED.rev > survey_targets.rev
    `;
    counts.surveyTargets += targetRows.length;
  }

  // Read after the survey inserts above, so surveys written by this same run
  // count as known.
  const knownSurveys = await knownUris(
    sql,
    'surveys',
    occurrences.map((rec) => rec.value.eventID as string | undefined),
  );

  const occurrenceRows = dedupeByUri(
    occurrences.flatMap((rec) => {
      const record = rec.value;
      const surveyUri = record.eventID as string | undefined;
      if (!surveyUri || !knownSurveys.has(surveyUri)) {
        counts.skippedNoSurvey++;
        return [];
      }
      const coords = parseCoords(
        record.decimalLatitude,
        record.decimalLongitude,
      );
      return [
        {
          at_uri: rec.uri,
          rkey: parseAtUri(rec.uri).rkey,
          survey_uri: surveyUri,
          record: JSON.stringify(record),
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
        },
      ];
    }),
  );

  if (occurrenceRows.length > 0) {
    await sql`
      INSERT INTO occurrences (at_uri, did, rkey, survey_uri, record, geom, indexed_at)
      SELECT
        u.at_uri, ${did}, u.rkey, u.survey_uri, u.record::jsonb,
        CASE
          WHEN u.lat IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(u.lon, u.lat), 4326)
        END,
        now()
      FROM UNNEST(
        ${occurrenceRows.map((r) => r.at_uri)}::text[],
        ${occurrenceRows.map((r) => r.rkey)}::text[],
        ${occurrenceRows.map((r) => r.survey_uri)}::text[],
        ${occurrenceRows.map((r) => r.record)}::text[],
        ${occurrenceRows.map((r) => r.lat)}::float8[],
        ${occurrenceRows.map((r) => r.lon)}::float8[]
      ) AS u(at_uri, rkey, survey_uri, record, lat, lon)
      ON CONFLICT (at_uri) DO UPDATE SET
        survey_uri = EXCLUDED.survey_uri,
        record = EXCLUDED.record,
        geom = EXCLUDED.geom
    `;
    counts.occurrences += occurrenceRows.length;
  }

  const knownOccurrences = await knownUris(
    sql,
    'occurrences',
    identifications.map(
      (rec) => (rec.value.occurrence as { uri?: string } | undefined)?.uri,
    ),
  );

  const identificationRows = dedupeByUri(
    identifications.flatMap((rec) => {
      const record = rec.value;
      const occurrenceUri = (record.occurrence as { uri?: string } | undefined)
        ?.uri;
      if (!occurrenceUri || !knownOccurrences.has(occurrenceUri)) {
        counts.skippedNoOccurrence++;
        return [];
      }
      return [
        {
          at_uri: rec.uri,
          rkey: parseAtUri(rec.uri).rkey,
          occurrence_uri: occurrenceUri,
          record: JSON.stringify(record),
        },
      ];
    }),
  );

  if (identificationRows.length > 0) {
    await sql`
      INSERT INTO identifications (at_uri, did, rkey, occurrence_uri, record, indexed_at)
      SELECT u.at_uri, ${did}, u.rkey, u.occurrence_uri, u.record::jsonb, now()
      FROM UNNEST(
        ${identificationRows.map((r) => r.at_uri)}::text[],
        ${identificationRows.map((r) => r.rkey)}::text[],
        ${identificationRows.map((r) => r.occurrence_uri)}::text[],
        ${identificationRows.map((r) => r.record)}::text[]
      ) AS u(at_uri, rkey, occurrence_uri, record)
      ON CONFLICT (at_uri) DO UPDATE SET
        record = EXCLUDED.record
    `;
    counts.identifications += identificationRows.length;
  }

  return counts;
}

async function main() {
  const argDid = process.argv[2];

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const sql = postgres(dbUrl);
  try {
    const dids = argDid
      ? [argDid]
      : (await sql<{ did: string }[]>`SELECT did FROM users ORDER BY did`).map(
          (r) => r.did,
        );

    if (dids.length === 0) {
      console.log('No DIDs to backfill.');
      return;
    }
    console.log(`Backfilling ${dids.length} repo(s)...`);

    const totals: Counts = {
      surveys: 0,
      surveyTargets: 0,
      occurrences: 0,
      identifications: 0,
      skippedNoProtocol: 0,
      skippedNoSurvey: 0,
      skippedNoOccurrence: 0,
    };

    for (const did of dids) {
      try {
        const counts = await backfillDid(sql, did);
        for (const key of Object.keys(totals) as (keyof Counts)[]) {
          totals[key] += counts[key];
        }
        console.log(
          `  ${did}: ${counts.surveys} survey(s), ${counts.surveyTargets} target(s), ` +
            `${counts.occurrences} occurrence(s), ${counts.identifications} identification(s)`,
        );
      } catch (err) {
        // One unreachable PDS should not abandon the remaining repos.
        console.error(`  ${did}: FAILED — ${(err as Error).message}`);
      }
    }

    console.log(
      `\nIndexed ${totals.surveys} survey(s), ${totals.surveyTargets} surveyTarget(s), ` +
        `${totals.occurrences} occurrence(s), ${totals.identifications} identification(s).`,
    );
    if (totals.skippedNoProtocol > 0) {
      console.log(
        `\nSkipped ${totals.skippedNoProtocol} survey(s) under ${missingProtocols.size} ` +
          'protocol(s) that are not indexed locally. Reindex them, then re-run this:',
      );
      for (const uri of missingProtocols) {
        console.log(`  pnpm reindex-protocol ${uri}`);
      }
    }
    if (totals.skippedNoSurvey > 0) {
      console.log(
        `Skipped ${totals.skippedNoSurvey} occurrence(s) with no indexed survey.`,
      );
    }
    if (totals.skippedNoOccurrence > 0) {
      console.log(
        `Skipped ${totals.skippedNoOccurrence} identification(s) with no indexed occurrence.`,
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
