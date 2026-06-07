-- Per-user flag set when a user has records under outdated lexicon NSIDs and
-- cleared once their records are migrated. Consumed by the lexicon migration
-- tooling (stamping script + migrateUser).
ALTER TABLE users ADD COLUMN needs_lexicon_migration BOOLEAN NOT NULL DEFAULT false;
