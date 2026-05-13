CREATE TABLE identifications (
  at_uri         TEXT        PRIMARY KEY,
  did            TEXT        NOT NULL,
  rkey           TEXT        NOT NULL,
  occurrence_uri TEXT        NOT NULL REFERENCES occurrences(at_uri),
  record         JSONB       NOT NULL,
  indexed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX identifications_did_idx ON identifications (did);
CREATE INDEX identifications_occurrence_uri_idx ON identifications (occurrence_uri);
