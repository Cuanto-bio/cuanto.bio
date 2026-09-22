-- Free-text remarks (bio.lexicons.temp.v0-1.remark) that fill a Darwin Core
-- *Remarks term on another record. Kept as their own records so authored prose,
-- a potential creative work, can be attributed and licensed separately from the
-- facts in the record it describes.
--
-- Deliberately has no foreign key to surveys (or any other subject table):
-- a remark can name any record as its subject, tap can deliver it before the
-- record it describes, and surveys already cascade from survey_protocols in a
-- way that would silently take remarks with them.
--
-- Note the lexicon treats the *forward* reference as authoritative
-- (survey.eventRemarksID), not subject_uri: a remark nothing points at fills no
-- term. subject_uri is indexed for looking up a subject's remarks and for
-- detecting a forward reference that points at the wrong remark.
CREATE TABLE remarks (
  id           BIGSERIAL    PRIMARY KEY,
  at_uri       TEXT         NOT NULL UNIQUE,
  did          TEXT         NOT NULL,
  rkey         TEXT         NOT NULL,
  subject_uri  TEXT         NOT NULL,
  dwc_term     TEXT         NOT NULL,
  record       JSONB        NOT NULL,
  indexed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX remarks_subject_uri_term_idx ON remarks (subject_uri, dwc_term);
