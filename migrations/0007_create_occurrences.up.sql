CREATE TABLE occurrences (
  id                     BIGSERIAL         PRIMARY KEY,
  at_uri                 TEXT              NOT NULL UNIQUE,
  did                    TEXT              NOT NULL,
  rkey                   TEXT              NOT NULL,
  survey_uri             TEXT              NOT NULL,
  survey_target_uri      TEXT,
  taxon_id               TEXT,
  organism_quantity      TEXT,
  organism_quantity_type TEXT,
  geom                   GEOMETRY(Point, 4326),
  indexed_at             TIMESTAMPTZ       NOT NULL DEFAULT now(),
  CONSTRAINT fk_occurrence_survey FOREIGN KEY (survey_uri)
    REFERENCES surveys (at_uri) ON DELETE CASCADE
);

CREATE INDEX occurrences_survey_uri_idx ON occurrences (survey_uri);
CREATE INDEX occurrences_did_idx ON occurrences (did);
CREATE INDEX occurrences_geom_idx ON occurrences USING GIST (geom)
  WHERE geom IS NOT NULL;
