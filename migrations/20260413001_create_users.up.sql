CREATE TABLE users (
  did                    TEXT              PRIMARY KEY,
  handle                 TEXT              NOT NULL,
  indexed_at             TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE INDEX users_handle_idx ON users (handle);