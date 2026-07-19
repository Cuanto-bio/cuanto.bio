-- Tombstones a protocol_targets row instead of hard-deleting it, so
-- reconciliation (reconcileRetirements in materialize-targets.ts) can tell "the
-- author deleted this target" (deleted_at set) apart from "we haven't indexed
-- it yet" (no row at all), instead of inferring deletion from absence alone.
-- NULL means "not deleted" (the default, and the state of all existing rows).
ALTER TABLE protocol_targets
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX protocol_targets_deleted_at_idx
  ON protocol_targets (deleted_at);
