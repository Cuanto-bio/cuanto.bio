-- NOT VALID skips checking existing rows; new inserts are still enforced.
-- Run VALIDATE CONSTRAINT once existing orphaned rows are cleaned up.
ALTER TABLE survey_protocols
  ADD CONSTRAINT fk_protocol_user FOREIGN KEY (did) REFERENCES users (did) NOT VALID;
