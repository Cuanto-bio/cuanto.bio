-- Tombstones a survey_targets row instead of hard-deleting it when the
-- surveyor's bio.cuanto.surveyTarget record is deleted on their PDS, which any
-- AT Protocol client with write access to their repo can do (issue #41). The row
-- is what the occurrence export joins through
-- (o.record->>'surveyTargetID' = st.at_uri), so removing it silently drops real,
-- already-recorded detections from the export; the row is also what remembers
-- the original adoption time when materializeSurveyTargets recreates the record,
-- which otherwise resets created_at to "now" and retroactively suppresses the
-- notDetected rows of every survey conducted before the deletion.
--
-- NULL means "not deleted" (the default, and the state of all existing rows).
-- Only created_at and retired_at bound a target's validity: deleted_at never
-- gates absences, because it is transient (the next reconciliation clears it)
-- and an export must not change depending on when it is run.
ALTER TABLE survey_targets
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX survey_targets_deleted_at_idx
  ON survey_targets (deleted_at);
