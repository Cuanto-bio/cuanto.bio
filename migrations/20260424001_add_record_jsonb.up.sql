-- survey_protocols: add record JSONB, backfill, drop extracted columns
ALTER TABLE survey_protocols ADD COLUMN record JSONB;
UPDATE survey_protocols SET record = jsonb_build_object(
  '$type',         'bio.lexicons.temp.surveyProtocol',
  'title',         title,
  'description',   description,
  'createdAt',     to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
  'requiredFields', required_fields
);
ALTER TABLE survey_protocols ALTER COLUMN record SET NOT NULL;
ALTER TABLE survey_protocols
  DROP COLUMN title,
  DROP COLUMN description,
  DROP COLUMN required_fields,
  DROP COLUMN created_at;

-- survey_targets: add record JSONB, backfill from scope + protocol_uri, drop scope
ALTER TABLE survey_targets ADD COLUMN record JSONB;
UPDATE survey_targets SET record = jsonb_build_object(
  '$type',    'bio.lexicons.temp.surveyTarget',
  'protocol', protocol_uri,
  'scope',    scope
);
ALTER TABLE survey_targets ALTER COLUMN record SET NOT NULL;
ALTER TABLE survey_targets DROP COLUMN scope;

-- surveys: add record JSONB, backfill, drop extracted columns
-- event_date is retained as a native column for ORDER BY indexing
ALTER TABLE surveys ADD COLUMN record JSONB;
UPDATE surveys SET record = jsonb_strip_nulls(jsonb_build_object(
  '$type',             'bio.lexicons.temp.survey',
  'protocol',          jsonb_build_object('uri', protocol_uri, 'cid', protocol_cid),
  'createdAt',         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
  'eventDate',         CASE WHEN event_date IS NOT NULL
                       THEN to_char(event_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
                       ELSE NULL END,
  'eventDurationValue', event_duration_value,
  'eventDurationUnit',  event_duration_unit,
  'location',           location
));
ALTER TABLE surveys ALTER COLUMN record SET NOT NULL;
ALTER TABLE surveys
  DROP COLUMN protocol_cid,
  DROP COLUMN event_duration_value,
  DROP COLUMN event_duration_unit,
  DROP COLUMN location,
  DROP COLUMN created_at;

-- occurrences: add record JSONB, backfill, drop extracted columns
-- geom and survey_uri are retained for spatial queries and FK/filtering
ALTER TABLE occurrences ADD COLUMN record JSONB;
UPDATE occurrences SET record = jsonb_strip_nulls(jsonb_build_object(
  '$type',               'bio.lexicons.temp.occurrence',
  'eventID',             survey_uri,
  'surveyTargetID',      survey_target_uri,
  'taxonID',             taxon_id,
  'organismQuantity',    organism_quantity,
  'organismQuantityType', organism_quantity_type
));
ALTER TABLE occurrences ALTER COLUMN record SET NOT NULL;
ALTER TABLE occurrences
  DROP COLUMN survey_target_uri,
  DROP COLUMN taxon_id,
  DROP COLUMN organism_quantity,
  DROP COLUMN organism_quantity_type;
