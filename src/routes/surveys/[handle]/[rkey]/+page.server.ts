import { error } from '@sveltejs/kit';
import sql from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface SurveyRow {
  at_uri: string;
  protocol_rkey: string;
  event_date: string | null;
  event_duration_value: number | null;
  event_duration_unit: string | null;
  location_name: string;
  protocol_title: string;
}

interface OccurrenceRow {
  at_uri: string;
  organism_quantity: string | null;
  scope: unknown[] | null;
}

export const load: PageServerLoad = async ({ params }) => {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
  `;
  if (!user) error(404, 'User not found');

  const [survey] = await sql<SurveyRow[]>`
    SELECT
      s.at_uri,
      sp.rkey AS protocol_rkey,
      s.event_date,
      s.event_duration_value,
      s.event_duration_unit,
      s.location->>'name' AS location_name,
      sp.title AS protocol_title
    FROM surveys s
    JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
    WHERE s.did = ${user.did} AND s.rkey = ${params.rkey}
    LIMIT 1
  `;
  if (!survey) error(404, 'Survey not found');

  const occurrences = await sql<OccurrenceRow[]>`
    SELECT
      o.at_uri,
      o.organism_quantity,
      st.scope
    FROM occurrences o
    LEFT JOIN survey_targets st ON st.at_uri = o.survey_target_uri
    WHERE o.survey_uri = ${survey.at_uri}
  `;

  return { survey, occurrences, handle: params.handle };
};
