-- Stores the protocolTarget's createdAt so the dwc-dp absence export can
-- gate notDetected rows to targets that existed when the survey was conducted.
-- NULL means "unknown birth time" (existing rows, pre-migration); the absence
-- query treats NULL as "always existed" so no historical notDetected rows are
-- suppressed.
ALTER TABLE survey_targets
  ADD COLUMN created_at TIMESTAMPTZ;

CREATE INDEX survey_targets_created_at_idx
  ON survey_targets (created_at);
