-- Supports getLastSurveyByTargetUris: filters occurrences by surveyTargetID,
-- which lives in record JSONB since survey_target_uri was dropped in 20260424002.
-- Not partial: a WHERE record ? 'surveyTargetID' predicate would make the index
-- unusable here, since the planner can't prove record->>'surveyTargetID' = $1
-- implies record ? 'surveyTargetID'. Rows without the key index as NULL, which
-- the equality filter never matches anyway.
CREATE INDEX occurrences_survey_target_id_idx
  ON occurrences ((record->>'surveyTargetID'));
