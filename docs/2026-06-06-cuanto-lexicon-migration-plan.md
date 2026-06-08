# Lexicon Surgery: migrate to `bio.cuanto.*`, two-tier targets, one-off data migration

## Context

The project's survey domain lexicons currently live under the upstream lexicons.bio staging
namespace `bio.lexicons.temp.v0-1.*`. lexicons.bio will not support our survey work, so
survey/protocol/target move into our own `bio.cuanto.*` namespace. The shared biodiversity
types (occurrence, identification) stay aligned with lexicons.bio but have drifted from
upstream and need re-syncing. Real users now have records under the old NSIDs, so we also
need tooling to migrate their PDS data (not just truncate the local index, as the prior
`20260512001_truncate_old_lexicon_data` migration did).

Alongside the namespace move we are restructuring **targets** into two tiers (see below) so
that what a survey sought stays durable and under the surveyor's control without per-survey
duplication.

## Decisions (locked)

- **No version segment in NSIDs.** atproto treats the NSID as the stable schema identity;
  versions in the path force every future breaking change into a collection move
  (create+delete, all at-uri refs rewritten) for no migration discount. Evolve compatibly;
  migrate when we can't. This is a **one-off migration tool**, not permanent versioning infra
  (no `schema_version` column yet; add it the day we do our first in-place breaking change).
- **Two-tier targets.** Split the single `surveyTarget` concept into:
  - `bio.cuanto.protocolTarget` — the **protocol author's** canonical targets (what the old
    `surveyTarget` becomes).
  - `bio.cuanto.surveyTarget` — the **surveyor's** materialized copy, created when they adopt
    a protocol, carrying its own copy of `scope` plus an `protocolTargetID` provenance link.
    Occurrences reference these (same-repo, durable). Rationale below.
- **occurrence/identification keep their NSID** (`bio.lexicons.temp.v0-1.*`), keep the
  local-extension fields `eventID`, `surveyTargetID` (occurrence) and `vernacularName`
  (identification), and adopt upstream's `organismQuantityType` (`individuals`, no default).
  Track the extensions as intended-upstream proposals (final-doc phase).
- **One shipped migration, three stacked PRs, single deploy.** Develop as a stack: PR1
  (foundation), PR2 (targets) on PR1, PR3 (migration tooling) on PR2. Review and merge in order
  (1→2→3) to main, but do **not** deploy to production between merges — deploying PR1 or PR2
  alone would put prod into an interim state (new-NSID writes over unmigrated data, or
  occurrences referencing protocolTargets) that we'd have to support for no benefit. Deploy once
  after PR3 merges, then enable the stamping script + banner so the migration becomes available
  only when the whole thing is live. `migrateUser(did)` is written against the final model;
  there is never an intermediate state to re-migrate.
- **Old records: delete after writing new** for collection moves (reuse rkey, then delete the
  old-NSID record). occurrence/identification/follow are updated in place (at-uri preserved).
- **Invocation: both** — one core `migrateUser(did)`, exposed via a banner one-click AND a
  runnable admin script over stored OAuth sessions.

## Data model: why two tiers

A survey's meaning ("absence of an Occurrence for a target implies the target was not found")
requires the target set to be durable and interpretable for the life of the survey. But
targets owned by the protocol author are fragile: the author can delete their protocol and
targets at any time, and atproto has no cross-repo referential integrity. Copying targets
per-survey is durable but massively duplicative.

Resolution: the surveyor materializes the protocol's targets **once per adopted protocol**
into their own repo (`bio.cuanto.surveyTarget`), reused across all their surveys of that
protocol. This is durable (surveyor-owned), bounded (per surveyor+protocol, not per survey),
keeps occurrence→target references same-repo (never dangles), and aligns with DwC-DP at
*export* time by projecting per-survey target rows from the survey→protocol→target join (a
`dwc-dp.ts` concern, not a storage mandate).

