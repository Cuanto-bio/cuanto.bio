CREATE TABLE survey_targets (
  id           BIGSERIAL    PRIMARY KEY,
  at_uri       TEXT         NOT NULL UNIQUE,
  did          TEXT         NOT NULL,
  rkey         TEXT         NOT NULL,
  protocol_uri TEXT         NOT NULL,
  scope        JSONB        NOT NULL,
  indexed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_protocol FOREIGN KEY (protocol_uri)
    REFERENCES survey_protocols (at_uri) ON DELETE CASCADE
);

CREATE INDEX survey_targets_protocol_uri_idx ON survey_targets (protocol_uri);
CREATE INDEX survey_targets_did_idx ON survey_targets (did);
