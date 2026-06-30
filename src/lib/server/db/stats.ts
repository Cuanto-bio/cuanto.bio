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
  totalCount: number;
  surveyCount: number;
};

export type StatsResult = {
  surveyCount: number;
  distinctTargetCount: number;
  totalIndividuals: number;
  taxa: TaxonStat[];
  targets: TargetStat[];
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
  total_count: number | string;
  survey_count: number;
};

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

  const [scalarRows, taxonRows, targetRows] = await Promise.all([
    sql<ScalarRow[]>`
      WITH matching_surveys AS (
        SELECT s.at_uri, s.record
        FROM surveys s
        WHERE s.protocol_uri = ANY(${sql.array(params.protocolUris)})
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
      totalCount: Number(r.total_count),
      surveyCount: r.survey_count,
    })),
  };
}