- **Materialize on follow, re-ensure at survey time:** adopting a protocol (the follow action)
  materializes the protocol's targets; survey create/edit also calls the idempotent
  `materializeSurveyTargets`, so surveying an un-followed protocol still has its targets. (An
  earlier "offline" rationale for follow-time materialization does not actually apply, because
  occurrence records are built **server-side** at POST, not on the client.)
- **Deterministic rkey (convenience, not load-bearing):** each surveyTarget reuses its source
  protocolTarget's rkey, so materialization is idempotent (re-running finds the existing
  record). Correctness does **not** depend on it: occurrences reference the surveyTarget
  directly and the protocolTarget correlation is resolved through the `survey_targets` index, so
  nothing breaks if rkeys ever diverge.

**Occurrence → target references.** An occurrence stores only `surveyTargetID` (the surveyor's
own surveyTarget — same repo, never dangles). The canonical protocolTarget is **not** duplicated
onto the occurrence record; it is always reachable transitively
(occurrence → surveyTarget → `protocolTargetID`), so the federated lexicon stays minimal and
external consumers (who ingest the surveyTargets anyway) lose nothing. For our own UI — which
holds occurrences and the protocol's protocolTargets but not the surveyTargets — the server
resolves a `protocolTargetUri` per occurrence via the `survey_targets` index and attaches it as
an **app-level** field (a sibling of `record`, not inside it); the frontend matches occurrences
to protocol targets on that.
- **Lifecycle / GC:** a surveyTarget set is alive while the surveyor is *engaged* with the
  protocol = **followed OR has ≥1 survey** for it. Eligible for deletion only when neither.
  Key on **survey** existence, not occurrence existence — a sought-but-not-found target has no
  occurrence yet still carries the absence signal. Occurrence references are subsumed by
  survey references (an occurrence is a child of a survey via `eventID`). The only two
  transitions into "eligible" are **unfollow** and **survey deletion**, both user-initiated,
  in-session, authenticated; check eligibility (a cheap indexed query) at exactly those two
  points and delete in the same request. No periodic sweep (repos tolerate orphans; add a
  reconciliation sweep later only if orphans actually accumulate).

### NSID mapping

