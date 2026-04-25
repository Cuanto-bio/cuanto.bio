-- occurrences: restore extracted columns from record, drop record
ALTER TABLE occurrences
  ADD COLUMN survey_target_uri      TEXT,
  ADD COLUMN taxon_id               TEXT,
  ADD COLUMN organism_quantity      TEXT,
  ADD COLUMN organism_quantity_type TEXT;
UPDATE occurrences SET
  survey_target_uri      = record->>'surveyTargetID',
  taxon_id               = record->>'taxonID',
  organism_quantity      = record->>'organismQuantity',
  organism_quantity_type = record->>'organismQuantityType';
ALTER TABLE occurrences DROP COLUMN record;

-- surveys: restore extracted columns from record, drop record
ALTER TABLE surveys
  ADD COLUMN protocol_cid          TEXT,
  ADD COLUMN event_duration_value  INTEGER,
  ADD COLUMN event_duration_unit   TEXT,
  ADD COLUMN location              JSONB,
  ADD COLUMN created_at            TIMESTAMPTZ;
UPDATE surveys SET
  protocol_cid         = record->'protocol'->>'cid',
  event_duration_value = (record->>'eventDurationValue')::INTEGER,
  event_duration_unit  = record->>'eventDurationUnit',
  location             = record->'location',
  created_at           = (record->>'createdAt')::TIMESTAMPTZ;
ALTER TABLE surveys
  ALTER COLUMN protocol_cid SET NOT NULL,
  ALTER COLUMN location SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE surveys DROP COLUMN record;

-- survey_targets: restore scope from record, drop record
ALTER TABLE survey_targets ADD COLUMN scope JSONB;
UPDATE survey_targets SET scope = record->'scope';
ALTER TABLE survey_targets ALTER COLUMN scope SET NOT NULL;
ALTER TABLE survey_targets DROP COLUMN record;

-- survey_protocols: restore extracted columns from record, drop record
ALTER TABLE survey_protocols
  ADD COLUMN title         TEXT,
  ADD COLUMN description   TEXT,
  ADD COLUMN required_fields TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN created_at    TIMESTAMPTZ;
UPDATE survey_protocols SET
  title          = record->>'title',
  description    = record->>'description',
  required_fields = ARRAY(SELECT jsonb_array_elements_text(record->'requiredFields')),
  created_at     = (record->>'createdAt')::TIMESTAMPTZ;
ALTER TABLE survey_protocols
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN description SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE survey_protocols DROP COLUMN record;
