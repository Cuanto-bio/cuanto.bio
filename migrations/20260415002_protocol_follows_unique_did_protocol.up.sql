ALTER TABLE protocol_follows
  ADD CONSTRAINT uq_follow_did_protocol UNIQUE (did, protocol_uri);