| Old | New |
|-----|-----|
| `bio.lexicons.temp.v0-1.survey` | `bio.cuanto.survey` |
| `bio.lexicons.temp.v0-1.surveyProtocol` | `bio.cuanto.surveyProtocol` |
| `bio.lexicons.temp.v0-1.surveyTarget` | `bio.cuanto.protocolTarget` (author's canonical) |
| (new) | `bio.cuanto.surveyTarget` (surveyor's materialized copy) |
| `bio.cuanto.surveyProtocol.follow` | unchanged (`subject` at-uri rewritten in place) |
| `bio.lexicons.temp.v0-1.occurrence` | unchanged (`organismQuantityType` synced; `surveyTargetID` points at the surveyor's surveyTarget) |
| `bio.lexicons.temp.v0-1.identification` | unchanged (content synced) |
| `bio.lexicons.temp.v0-1.media` | unchanged |

The follow lexicon is not renamed: it is already version-free and in our namespace, and
`bio.cuanto.surveyProtocol` (record) vs `bio.cuanto.surveyProtocol.follow` (authority segment
reuse) are distinct valid NSIDs with no real conflict. Its `subject` points at a protocol
whose collection moves, so it migrates as a cheap in-place `putRecord`.

---

# PR 1 — Namespace move + occurrence/identification sync + table rename  *(implemented)*

## 1.1 Lexicon schema files

Move/rename JSON under `lexicons/`:
- `…/temp/v0-1/survey.json` → `lexicons/bio/cuanto/survey.json` (`id: bio.cuanto.survey`).
- `surveyProtocol.json` → `lexicons/bio/cuanto/surveyProtocol.json` (`bio.cuanto.surveyProtocol`).
- `surveyTarget.json` → `lexicons/bio/cuanto/protocolTarget.json` (`bio.cuanto.protocolTarget`;
  update the `main` description to "protocol author's canonical target"; keep `protocol`
  (at-uri) required, `scope` unchanged, defs `#taxonScope`/`#verbatimScope` unchanged — PR2's
  surveyTarget will ref these defs).
- `lexicons/bio/cuanto/surveyProtocol/follow.json` — unchanged.

Edit in place to match upstream lexicons.bio:
- `…/temp/v0-1/occurrence.json` — `organismQuantityType`: set `knownValues` to
  `["individuals", "percent-cover"]` and **remove** `"default"`. Keep `eventID`,
  `surveyTargetID` (local extensions; `surveyTargetID` will point at `bio.cuanto.surveyTarget`
  after PR2).
- `identification.json` — no field change; `vernacularName` stays (local extension).

## 1.2 Codegen + reference updates

1. `pnpm lex:gen` to rebuild `src/lib/lexicons/` (`@atproto/lex`, clears + regenerates). New:
   `src/lib/lexicons/bio/cuanto/{survey,surveyProtocol,protocolTarget}.defs.ts`
   (`…/surveyProtocol/follow.defs.ts` unchanged).
2. Update NSID literals and import paths; prefer generated `*.$nsid`/`*.$type` constants.
   Representative sites: `src/routes/api/tap/webhook/+server.ts` (the `*_NSID` constants and
   routing; keep old NSIDs recognized for delete events during the migration window),
   `src/routes/protocols/new/+page.server.ts`,
   `src/routes/protocols/[handle]/[rkey]/edit/+page.server.ts`,
   `src/routes/api/occurrences/[rkey]/+server.ts`, `src/lib/server/survey-records.ts`,
   `src/lib/server/db/{surveys,survey-protocols,occurrences,identifications,protocol-follows}.ts`,
   `src/lib/components/ProtocolForm.svelte`, `src/lib/offline/db.ts`,
   `scripts/reindex-protocol.ts`, and test fixtures with hardcoded `at://…` / `$type` literals.
3. Audit `organismQuantityType` read/write sites (default removed): set `'individuals'`
   explicitly when building occurrence records; handle absence on read. Grep
   `organismQuantityType`, `individual-count`.
4. `pnpm check`, `pnpm format`.

## 1.3 DB / index — `survey_targets` → `protocol_targets`

- Tables key on `at_uri`/`record` JSONB (no NSID column), so the data migration does not
  *require* schema changes; renaming is for concept consistency.
- New migration `YYYYMMDDXXX_rename_survey_targets_to_protocol_targets.up.sql`:
  `ALTER TABLE survey_targets RENAME TO protocol_targets`, rename the `fk_protocol`
  constraint. Update SQL + identifiers in `src/lib/server/db/survey-protocols.ts`,
  `surveys.ts`, `scripts/reindex-protocol.ts`, tests. Leave historical/down migrations as-is.
- Client has **no** `survey_targets` store (targets are embedded as `targets: Target[]` in
  `cached-protocols`, `src/lib/offline/db.ts`); client change is type/identifier-only.
- Do **not** rename the `occurrence.surveyTargetID` lexicon field (lexicons.bio-owned).
- Add staleness flag `users.needs_lexicon_migration BOOLEAN` (migration), set by the stamping
  script, cleared when `migrateUser` completes.

## 1.4 DwC-DP export — retarget to `protocol_targets`

The DwC-DP export must keep producing valid output. In PR1 the logic is unchanged; only the
source table name changes. Update the streaming queries in `src/lib/server/db/surveys.ts`
(`streamSurveyTargetsByProtocolUri`, `streamTargetedOccurrencesByProtocolUri`,
`streamAbsencesByProtocolUri`, `streamIncidentalOccurrencesByProtocolUri`, and the
`SELECT … FROM survey_targets WHERE at_uri = ANY(...)` helper) from `survey_targets` to
`protocol_targets`. Occurrences still carry `surveyTargetID` = the protocolTarget at-uri, so the
`o.record->>'surveyTargetID' = …at_uri` joins still match; CSV builders in
`src/lib/server/dwc-dp.ts` are unchanged. Update `dwc-dp.test.ts` fixtures.

---

# PR 2 — Two-tier targets (surveyTarget materialization + GC)  *(implemented)*

## 2.1 surveyTarget lexicon

New `lexicons/bio/cuanto/surveyTarget.json` (`bio.cuanto.surveyTarget`, key `tid`):
- `protocol` (at-uri, required) — the protocol being followed (for cheap grouping/queries).
- `protocolTargetID` (at-uri, required) — provenance to the source `bio.cuanto.protocolTarget`.
  **at-uri, not strongRef:** the surveyTarget carries its own `scope` copy for durability, and
  cross-repo materialization (esp. during migration, before the author migrates) cannot
  reliably obtain the target's CID; identity provenance is sufficient. Revisit if version
  pinning becomes necessary.
- `scope` (array, required) — copy of the source scope, reusing the canonical shapes via refs
  to `bio.cuanto.protocolTarget#taxonScope` / `#verbatimScope`.

`pnpm lex:gen`. New `src/lib/lexicons/bio/cuanto/surveyTarget.defs.ts`.

## 2.2 Materialize on follow

In the follow action(s) (`src/routes/app/protocols/[handle]/[rkey]/+page.server.ts` and
`src/routes/protocols/[handle]/[rkey]/+page.server.ts`), after `createFollow`/follow record
creation, materialize the protocol's targets into the surveyor's repo:
- Source the protocol's targets and their `scope` from the local index (`protocol_targets`),
  so it works regardless of the author's own migration status.
- For each, `putRecord` a `bio.cuanto.surveyTarget` reusing the protocolTarget's rkey,
  `protocol` = protocol at-uri, `protocolTargetID` = protocolTarget at-uri, `scope` copied.
  Idempotent via the reused rkey (skip targets already present in the index).
- **Re-ensure at survey time:** survey create (`/api/surveys` POST) and edit (`/api/surveys/
  [handle]/[rkey]` PUT) also call `materializeSurveyTargets` before writing occurrences, so a
  survey of an un-followed protocol still has its targets. Lives in
  `src/lib/server/materialize-targets.ts`.
- New DB table + layer: `survey_targets` (fresh in PR2) with `at_uri`, `did`, `rkey`,
  `protocol_uri`, `protocol_target_uri`, `record` JSONB; `src/lib/server/db/survey-targets.ts`
  with insert/list-by-did-and-protocol/delete-by-did-and-protocol. Index this collection in the
  TAP webhook.

## 2.3 Occurrence → surveyTarget, with app-level protocolTarget resolution

- **Write side:** new survey occurrences (and relink) set `occurrence.surveyTargetID` to the
  surveyor's own `bio.cuanto.surveyTarget` at-uri via `surveyTargetUriFor(did, protocolTargetUri)`
  (`src/lib/surveyTargets.ts`). The client still sends the protocolTarget URI; the server maps
  it. Write paths: `src/routes/api/surveys/+server.ts`, `src/routes/api/surveys/[handle]/[rkey]/
  +server.ts`, `src/routes/api/occurrences/[rkey]/+server.ts`. The occurrence record carries
  **only** `surveyTargetID` (no `protocolTargetID` on the lexicon record).
- **Read side (app-level correlation):** `getOccurrencesForSurveys` `LEFT JOIN survey_targets st
  ON st.at_uri = o.record->>'surveyTargetID'` and returns `st.protocol_target_uri`;
  `groupOccurrencesBySurvey` attaches it as `Occurrence.protocolTargetUri` (sibling of `record`,
  defined in `src/lib/offline/db.ts`). The offline cache carries it because it's part of the
  survey API response.
- **Frontend matching** uses `o.protocolTargetUri === protocolTarget.atUri` in
  `SurveyDetail.svelte`, `SurveyForm.svelte`, `OrphanedOccurrences.svelte`. Incidental detection
  stays on `!o.record.surveyTargetID`. `getLastSurveyByTargetUris` joins `survey_targets` to key
  results by protocolTarget. No offline/IndexedDB schema change (surveyTargets never reach the
  client).

## 2.4 Event-driven GC

- New DB helper: `countSurveysByDidAndProtocol(did, protocolUri)`; reuse
  `getFollowByDidAndProtocol` (`src/lib/server/db/protocol-follows.ts`).
- **Unfollow** (`…/protocols/[handle]/[rkey]/+page.server.ts`, after `deleteFollow`): if
  survey count for that protocol is 0, delete the surveyor's `bio.cuanto.surveyTarget` records
  for that protocol (repo via `deleteRecord` + index).
- **Survey delete** (`src/routes/api/surveys/[handle]/[rkey]/+server.ts`): after deleting the
  survey (and its occurrences), if it was the last survey for that protocol and the user is not
  following it, delete that protocol's surveyTargets.
- No periodic job (no infra; consent/stale-session concerns). Reconciliation sweep deferred.

## 2.5 DwC-DP export — source from surveyor targets

In the three target-bearing streaming queries (`src/lib/server/db/surveys.ts`:
`streamSurveyTargetsByProtocolUri`, `streamTargetedOccurrencesByProtocolUri`,
`streamAbsencesByProtocolUri`), change the join from `protocol_targets st ON
st.protocol_uri = s.protocol_uri` to `survey_targets st ON st.did = s.did AND
st.protocol_uri = s.protocol_uri` — sourcing from the surveyor's own durable targets so the
export survives the protocol author deleting their protocol. The occurrence match
(`o.record->>'surveyTargetID' = st.at_uri`) is unchanged (it now resolves to the surveyor's
surveyTarget), and the CSV row structure and synthesized `surveyTargetID`
(`{survey}#target#{st.at_uri}`) stay as they were — `st.at_uri` is now the surveyor's stable
surveyTarget URI. The incidental query (no target) is unchanged (`surveyTargetID IS NULL`).
**Absence semantics are preserved as-is:** notDetected is still computed against the surveyor's
*current* target set, so a target added after a survey still back-fills a phantom notDetected
onto that survey (a pre-existing behavior of the protocol-level export). Making absence
temporally correct (only targets sought as of each survey) is deferred to a near-term follow-up,
tracked in tangled issue #11 ("Export should only generate not detected for targets of the
relevant version"). `surveyID` stays per-survey (the row structure is unchanged), so the export
remains DwC-DP-valid. The unit-level CSV builders (`dwc-dp.test.ts`) are unaffected.

---

# The one-off migration tool (`migrateUser(did)`)

Core module `src/lib/server/migrate-lexicons.ts`, using `src/lib/server/pds.ts`
(`listAtRecords`, `createRecord`, `putRecord`, `deleteRecord`, `parseAtUri`) + the stored
OAuth session (writes without a live browser session), and `$lib/atUri` for URI rewriting.
Produces the **final** end state in one run. Lands as **PR3** on top of PR1+PR2; enabled only
after the single production deploy that follows PR3.

**Ordering** (leaves first so strongRef CIDs are known; reuse old rkey in the new collection
to build a stable `oldUri → {newUri,newCid}` map):

1. `surveyProtocol` → `bio.cuanto.surveyProtocol`. Record `oldUri → {newUri,newCid}`.
2. author targets `surveyTarget`(old) → `bio.cuanto.protocolTarget`: rewrite `protocol`
   at-uri; reuse rkey. Record `oldUri → newUri`.
3. `survey` → `bio.cuanto.survey`: rewrite `protocol` strongRef (`uri`+`cid`) via map. Record
   `oldUri → {newUri,newCid}`.
4. `follow` (in-place, NSID unchanged + same rkey): rewrite `subject` at-uri via map.
5. **Materialize surveyTargets**: for each protocol this user has surveys/occurrences for (or
   follows), create `bio.cuanto.surveyTarget` (reusing each protocolTarget rkey) sourcing
   `scope` from the index, `protocolTargetID` = the protocolTarget at-uri (deterministic:
   same rkey, `bio.cuanto.protocolTarget`; may dangle until that author migrates — acceptable).
6. `occurrence` (in-place, at-uri preserved): rewrite `eventID` (survey map); set
   `surveyTargetID` to the surveyor's own `bio.cuanto.surveyTarget` at-uri (same rkey as the
   old target; drop the reference if the source target is unknown/deleted); set
   `organismQuantityType` `individual-count` → `individuals`. Defer `acceptedIdentificationID`.
   Record new CID.
7. `identification` (in-place): refresh `occurrence` strongRef CID. Record new CID.
8. `occurrence` pass 2 (in-place): set `acceptedIdentificationID` strongRef CID (handles the
   occurrence↔identification cycle, mirroring `attachIdentificationToOccurrence` in
   `survey-records.ts`).
9. Delete old-NSID records: `survey`, `surveyProtocol`, old `surveyTarget` (follow + occurrence
   + identification were updated in place).
10. Reconcile the local index directly (existing inserts + delete stale rows) for immediate UI
    consistency; TAP events are the backstop. Clear `users.needs_lexicon_migration`.

Idempotent/resumable: skip already-migrated records (new-collection record with the same rkey
exists); each step safe to re-run.

**Detection / stamping:** `scripts/stamp-lexicon-migration.ts` iterates `oauth_sessions`, lists
each DID's old survey/protocol/target collections, sets `users.needs_lexicon_migration = true`
where any exist.

**Banner one-click:** add a second `Alert.Root` in `src/routes/app/+layout.svelte` (mirror the
in-progress-surveys banner) shown when the flag is set (via app layout load / `api/me`). It
POSTs to `src/routes/api/migrate-lexicons/+server.ts` → `migrateUser(locals.did)`; use the
existing `Form`/toast pattern, handle `PdsSessionExpiredError` (prompt re-auth).

**Admin script:** `scripts/migrate-lexicons.ts` iterates flagged users / stored sessions,
calls `migrateUser(did)`, logs via `src/lib/server/logger`, skips expired sessions.

# Final docs

- `docs/2026-06-06-lexicons-bio-proposals.md`: divergences to propose upstream (occurrence
  `eventID`/`surveyTargetID`; identification `vernacularName`; note `organismQuantityType`
  re-sync resolved).
- Update `docs/data_model.md` with the two-tier target model; add a short namespace-migration
  record superseding the `bio.lexicons.temp.v0-1` namespace doc.

# Verification

- `pnpm lex:gen` then `pnpm check` — clean TS; `grep -rn 'temp.v0-1' src/ tests/ scripts/`
  only in intentional migration code.
- `pnpm test:unit`, `pnpm test:integration` — fixtures updated to new NSIDs; all green.
- DwC-DP export: PR1 output is identical to today except for the target source table; PR2 output
  stays DwC-DP-valid with one target set per surveyor. Cover both in `dwc-dp.test.ts`.
- Materialization: following a protocol creates one `bio.cuanto.surveyTarget` per
  `protocolTarget`, reusing rkeys; re-follow is idempotent; targets available offline.
- GC: unfollow with no surveys deletes the surveyTargets; unfollow with surveys keeps them;
  deleting the last survey (not following) deletes them; a sought-but-not-found target (no
  occurrence) is retained while its survey exists. Integration tests for each.
- Migration tool (local Postgres + test DID, PDS_MOCK or dev PDS): seed old-NSID records, run
  `migrateUser`, assert new-collection records with rewritten refs (survey.protocol CID,
  protocolTarget.protocol uri, occurrence.eventID), surveyTargets materialized,
  `occurrence.surveyTargetID` now points at the surveyor's surveyTarget, occurrence at-uri
  preserved, `organismQuantityType === 'individuals'`, identification.occurrence CID refreshed,
  old survey/protocol/target deleted, re-run is a no-op. Unit/integration test.
- Banner: with the flag set, banner renders; one-click clears the flag and removes the banner
  (playwright for the signed-out shell; integration for the signed-in flow).
- Admin script: dry-run against one stored session in dev.
