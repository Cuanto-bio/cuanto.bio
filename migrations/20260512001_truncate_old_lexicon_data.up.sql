-- Wipe all records that were published under the pre-v0-1 lexicon NSIDs.
-- Child tables first to satisfy FK constraints.
TRUNCATE identifications CASCADE;
TRUNCATE occurrences CASCADE;
TRUNCATE protocol_follows CASCADE;
TRUNCATE survey_targets CASCADE;
TRUNCATE surveys CASCADE;
TRUNCATE survey_protocols CASCADE;
