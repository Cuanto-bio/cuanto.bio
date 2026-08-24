# Issue #41: SurveyTarget deletion causes export data loss and a createdAt regression

**Status: decided and implemented 2026-08-22 (option A).** The failure modes were
verified against `main` as of `9da9bd0` and re-verified as of `b54ec9a` (none of
the relevant files changed in between). The five open questions are answered
below under "Decisions"; what shipped is at the end.

## What is actually broken (verified on main)

A `bio.cuanto.surveyTarget` record can be deleted directly on the surveyor's PDS
by any AT Protocol client with write access to their repo. Our app has no UI for
it, so this is not something we cause, but it is something we must survive.

### 1. Deleted index row silently drops real detections from the export

The tap webhook's delete branch hard-deletes the index row:

- `src/routes/api/tap/webhook/+server.ts:257` calls `deleteSurveyTargetByUri`
- `src/lib/server/db/survey-targets.ts:85` is a plain `DELETE FROM survey_targets`

Once that row is gone, an occurrence that references it is no longer exported by
anything:

- `streamTargetedOccurrencesByProtocolUri` (`src/lib/server/db/surveys.ts:445`)
  inner-joins `survey_targets` on `o.record->>'surveyTargetID' = st.at_uri`
  (`surveys.ts:469-472`), so the occurrence drops out.
- `streamIncidentalOccurrencesByProtocolUri` (`surveys.ts:516`) does not pick it
  up either, because it only matches occurrences whose `surveyTargetID` is null
  or empty (`surveys.ts:541`).

The `occurrences` row is untouched in the database, but a real, recorded
detection with taxon and quantity data is absent from the DwC-DP export
entirely. The target itself also disappears from
`streamSurveyTargetsByProtocolUri` (`surveys.ts:429`).

This is a strictly worse failure than #40's: #40 produced a wrong
`occurrenceStatus`, this produces no row at all.

### 2. Self-heal resets `createdAt`, re-breaking #40's lower bound

`materializeSurveyTargets` reuses the source `ProtocolTarget`'s rkey, so if the
surveyor still follows the protocol and the `ProtocolTarget` still exists, the
next reconciliation recreates the record at the same `at_uri` and the join works
again. But the recreated record is built with a fresh timestamp:

- `src/lib/server/materialize-targets.ts:58` skips only rkeys already present
- `src/lib/server/materialize-targets.ts:63` sets
  `createdAt: new Date().toISOString()`

So `survey_targets.created_at` jumps forward to the recreation time, and the
absence query's lower bound (`surveys.ts:497-500`,
`st.created_at <= COALESCE(s.event_date, s.created_at)`) now excludes every
survey conducted between the true original adoption and the delete. Those
surveys lose legitimate `notDetected` rows. That is a false negative introduced
by the recovery path itself, and it is silent.

Note that the `created_at IS NULL` escape hatch in that clause does not help:
after recreation `created_at` is populated, just wrong.

### 3. No self-heal at all in two cases

`materializeSurveyTargets` only iterates live `protocolTargets` for a followed
protocol, so if the surveyor has unfollowed, or the `ProtocolTarget` is itself
deleted, nothing recreates the record and the break is permanent. Separately,
`gcSurveyTargetsIfUnused` (`materialize-targets.ts:142`) intentionally
hard-deletes every target for a protocol on full disengagement (not following,
zero surveys), which is the same DELETE by a different route. Whatever we decide
here has to say whether that GC path is still acceptable.

## What the decision hinged on, and why it was less fraught than it looked

An earlier draft of this note claimed that preserving true adoption time
"requires treating the index as authoritative for `createdAt`", reversing the
"the surveyor's repo self-describes" rationale #40 was built on. That framing was
wrong, in two ways:

1. **Backdating a rewritten record is already established behavior.**
   `reconcileRetirements` rewrites the `SurveyTarget` record while carrying the
   original `createdAt` forward (`materialize-targets.ts:110-113`, falling back
   to the `created_at` column for rows that predate the field). A rewritten
   record keeping its original adoption time is the existing pattern, not a new
   principle. The lexicon supports it: `createdAt` is documented as
   "Client-declared timestamp when the surveyor materialized this target", which
   is a claim about adoption, not about record write time.
