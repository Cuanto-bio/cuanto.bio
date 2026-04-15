import sql from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface SurveyRow {
  at_uri: string;
  rkey: string;
  event_date: string | null;
  event_duration_value: number | null;
  event_duration_unit: string | null;
  location_name: string;
  protocol_title: string;
  handle: string;
  occurrence_count: number;
}

export const load: PageServerLoad = async () => {
  const surveys = await sql<SurveyRow[]>`
    SELECT
      s.at_uri,
      s.rkey,
      s.event_date,
      s.event_duration_value,
      s.event_duration_unit,
      s.location->>'name' AS location_name,
      sp.title AS protocol_title,
      u.handle,
      COUNT(o.id)::int AS occurrence_count
    FROM surveys s
    JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
    JOIN users u ON u.did = s.did
    LEFT JOIN occurrences o ON o.survey_uri = s.at_uri
    GROUP BY
      s.at_uri, s.rkey, s.event_date, s.event_duration_value,
      s.event_duration_unit, s.location, sp.title, u.handle, s.indexed_at
    ORDER BY s.event_date DESC NULLS LAST, s.indexed_at DESC
  `;

  return { surveys };
};
