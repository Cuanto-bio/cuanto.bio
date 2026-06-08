-- Surveyor-owned materialized copies of a protocol's targets
-- (bio.cuanto.surveyTarget). Created when a surveyor adopts a Protocol; each
-- carries its own copy of the target scope so what was sought stays durable even
-- if the protocol author later deletes the Protocol. Deliberately has no foreign
-- key to survey_protocols/protocol_targets: these records must outlive the
-- author's records.
CREATE TABLE survey_targets (
  id                  BIGSERIAL    PRIMARY KEY,
  at_uri              TEXT         NOT NULL UNIQUE,
  did                 TEXT         NOT NULL,
  rkey                TEXT         NOT NULL,
  protocol_uri        TEXT         NOT NULL,
  protocol_target_uri TEXT         NOT NULL,
  record              JSONB        NOT NULL,
  indexed_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX survey_targets_did_protocol_idx ON survey_targets (did, protocol_uri);
CREATE INDEX survey_targets_protocol_uri_idx ON survey_targets (protocol_uri);
