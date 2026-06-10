# Plan: notDetected occurrences only for targets that existed at survey time

## Goal

In the dwc-dp export, emit a `notDetected` occurrence for a (survey, target) pair
only when the target **existed at the time the survey was conducted**. Suppress
absences for targets the protocol gained *after* that survey happened.

## Background / current behavior

`notDetected` rows are produced by `streamAbsencesByProtocolUri`
(`src/lib/server/db/surveys.ts`). The query is purely set-based with no temporal
guard:

```sql
FROM surveys s
JOIN survey_targets st ON st.did = s.did AND st.protocol_uri = s.protocol_uri
LEFT JOIN occurrences o ON o.survey_uri = s.at_uri
                        AND o.record->>'surveyTargetID' = st.at_uri
WHERE s.protocol_uri = ${protocolUri} AND o.at_uri IS NULL
```

So for every (survey x target) pair in the protocol with no occurrence it emits a
`notDetected`, including targets added after a survey was conducted. The desired
suppression does not exist yet, and there are no tests covering it (the only
`notDetected` coverage in `dwc-dp.test.ts` is `occurrenceRowToCsvLine` formatting
a single absence row, not which rows get produced).

## The defining constraint

The absence query joins the **surveyor's `survey_targets`**, not the author's
`protocol_targets`. survey_targets are deliberately built to **outlive the
author's records** (`materialize-targets.ts`; the table has no FK to
`protocol_targets` by design, so the materialized scope survives the author
deleting the protocol).

Therefore the gating timestamp **must be carried on the survey_target itself**:

- We cannot join back to `protocol_targets` at export time, because those rows
  may be gone.
- A table-only column would be lost on reindex-from-PDS.
- So the timestamp has to live in the `surveyTarget` *record*, copied at
  materialization time, the same way `scope` already is.

## Why strongRef does not solve this (rejected approach)

- `survey.protocol` is already a `com.atproto.repo.strongRef` (uri + cid). But a
  CID hashes the protocol *record*, and protocolTargets are separate records that
  point at the protocol. Adding a target does not change the protocol record, so
  its CID is unchanged. CID comparison cannot detect "target added later."
- CIDs encode identity, not chronology. They support equality, not ordering, so
  they cannot express "target existed at or before the survey."
- Exact-CID matching would also break on any unrelated protocol edit (a new CID),
  wrongly suppressing legitimate absences.

The question "did this target exist when the survey happened" is inherently
temporal, so the solution is a timestamp comparison.

## The two timestamps to compare

- **Survey conducted time:** `COALESCE(s.event_date, s.created_at)` (the
  convention already used in `getLastSurveyByTargetUris`).
- **Target birth time:** the protocolTarget's `createdAt` (when the author added
  it to the protocol). Decision (2026-06-10): anchor on **protocolTarget
  creation**, not surveyor adoption. This matches the literal wording and the
  protocol-centric notion of absence reporting (the protocol's target set at
  survey time). Today neither `protocolTarget` nor `surveyTarget` carries a
  `createdAt`; that is the gap to fill.

Gate: emit the absence only when
`targetCreatedAt <= COALESCE(event_date, created_at)`.

## Plan

1. **Lexicon `bio.cuanto.protocolTarget`:** add a required `createdAt` (datetime),
   the authoritative target birth time, set by the author's client at creation.
   Mirrors `survey.createdAt` / `surveyProtocol.createdAt`.

2. **Lexicon `bio.cuanto.surveyTarget`:** carry that value forward as a durable
   copy (e.g. `createdAt`, documented as "the target's creation time, copied from
   the source protocolTarget"). Same durability principle already applied to
   `scope`.

3. **Materialization** (`materialize-targets.ts`): copy `pt.record.createdAt` into
   the built surveyTarget record.

4. **DB schema:** migration
   `migrations/20260610001_add_survey_targets_created_at.{up,down}.sql` adding
   `survey_targets.target_created_at TIMESTAMPTZ`, plus an index for the join
   filter. Run `pnpm migrate:up` **and** `pnpm test:db:setup`.

5. **Indexing paths** populate the new column from the record:
   `db/survey-targets.ts insertSurveyTarget`, and confirm the webhook
   (`routes/api/tap/webhook/+server.ts`) and sync paths flow through it.

6. **Backfill migration** for existing rows: decode the rkey TID (survey_targets
   reuse the protocolTarget's TID rkey, which encodes its creation time) as a
   one-time best-effort fill. Going forward the client sets `createdAt`
   explicitly, so the TID heuristic is only used for historical rows.
   - Caveat to verify first: confirm older migrated protocolTargets (the
     `bio.lexicons.temp.*` migrations) preserved their original rkey rather than
     regenerating it. If regenerated, those TIDs are wrong; fall back to `NULL`
     -> treated as "always existed" (include), the safe default.

7. **Query change** in `streamAbsencesByProtocolUri`: add to the WHERE clause
   ```sql
   AND (st.target_created_at IS NULL
        OR st.target_created_at <= COALESCE(s.event_date, s.created_at))
   ```
   NULL means "unknown birth time, do not suppress."

8. **Docs:** update `src/lib/server/dwc-dp-README.md` Notes to state that
   non-detections are only reported for targets that existed when the survey was
   conducted.

## Tests (TDD, write first)

- **Failing integration test** in `tests/export.spec.ts`: protocol with target A;
  survey conducted; later add target B; export and assert `occurrence.csv` has
  `notDetected` for A but **not** B for the earlier survey, and that a survey
  conducted *after* B does include B.
- **Unit test** for the query gate boundary (`<=`, NULL passthrough).
- Extend `materialize-targets.test.ts` / `migrate-lexicons.test.ts` to assert
  `createdAt` is copied.

## Open items to resolve during implementation

- Verify rkey preservation across the `bio.lexicons.temp.*` migrations (affects
  step 6 backfill trustworthiness).
- Confirm naming of the carried-forward field on `surveyTarget`.
