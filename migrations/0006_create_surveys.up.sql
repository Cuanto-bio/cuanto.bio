CREATE TABLE surveys (
  id                    BIGSERIAL    PRIMARY KEY,
  at_uri                TEXT         NOT NULL UNIQUE,
  did                   TEXT         NOT NULL,
  rkey                  TEXT         NOT NULL,
  protocol_uri          TEXT         NOT NULL,
  protocol_cid          TEXT         NOT NULL,
  event_date            TIMESTAMPTZ,
  event_duration_value  INTEGER,
  event_duration_unit   TEXT,
  location              JSONB        NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL,
  indexed_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_survey_protocol FOREIGN KEY (protocol_uri)
    REFERENCES survey_protocols (at_uri) ON DELETE CASCADE
);

CREATE INDEX surveys_did_idx ON surveys (did);
CREATE INDEX surveys_protocol_uri_idx ON surveys (protocol_uri);
