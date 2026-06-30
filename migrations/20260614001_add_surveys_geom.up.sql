ALTER TABLE surveys ADD COLUMN geom GEOMETRY(Point, 4326);

UPDATE surveys
SET geom = ST_SetSRID(
    ST_MakePoint((sub.loc->>'longitude')::numeric, (sub.loc->>'latitude')::numeric),
    4326
  )
FROM (
  SELECT s.at_uri,
    (
      SELECT elem
      FROM jsonb_array_elements(s.record->'location'->'locations') AS elem
      WHERE elem->>'longitude' IS NOT NULL AND elem->>'latitude' IS NOT NULL
      LIMIT 1
    ) AS loc
  FROM surveys s
  WHERE jsonb_typeof(s.record->'location'->'locations') = 'array'
) AS sub
WHERE surveys.at_uri = sub.at_uri
  AND sub.loc IS NOT NULL;

CREATE INDEX surveys_geom_idx ON surveys USING GIST (geom) WHERE geom IS NOT NULL;
