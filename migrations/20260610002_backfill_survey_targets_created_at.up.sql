-- Best-effort backfill for survey_targets rows that predate the createdAt field.
-- Uses indexed_at as a per-target proxy for when the target was materialized:
-- targets added to the protocol later have a later indexed_at, so the temporal
-- gate in the absence query stays accurate per-target rather than backdating
-- everything to the protocol follow date.
UPDATE survey_targets
  SET created_at = indexed_at
  WHERE created_at IS NULL;
