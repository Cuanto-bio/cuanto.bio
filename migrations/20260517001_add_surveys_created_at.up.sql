ALTER TABLE surveys ADD COLUMN created_at TIMESTAMPTZ;
UPDATE surveys SET created_at = (record->>'createdAt')::timestamptz;
ALTER TABLE surveys ALTER COLUMN created_at SET NOT NULL;
CREATE INDEX surveys_created_at_idx ON surveys (created_at DESC);
