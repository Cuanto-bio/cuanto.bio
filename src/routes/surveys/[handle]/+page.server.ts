import { error } from '@sveltejs/kit';
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
  occurrence_count: number;
}

export const load: PageServerLoad = async ({ params }) => {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
  `;
  if (!user) error(404, 'User not found');

  const surveys = await sql<SurveyRow[]>`
    SELECT
      s.at_uri,
      s.rkey,
      s.event_date,
      s.event_duration_value,
      s.event_duration_unit,
      s.location->>'name' AS location_name,
      sp.title AS protocol_title,
      COUNT(o.id)::int AS occurrence_count
    FROM surveys s
    JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
    LEFT JOIN occurrences o ON o.survey_uri = s.at_uri
    WHERE s.did = ${user.did}
    GROUP BY
      s.at_uri, s.rkey, s.event_date, s.event_duration_value,
      s.event_duration_unit, s.location, sp.title, s.indexed_at
    ORDER BY s.event_date DESC NULLS LAST, s.indexed_at DESC
  `;

  return { surveys, handle: params.handle };
};
