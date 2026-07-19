-- Stores the repo commit revision (from the tap firehose event) that produced
-- the current row, so an out-of-order or replayed webhook event can't clobber a
-- newer state (e.g. retired_at) with an older one: insertSurveyTarget only
-- applies an upsert carrying a rev when that rev is newer than what's stored.
-- NULL means "written by our own app code, not a firehose replay" (e.g.
-- materializeSurveyTargets' own record writes) or "predates this column";
-- those upserts always apply, matching prior behavior.
ALTER TABLE survey_targets
  ADD COLUMN rev TEXT;
