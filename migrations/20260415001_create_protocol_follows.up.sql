CREATE TABLE protocol_follows (
  id           BIGSERIAL   PRIMARY KEY,
  at_uri       TEXT        NOT NULL UNIQUE,
  did          TEXT        NOT NULL,
  rkey         TEXT        NOT NULL,
  protocol_uri TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  indexed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_follow_protocol
    FOREIGN KEY (protocol_uri)
    REFERENCES survey_protocols (at_uri) ON DELETE CASCADE
);

CREATE INDEX protocol_follows_did_idx ON protocol_follows (did);
CREATE INDEX protocol_follows_protocol_uri_idx ON protocol_follows (protocol_uri);
