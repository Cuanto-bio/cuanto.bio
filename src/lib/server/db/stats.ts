import sql from './index.js';

export type StatsParams = {
  protocolUris: string[];
  start?: Date;
  end?: Date;
  bbox?: { north: number; south: number; east: number; west: number };
};

export type TaxonStat = {
  taxonId: string;
  scientificName: string | null;
  taxonRank: string | null;
  totalCount: number;
  surveyCount: number;
};

export type TargetStat = {
  protocolTargetUri: string;
  label: string | null;
  scopeType: 'taxon' | 'verbatim' | 'unknown';
  // Rank of the first scope, for rendering a single-taxon target the way taxa
  // are rendered elsewhere. Null unless scopeType is 'taxon'.
  taxonRank: string | null;
  // How many scopes the target ANDs together. Only a target with exactly one
  // names a single taxon; label and scopeType describe the first scope alone,
  // so without this a two-scope target would read as though it were that one.
  // 0 when the protocol target is missing or its scope is malformed, so this
  // is never null and callers can compare it without a guard.
  scopeCount: number;
  totalCount: number;
  surveyCount: number;
};

// Number of weekly bins in the sparkbar series.
export const SPARKBAR_WEEKS = 10;

export type WeeklyPoint = {
  // Monday of the bin, as YYYY-MM-DD in UTC.
  weekStart: string;
  // Mean organismQuantity per survey in which this thing was in scope. null
  // means no qualifying surveys that week: unknown, not zero. That distinction
  // is the whole point of the series, so consumers must not coalesce it to 0.
  mean: number | null;
  // The denominator: surveys that week where this thing was in scope. For
  // targets that means the surveyor had adopted the target and it was neither
  // unborn nor retired, i.e. a survey with no occurrence is a real
  // non-detection. For taxa there is no such notion, so it is every survey.
  surveyCount: number;
  totalCount: number;
};

export type StatsResult = {
  surveyCount: number;
  distinctTargetCount: number;
  totalIndividuals: number;
  taxa: TaxonStat[];
  targets: TargetStat[];
  // Keyed by protocolTarget URI. Includes targets that were sought but never
  // detected (an all-zero series), which `targets` above omits.
  targetWeekly: Record<string, WeeklyPoint[]>;
  // Keyed by taxonID.
  taxonWeekly: Record<string, WeeklyPoint[]>;
};

type ScalarRow = {
  survey_count: number;
  distinct_target_count: number;
  total_individuals: number | string;
};

type TaxonRow = {
  taxon_id: string;
  scientific_name: string | null;
  taxon_rank: string | null;
  total_count: number | string;
  survey_count: number;
};

type TargetRow = {
  protocol_target_uri: string;
  label: string | null;
  scope_type: 'taxon' | 'verbatim' | 'unknown';
  taxon_rank: string | null;
  scope_count: number;
  total_count: number | string;
  survey_count: number;
};

// One (series key, week) cell. Weeks with no qualifying surveys are simply
// absent rather than zero-valued; densifyWeekly turns those gaps into nulls.
type WeeklyRow = {
  series_key: string;
  week_start: string;
  survey_count: number;
  total_count: number | string;
};

// Monday 00:00:00 UTC of the week containing `d`. Weeks are bucketed in UTC on
// both sides (here and via `AT TIME ZONE 'UTC'` in SQL) so bin boundaries do
// not shift with the server's timezone.
export function startOfWeekUtc(d: Date): Date {
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  // getUTCDay is 0=Sunday..6=Saturday; ISO weeks start on Monday.
  out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7));
  return out;
}

// The SPARKBAR_WEEKS week-start keys ending with the week containing `anchor`,
// oldest first.
export function weekStartKeys(anchor: Date, weeks = SPARKBAR_WEEKS): string[] {
  const last = startOfWeekUtc(anchor);
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() - i * 7);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

// Expands sparse (series, week) rows into a dense, fixed-length series per key,
// so every sparkbar has the same number of bins and the same x scale.
export function densifyWeekly(
  rows: WeeklyRow[],
  weeks: string[],
): Record<string, WeeklyPoint[]> {
  const byKey = new Map<string, Map<string, WeeklyRow>>();
  for (const row of rows) {
    let series = byKey.get(row.series_key);
    if (!series) {
      series = new Map();
      byKey.set(row.series_key, series);
    }
    series.set(row.week_start, row);
  }

  const out: Record<string, WeeklyPoint[]> = {};
  for (const [key, series] of byKey) {
    out[key] = weeks.map((weekStart) => {
      const row = series.get(weekStart);
      if (!row || row.survey_count === 0) {
        return { weekStart, mean: null, surveyCount: 0, totalCount: 0 };
      }
      const totalCount = Number(row.total_count);
      return {
        weekStart,
        mean: totalCount / row.survey_count,
        surveyCount: row.survey_count,
        totalCount,
      };
    });
  }
  return out;
}

