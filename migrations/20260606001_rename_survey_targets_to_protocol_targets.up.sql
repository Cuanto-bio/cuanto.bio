-- The surveyTarget lexicon becomes bio.cuanto.protocolTarget (the protocol
-- author's canonical targets). Rename the table and its named objects to match.
ALTER TABLE survey_targets RENAME TO protocol_targets;
ALTER INDEX survey_targets_protocol_uri_idx RENAME TO protocol_targets_protocol_uri_idx;
ALTER INDEX survey_targets_did_idx RENAME TO protocol_targets_did_idx;
ALTER TABLE protocol_targets RENAME CONSTRAINT fk_protocol TO fk_protocol_target_protocol;