2. **Index-only preservation does not actually work.** `insertSurveyTarget`'s
   upsert sets `created_at = EXCLUDED.created_at` from the record
   (`survey-targets.ts:47`). When the recreated record's create event comes back
   through the tap webhook, it would clobber any index-preserved value with
   "now". Backdating the record is the approach that needs no special-casing in
   ingest, and it keeps the record as source of truth.

So the index only has to *remember* `created_at` across the gap, which is
exactly what a tombstone provides. #40's principle survives intact.

Two of the three directions floated in the issue still do not survive contact
with the code, and are retired:

- **"Prevent deletion at the app level"** is not achievable. The record lives in
  the surveyor's own repo; any AT Protocol client can delete it. We can only
  react to the delete event, not veto it.
- **"Warn/alert on an unexpected delete event"** does nothing for the data loss
  on its own. Kept only as the logging decision below.

## Options

### A. Tombstone `survey_targets`, mirroring #40's `protocol_targets.deleted_at`

Add `survey_targets.deleted_at`; the webhook delete branch stamps it instead of
deleting the row; `materializeSurveyTargets` clears it on recreate while
**keeping the existing `created_at`**; export queries keep joining as they do
now, so detections survive.

- Fixes 1, 2, and 3 in one mechanism, including the unfollowed case, since the
  row never leaves.
- Symmetric with the tombstone pattern already established for
  `protocol_targets` in migration `20260717001`, so it is the least surprising
  shape in this codebase.

### B. Preserve `createdAt` only, keep hard deletes

Keep the hard delete, but have `materializeSurveyTargets` recover the original
adoption time from some surviving source (earliest occurrence referencing the
target, or a separate adoption-log table) when it recreates the record.

- Smaller schema change if an existing signal is good enough.
- Does not fix 1 (data loss stands until the next reconciliation) and does not
  fix 3 at all.
- The "earliest occurrence" heuristic is wrong precisely when it matters most:
  a target with only `notDetected` history has no occurrence to date from.
- Rejected.

### C. Make the export resilient instead of the index

Make `streamTargetedOccurrencesByProtocolUri` a LEFT JOIN and emit the
occurrence with degraded target metadata, or route it into the incidental
stream.

- Directly addresses the worst symptom (silent disappearance) with no schema
  change, and is a reasonable belt-and-braces addition to A.
- On its own it fixes neither 2 nor 3, and it quietly reclassifies a targeted
  detection as incidental, which is itself a data-quality lie.
- Deferred: a hardening follow-up on top of A, not part of this fix.

## Recommendation

**A**, with the export-side LEFT JOIN from **C** as a follow-up safety net, and
an explicit "we cannot prevent deletion" note added to the issue so the
prevention framing is retired.

Ordering matters: A is what stops the data loss and the `createdAt` regression;
C only limits the blast radius if a row is missing for some other reason.

## Decisions (settled 2026-08-22)

1. **Index-authoritative `createdAt`? No, the record stays source of truth.** On
   recreate, read the tombstoned row's `created_at` and pass it as the new
   record's `createdAt`. Ingest then re-derives the same value through the normal
   upsert, so no ingest special-casing is needed and record and index agree. See
   the framing correction above for why the index-only variant fails.

