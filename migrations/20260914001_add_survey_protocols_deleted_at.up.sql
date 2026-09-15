-- Tombstones a survey_protocols row instead of hard-deleting it. The row must
-- survive deletion: surveys.protocol_uri and occurrences (via surveys) both
-- reach it through ON DELETE CASCADE foreign keys, so a hard delete would
-- silently wipe every survey and occurrence ever recorded under the protocol
-- (issue #25). NULL means "not deleted" (the default, and the state of all
-- existing rows).
ALTER TABLE survey_protocols
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX survey_protocols_deleted_at_idx
  ON survey_protocols (deleted_at);