export async function getProtocolStats(
  params: StatsParams,
): Promise<StatsResult> {
  const startFilter = params.start
    ? sql`AND COALESCE(s.event_date, s.created_at) >= ${params.start}`
    : sql``;
  const endFilter = params.end
    ? sql`AND COALESCE(s.event_date, s.created_at) <= ${params.end}`
    : sql``;

  // When a bbox is active, restrict to surveys whose location falls within the envelope.
  const bboxEnvelope = params.bbox
    ? sql`ST_MakeEnvelope(
        ${params.bbox.west}, ${params.bbox.south},
        ${params.bbox.east}, ${params.bbox.north},
        4326
      )`
    : null;
  const bboxSurveyFilter = bboxEnvelope
    ? sql`AND ST_Within(s.geom, ${bboxEnvelope})`
    : sql``;

  // Anchor the series on the end of the filtered range rather than "now", so a
  // filter over a historical period still charts that period.
  const weeks = weekStartKeys(params.end ?? new Date());
  const firstWeekStart = new Date(`${weeks[0]}T00:00:00Z`);
  const lastWeekEnd = new Date(`${weeks[weeks.length - 1]}T00:00:00Z`);
  lastWeekEnd.setUTCDate(lastWeekEnd.getUTCDate() + 7);

  // Surveys in the charted window, tagged with their week. Shared by both
  // weekly queries below.
  const binnedSurveys = sql`
    binned AS (
      SELECT
        s.at_uri,
        s.did,
        s.protocol_uri,
        COALESCE(s.event_date, s.created_at) AS surveyed_at,
        to_char(
          date_trunc('week', COALESCE(s.event_date, s.created_at) AT TIME ZONE 'UTC'),
          'YYYY-MM-DD'
        ) AS week_start
      FROM surveys s
      WHERE s.protocol_uri = ANY(${`{${params.protocolUris.join(',')}}`}::text[])
        ${startFilter}
        ${endFilter}
        ${bboxSurveyFilter}
        AND COALESCE(s.event_date, s.created_at) >= ${firstWeekStart}
        AND COALESCE(s.event_date, s.created_at) < ${lastWeekEnd}
    )
  `;

  const organismQuantitySum = sql`
    SUM(
      CASE
        WHEN o.record->>'organismQuantity' ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (o.record->>'organismQuantity')::numeric
        ELSE 0
      END
    )::float8
  `;

  const [scalarRows, taxonRows, targetRows, targetWeeklyRows, taxonWeeklyRows] =
    await Promise.all([
      sql<ScalarRow[]>`
      WITH matching_surveys AS (
        SELECT s.at_uri, s.record
        FROM surveys s
        WHERE s.protocol_uri = ANY(${params.protocolUris})
          ${startFilter}
          ${endFilter}
          ${bboxSurveyFilter}
      ),
      survey_agg AS (
        SELECT COUNT(*)::int AS survey_count
        FROM matching_surveys
      ),
      occ_agg AS (
        SELECT
          COUNT(DISTINCT st.protocol_target_uri)::int                      AS distinct_target_count,
          COALESCE(SUM(
            CASE
              WHEN o.record->>'organismQuantity' ~ '^[0-9]+(\.[0-9]+)?$'
              THEN (o.record->>'organismQuantity')::numeric
              ELSE 0
            END
          ), 0)::float8                                                    AS total_individuals
        FROM matching_surveys ms
        JOIN occurrences o ON o.survey_uri = ms.at_uri
        JOIN survey_targets st ON st.at_uri = o.record->>'surveyTargetID'
      )
      SELECT
        sa.survey_count,
        oa.distinct_target_count,
        oa.total_individuals
      FROM survey_agg sa
      CROSS JOIN occ_agg oa
    `,
      sql<TaxonRow[]>`
      SELECT
        COALESCE(
          i.record->>'taxonID',
          o.record->>'taxonID',
          st.record->'scope'->0->>'taxonID'
        )                                                                   AS taxon_id,
        MIN(COALESCE(
          i.record->>'scientificName',
          pt.record->'scope'->0->>'scientificName'
        ))                                                                  AS scientific_name,
        MIN(COALESCE(
          i.record->>'taxonRank',
          pt.record->'scope'->0->>'taxonRank'
        ))                                                                  AS taxon_rank,
        SUM(
          CASE
            WHEN o.record->>'organismQuantity' ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (o.record->>'organismQuantity')::numeric
            ELSE 0
          END
        )::float8                                                           AS total_count,
        COUNT(DISTINCT o.survey_uri)::int                                  AS survey_count
      FROM surveys s
      JOIN occurrences o ON o.survey_uri = s.at_uri
      JOIN survey_targets st ON st.at_uri = o.record->>'surveyTargetID'
      LEFT JOIN protocol_targets pt ON pt.at_uri = st.protocol_target_uri
      LEFT JOIN identifications i
        ON i.occurrence_uri = o.at_uri
       AND i.at_uri = o.record->'acceptedIdentificationID'->>'uri'
      WHERE s.protocol_uri = ANY(${`{${params.protocolUris.join(',')}}`}::text[])
        ${startFilter}
        ${endFilter}
        ${bboxSurveyFilter}
        AND COALESCE(
          i.record->>'taxonID',
          o.record->>'taxonID',
          st.record->'scope'->0->>'taxonID'
        ) IS NOT NULL
      GROUP BY taxon_id
      ORDER BY total_count DESC
    `,
      sql<TargetRow[]>`
      SELECT
        st.protocol_target_uri,
        MIN(CASE
          WHEN pt.record->'scope'->0 ? 'verbatimTargetScope'
          THEN pt.record->'scope'->0->>'verbatimTargetScope'
          ELSE pt.record->'scope'->0->>'scientificName'
        END)                                                                AS label,
        MIN(CASE
          WHEN pt.record->'scope'->0 ? 'verbatimTargetScope' THEN 'verbatim'
          WHEN pt.record->'scope'->0 ? 'scientificName' THEN 'taxon'
          ELSE 'unknown'
        END)                                                                AS scope_type,
        MIN(pt.record->'scope'->0->>'taxonRank')                            AS taxon_rank,
        -- jsonb_array_length raises on a non-array rather than returning null,
        -- and this sits in an aggregate, so one malformed record off the
        -- firehose would abort the whole query and 500 the endpoint. Every
        -- other accessor here degrades quietly; this one has to as well.
        -- COALESCE covers both the malformed case and the LEFT JOIN miss, so
        -- the column is never null and 0 reads as "no scope to count".
        COALESCE(MIN(
          CASE
            WHEN jsonb_typeof(pt.record->'scope') = 'array'
            THEN jsonb_array_length(pt.record->'scope')
          END
        ), 0)::int                                                          AS scope_count,
        SUM(
          CASE
            WHEN o.record->>'organismQuantity' ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (o.record->>'organismQuantity')::numeric
            ELSE 0
          END
        )::float8                                                           AS total_count,
        COUNT(DISTINCT o.survey_uri)::int                                  AS survey_count
      FROM surveys s
      JOIN occurrences o ON o.survey_uri = s.at_uri
      JOIN survey_targets st ON st.at_uri = o.record->>'surveyTargetID'
      LEFT JOIN protocol_targets pt ON pt.at_uri = st.protocol_target_uri
      WHERE s.protocol_uri = ANY(${`{${params.protocolUris.join(',')}}`}::text[])
        ${startFilter}
        ${endFilter}
        ${bboxSurveyFilter}
        AND st.protocol_target_uri IS NOT NULL
      GROUP BY st.protocol_target_uri
      ORDER BY total_count DESC
    `,
      // Per-target weekly means. The denominator mirrors the non-detection rule
      // in streamAbsencesByProtocolUri: a survey counts for a target when that
      // surveyor had adopted it and it was neither unborn nor retired at survey
      // time. So a survey with no occurrence for the target is a true zero.
      sql<WeeklyRow[]>`
      WITH ${binnedSurveys},
      sought AS (
        SELECT
          st.protocol_target_uri,
          b.week_start,
          COUNT(DISTINCT b.at_uri)::int AS survey_count
        FROM binned b
        JOIN survey_targets st
          ON st.did = b.did
         AND st.protocol_uri = b.protocol_uri
         AND (st.created_at IS NULL OR st.created_at <= b.surveyed_at)
         AND (st.retired_at IS NULL OR b.surveyed_at < st.retired_at)
        GROUP BY st.protocol_target_uri, b.week_start
      ),
      counted AS (
        SELECT
          st.protocol_target_uri,
          b.week_start,
          ${organismQuantitySum} AS total_count
        FROM binned b
        JOIN occurrences o ON o.survey_uri = b.at_uri
        JOIN survey_targets st ON st.at_uri = o.record->>'surveyTargetID'
        GROUP BY st.protocol_target_uri, b.week_start
      )
      SELECT
        s.protocol_target_uri            AS series_key,
        s.week_start,
        s.survey_count,
        COALESCE(c.total_count, 0)::float8 AS total_count
      FROM sought s
      LEFT JOIN counted c
        ON c.protocol_target_uri = s.protocol_target_uri
       AND c.week_start = s.week_start
    `,
      // Per-taxon weekly means. There is no per-taxon notion of "was it sought"
      // the way there is for targets, so the denominator is every survey in the
      // week -- but only under protocols that have something to do with the
      // taxon. Otherwise selecting several protocols at once would let surveys
      // from an unrelated one (a fungus protocol, say) count against an oak and
      // silently drag its mean down. A protocol is relevant when it targets the
      // taxon (so its surveys are genuine non-detections) or when the taxon was
      // actually recorded under it (which covers taxa identified beneath a
      // broader target, where no target names the taxon directly).
      sql<WeeklyRow[]>`
      WITH ${binnedSurveys},
      counted AS (
        SELECT
          COALESCE(
            i.record->>'taxonID',
            o.record->>'taxonID',
            st.record->'scope'->0->>'taxonID'
          )                              AS taxon_id,
          b.protocol_uri,
          b.week_start,
          ${organismQuantitySum} AS total_count
        FROM binned b
        JOIN occurrences o ON o.survey_uri = b.at_uri
        JOIN survey_targets st ON st.at_uri = o.record->>'surveyTargetID'
        LEFT JOIN identifications i
          ON i.occurrence_uri = o.at_uri
         AND i.at_uri = o.record->'acceptedIdentificationID'->>'uri'
        WHERE COALESCE(
          i.record->>'taxonID',
          o.record->>'taxonID',
          st.record->'scope'->0->>'taxonID'
        ) IS NOT NULL
        GROUP BY taxon_id, b.protocol_uri, b.week_start
      ),
      taxon_protocols AS (
        SELECT DISTINCT taxon_id, protocol_uri FROM counted
        UNION
        SELECT DISTINCT
          pt.record->'scope'->0->>'taxonID' AS taxon_id,
          pt.protocol_uri
        FROM protocol_targets pt
        WHERE pt.protocol_uri = ANY(${`{${params.protocolUris.join(',')}}`}::text[])
          AND pt.record->'scope'->0->>'taxonID' IS NOT NULL
      ),
      -- Surveys per protocol-week, counted once. Joining binned surveys
      -- straight to taxa and grouping after would materialise
      -- surveys-in-window x taxa rows to produce the same handful of numbers
      -- per taxon: at 700 surveys and 200 taxa that is 140k rows, which the
      -- planner underestimates by ~1600x and then sorts on disk. Aggregating
      -- first keeps the intermediate at protocols x weeks.
      protocol_weeks AS (
        SELECT
          b.protocol_uri,
          b.week_start,
          COUNT(DISTINCT b.at_uri)::int AS survey_count
        FROM binned b
        GROUP BY b.protocol_uri, b.week_start
      ),
      week_surveys AS (
        SELECT
          tp.taxon_id,
          pw.week_start,
          -- SUM rather than another COUNT(DISTINCT): a survey has exactly one
          -- protocol_uri, so per-protocol counts cannot double count a survey
          -- for a taxon that several protocols target.
          SUM(pw.survey_count)::int AS survey_count
        FROM protocol_weeks pw
        JOIN taxon_protocols tp ON tp.protocol_uri = pw.protocol_uri
        GROUP BY tp.taxon_id, pw.week_start
      )
      SELECT
        w.taxon_id                       AS series_key,
        w.week_start,
        w.survey_count,
        COALESCE(SUM(c.total_count), 0)::float8 AS total_count
      FROM week_surveys w
      LEFT JOIN counted c
        ON c.taxon_id = w.taxon_id
       AND c.week_start = w.week_start
      GROUP BY w.taxon_id, w.week_start, w.survey_count
    `,
    ]);

  const scalar = scalarRows[0];
  return {
    surveyCount: scalar?.survey_count ?? 0,
    distinctTargetCount: scalar?.distinct_target_count ?? 0,
    totalIndividuals: Number(scalar?.total_individuals ?? 0),
    taxa: taxonRows.map((r) => ({
      taxonId: r.taxon_id,
      scientificName: r.scientific_name,
      taxonRank: r.taxon_rank,
      totalCount: Number(r.total_count),
      surveyCount: r.survey_count,
    })),
    targets: targetRows.map((r) => ({
      protocolTargetUri: r.protocol_target_uri,
      label: r.label,
      scopeType: r.scope_type,
      taxonRank: r.taxon_rank,
      scopeCount: r.scope_count,
      totalCount: Number(r.total_count),
      surveyCount: r.survey_count,
    })),
    targetWeekly: densifyWeekly(targetWeeklyRows, weeks),
    taxonWeekly: densifyWeekly(taxonWeeklyRows, weeks),
  };
}
