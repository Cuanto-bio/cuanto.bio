CREATE TABLE survey_protocols (
  id              BIGSERIAL    PRIMARY KEY,
  at_uri          TEXT         NOT NULL UNIQUE,
  did             TEXT         NOT NULL,
  rkey            TEXT         NOT NULL,
  title           TEXT         NOT NULL,
  description     TEXT         NOT NULL,
  required_fields TEXT[]       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL,
  indexed_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX survey_protocols_did_idx ON survey_protocols (did);
