-- Stores when the surveyor's client observed that this target's source
-- protocolTarget was removed from the protocol, so the dwc-dp absence export
-- can stop gating notDetected rows to it after that point. NULL means "never
-- retired"; paired with created_at, this bounds a target's validity to the
-- half-open interval [created_at, retired_at).
ALTER TABLE survey_targets
  ADD COLUMN retired_at TIMESTAMPTZ;

CREATE INDEX survey_targets_retired_at_idx
  ON survey_targets (retired_at);
