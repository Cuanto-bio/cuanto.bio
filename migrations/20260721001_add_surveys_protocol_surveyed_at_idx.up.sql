-- Every stats query filters surveys by protocol and then by
-- COALESCE(event_date, created_at): the date filters, and the 10-week window
-- the trend charts bin into. surveys_protocol_uri_idx serves only the first
-- half, so charting the last 10 weeks of a protocol reads every survey that
-- protocol has ever had and discards all but the window.
--
-- COALESCE over two columns is immutable, so it can be indexed directly. The
-- expression has to match the queries exactly to be used.
--
-- Plain CREATE INDEX because scripts/migrate.ts runs each migration inside a
-- transaction and CONCURRENTLY cannot run there. On a large surveys table this
-- takes an ACCESS EXCLUSIVE lock for the duration; if that matters, build it by
-- hand with CREATE INDEX CONCURRENTLY first and this migration becomes a no-op
-- via IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS surveys_protocol_surveyed_at_idx
  ON surveys (protocol_uri, (COALESCE(event_date, created_at)));
