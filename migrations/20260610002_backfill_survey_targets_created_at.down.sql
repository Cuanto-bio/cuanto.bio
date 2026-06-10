-- Cannot recover original NULL values; reset all rows that lack a record-level
-- createdAt (i.e. rows backfilled from indexed_at rather than set from a real
-- surveyTarget record).
UPDATE survey_targets
  SET created_at = NULL
  WHERE record->>'createdAt' IS NULL;