2. **Does `deleted_at` bound absences? No.** Only `created_at` and `retired_at`
   define validity; `deleted_at` is bookkeeping that keeps the join and the
   adoption time alive. Beyond the semantics (retirement says "the protocol
   stopped asking for this", deletion says "this record should never have gone
   away"), `deleted_at` is transient: the next reconciliation clears it. If it
   bounded absences, the same survey would export differently depending on
   whether the export ran before or after a recreate. Exports must be
   deterministic for a fixed set of surveys.

   Consequence: **no query filters on `deleted_at`.** The call sites touching
   `survey_targets` split into two groups, and neither changes:

   - Join by `at_uri` (an occurrence to its own target): `surveys.ts:97,131,240`
     and six sites in `stats.ts`. Tombstoned rows must stay visible here; that is
     the fix.
   - Enumerate by protocol (a surveyor's target set): `surveys.ts:438,469,496`
     and `getSurveyTargetsByDidAndProtocol`. These keep seeing tombstoned rows
     too, per the answer above.

3. **`gcSurveyTargetsIfUnused` keeps hard-deleting.** Its precondition is not
   following AND zero surveys. `occurrences.survey_uri` is `NOT NULL` with an FK
   to `surveys` (`migrations/0007_create_occurrences.up.sql:6,13`), so zero
   surveys means zero occurrences: there is no detection to lose and no join to
   keep alive. Tombstoning there would defeat its stated cleanup purpose to
   protect nothing. Add a comment saying so.

   Note that GC also deletes the PDS records (`materialize-targets.ts:152`),
   which sends delete events back through the webhook. With a tombstone that
   branch becomes an `UPDATE ... SET deleted_at` matching zero rows, a harmless
   no-op. Worth a test so nobody later "fixes" it into an insert.

4. **Alerting: `log.warn` in the delete branch when the target has occurrences,
   and nothing more.** The current line is
   `log.info({ atUri }, 'deleted survey target')`
   (`src/routes/api/tap/webhook/+server.ts:258`). Conditioning a warn on an
   occurrence count distinguishes the routine case from the one that just
   severed real data. Needs one new count query; nothing existing counts
   occurrences by `surveyTargetID`. Anything routed off-box is an ops decision
   with no owner right now, and the tombstone is what actually prevents the loss.

5. **Lexicon: no change, index-only.** Option A adds a DB column and changes no
   record shape. `retiredAt` already exists from #40, and backdating reuses
   `createdAt` with its existing documented meaning. #40 touched the lexicon
   because retirement is a fact about the protocol that the repo should
   self-describe; deletion recovery is bookkeeping about our index.

## Two implementation consequences that are not decisions

- **The forward loop must treat a tombstoned row as "recreate".** It skips any
  rkey already in `existing` (`materialize-targets.ts:58`), and
  `getSurveyTargetsByDidAndProtocol` returns every row for the protocol. Under A
  the tombstoned row is still present, so without a change nothing would recreate
  the PDS record: the export would be saved but the surveyor's repo would stay
  permanently missing the record. Recreate must reuse the stored `created_at`.
- **The delete branch must honor `rev`.** It currently ignores `evt.rev` while
  the create path uses it as an ordering guard (`survey-targets.ts:56-58`). That
  is safe today because a hard delete is idempotent, but once the row survives, a
  replayed or out-of-order delete could re-tombstone a row that a newer create
  already revived. The tombstone stamps `rev` and applies the same guard.

## What shipped

Tests first, each confirmed failing against the unmodified code before any
production change:

1. `tests/export.spec.ts` "detection survives deletion of its surveyTarget
   record": seeds a protocol, a survey, and an occurrence, POSTs a `surveyTarget`
   delete event to `/api/tap/webhook`, then asserts the specific occurrence is
   still in `occurrence.csv` with its quantity. Failed by omission.
2. `tests/export.spec.ts` "notDetected survives deletion of the surveyTarget
   record": same path with a target and no occurrence. Covers decision 2. Failed
   with zero rows.
3. `tests/export.spec.ts` "a stale delete event does not tombstone a newer
   surveyTarget": covers the rev guard. Failed on the missing column.
4. `src/lib/server/materialize-targets.test.ts` "recreates a tombstoned
   surveyTarget with its original created_at". Failed because the forward loop
   skipped the rkey outright.
5. `src/routes/api/tap/webhook/webhook.test.ts`: the delete branch passes `rev`,
   and warns only when the target had occurrences.

A fourth export test ("a delete event for an unknown surveyTarget creates no
row") guards the GC path from decision 3; it passed before and after, by design.

Then the production changes:

- `migrations/20260822001_add_survey_targets_deleted_at.{up,down}.sql`.
- `deleteSurveyTargetByUri` in `db/survey-targets.ts` became
  `tombstoneSurveyTargetByUri(atUri, rev?)`: it stamps `deleted_at` under the
  same staleness guard `insertSurveyTarget` uses, and that upsert clears
  `deleted_at` so a recreate revives the row. Renamed rather than kept as
  `delete*` so a call site says what actually happens to the row.
  `deleteProtocolTargetsByUris`, which has tombstoned under a `delete*` name
  since #40, was renamed to `tombstoneProtocolTargetsByUris` to match.
- `countOccurrencesBySurveyTargetUri` in `db/surveys.ts`, used by the webhook's
  delete branch to pick `log.warn` over `log.info`.
- The forward loop in `materialize-targets.ts` recreates tombstoned targets,
  carrying the stored `created_at` into the new record's `createdAt`.
- `gcSurveyTargetsIfUnused` keeps its hard delete, with a comment recording why.

Deferred: option C's LEFT JOIN hardening on
`streamTargetedOccurrencesByProtocolUri`.
