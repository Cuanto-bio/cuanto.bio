# Issue #25: Delete a protocol

Issue: `at://did:plc:jt6xegjm6ba2lt34aztyi2mn/sh.tangled.repo.issue/3mq2xtuxya622`

## What the issue asks for

A protocol author needs to delete their protocol (DB and PDS) while:

- warning them off if surveys already reference it (advisory, not a block — see
  "Why the warning can't be enforcement" below)
- deleting `ProtocolTarget`s along with it
- leaving `SurveyTarget`s, `Survey`s, and `Occurrence`s alone
- showing a "this protocol was deleted" notice wherever a deleted protocol is
  still referenced (survey detail, and — added during planning — the Followed
  Protocols list)
- deciding what happens to other users' `bio.cuanto.surveyProtocol.follow`
  records

## What's already true in the codebase, and why it changes the plan

**The schema currently cascades the opposite of what's asked.**
`surveys.protocol_uri`, `occurrences.survey_uri` (via `surveys`), and
`protocol_targets.protocol_uri` all reference `survey_protocols(at_uri) ON
DELETE CASCADE`. A hard `DELETE FROM survey_protocols` would wipe every survey
and occurrence ever recorded under that protocol — the exact opposite of three
of this issue's own bullets. So the protocol row must never be hard-deleted;
it has to be tombstoned, same as `protocol_targets.deleted_at` (`20260717001`)
and `survey_targets.deleted_at` (`20260822001`, see
`docs/2026-08-12-issue-41-survey-target-deletion.md`). This is a third
instance of an established pattern, not a new mechanism.

**`survey_targets` already anticipated this.** Its migration comment
(`20260606003_create_survey_targets.up.sql`) says it deliberately has no FK to
`survey_protocols`/`protocol_targets` because "these records must outlive the
author's records." Nothing to build there — bullet 3 is already satisfied.

**The tap webhook has no branch for a protocol delete event.**
`src/routes/api/tap/webhook/+server.ts:308` catches `evt.action === 'delete'`
before the `PROTOCOL_NSID` branch (line 312) runs, so today a protocol delete
— from this app or any other AT Protocol client — is silently dropped. This
needs a branch alongside the existing `PROTOCOL_TARGET_NSID && action ===
'delete'` one (line 286), so protocol deletion is detected even when it
doesn't go through our UI (same lesson as #41: any client can delete the
record; the app can only react to it, not prevent it).

**The app's own delete flow should update the DB directly, not wait on the
webhook.** The existing edit flow
(`src/routes/protocols/[handle]/[rkey]/edit/+page.server.ts`) already
establishes this: when a submitted edit removes targets, it calls
`tombstoneProtocolTargetsByUris` directly, *then* loops `deleteRecord` per
target with `pdsAuthErrorFail` handling, rather than waiting for the webhook
to replay the event back. The delete flow should mirror this exactly — tombstone
first (DB), then delete PDS records, in this order:

1. Tombstone `survey_protocols` (new DB call).
2. Tombstone + `deleteRecord` each live `protocolTarget`, one at a time,
   same loop shape as the edit flow.
3. `deleteRecord` the protocol itself, last.

Deleting the protocol record last means a partial failure (e.g. target #4 of
9 fails) leaves the protocol tombstoned in our DB but still live on the PDS
with some leftover target records — recoverable and retryable, since
`com.atproto.repo.deleteRecord` is idempotent against an already-deleted
record. The alternative order (protocol first) risks the opposite: a fully
"deleted" protocol with orphaned target records nobody will ever clean up.
The webhook branch from the previous point stays as a backstop for deletes
that don't go through this flow at all.

**OAuth scope already covers this — no re-consent needed.**
`lexicons/bio/cuanto/authFull.json` grants `repo` permission on
`bio.cuanto.surveyProtocol`, `bio.cuanto.protocolTarget`, and
`bio.cuanto.surveyProtocol.follow` with no `action` field, which per the
atproto permission spec means create/update/**delete** are already granted.
The `detail`/`detail:langs` consent-screen copy doesn't mention deletion,
though — worth a copy update for honesty, as a separate small change. If
done, remember `pnpm lex:gen` doesn't affect the live consent screen for a
permission-set lexicon; it needs `goat lex publish --update` run against the
network afterward (see AGENTS.md, `docs/2026-07-05-issue-18-oauth-scopes.md`).
Not blocking this issue either way.

## Decisions made during planning

**Right to be forgotten: out of scope.** We considered hard-deleting the row,
or tombstoning-and-scrubbing `title`/`description`/`did` for privacy. Hard
delete reopens the cascade problem above and requires more schema surgery
than tombstoning, not less. Scrubbing `did` specifically doesn't achieve
anything: the DID is embedded in `at_uri` itself (which must survive for
every FK this issue requires to keep working), and is already durably
duplicated in `protocol_targets.did` and in every follower's `survey_targets`
JSONB copy — by design, since those must outlive the author's records. A real
GDPR erasure needs its own design pass across every table with a `did`
column, deciding once what's "theirs alone" vs. structurally load-bearing for
someone else's data — not something to bolt onto protocol deletion
incrementally. **Decision: no content scrubbing. Tombstone only.** File
erasure as a separate issue if/when it's actually needed.

**Other users' follow records: leave them alone (Option A).** Deleting a
`bio.cuanto.surveyProtocol.follow` "on behalf of" its owner means writing to
a repo whose owner isn't presenting a session for this request — a step
further than the existing background writes in `materialize-targets.ts`
(which maintain derived index infrastructure the follower opted into, not
delete a first-person record they wrote). Some followers' sessions will be
dead, and protocol deletion can't fail or partially roll back on that.
**Decision: don't touch other users' follow records at all.** They become
inert history in the follower's own repo — which is what the issue's own
text already concedes ("nothing left to show... other than that they
followed an unknown protocol on a date"). A lazy, in-session cleanup (Option
B: clean up a stale follow next time that user is authenticated, using their
own live session) is a reasonable future issue, not part of this one.

**The author's own follow record is a different case: delete it.** Protocols
auto-follow their own author on creation (see "auto-follow your own
protocols"), so the author reliably has a
`bio.cuanto.surveyProtocol.follow` record for the protocol they're deleting.
Unlike every other follower, the author *is* the one performing this
request, in their own live session — deleting their own follow record is
just another write to their own repo under their own standing
authorization, none of the cross-user problems above apply. **Decision:**
after the protocol and its targets are deleted, best-effort look up the
author's own follow via `getFollowByDidAndProtocol` and delete it
(`deleteRecord` + `deleteFollow`), logged-and-swallowed on failure rather
than failing the whole action — same non-fatal posture
`followProtocol` already uses for its own auxiliary
`materializeSurveyTargets` call.

**Followed Protocols must show, not hide, a deleted protocol.** Silently
omitting a tombstoned protocol from `getFollowedProtocolsByDid` would look
like an accidental unfollow, and would be inconsistent with the visible
notice this issue already requires on survey detail for the same underlying
fact. It also feeds `/api/sync`'s offline payload — omitting it would drop
the label for an in-progress offline survey against that protocol. **Decision:
expose `deletedAt` on the `Protocol` shape and show it wherever a protocol is
rendered; never filter it out of a per-user or historical list.** Only
`getProtocolsPage`/`searchProtocols` (the two functions actually behind
`ProtocolAutocomplete`'s "find a protocol to follow" surface, via
`/api/protocols`) filter it out. `getProtocolsByUris` looks similar but isn't
a discovery surface — `/routes/stats` and `/routes/surveys` use it to resolve
already-selected filter URIs into display labels, and those URIs can
legitimately point at a deleted protocol whose surveys still exist and are
still worth filtering by. Filtering there would silently blank a filter chip
for exactly the data this issue requires to keep working.

**The warning is advisory, not enforcement.** Per #41's own conclusion, we
can't prevent deletion at the app level — the record lives in the author's
repo, and any AT Protocol client can delete it regardless of what our UI
does. The confirm dialog just names the risk (surveys referencing this
protocol will keep their data but lose... this description of it).

## Implementation plan

### Schema

New migration `20260914001_add_survey_protocols_deleted_at.{up,down}.sql`,
mirroring `20260717001_add_protocol_targets_deleted_at`:

```sql
ALTER TABLE survey_protocols ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX survey_protocols_deleted_at_idx ON survey_protocols (deleted_at);
```

### `src/lib/server/db/survey-protocols.ts`

- `tombstoneProtocolByUri(atUri: string): Promise<void>` — same shape as
  `tombstoneProtocolTargetsByUris`.
- `insertProtocol`'s `ON CONFLICT DO UPDATE` should also clear `deleted_at`,
  matching `insertProtocolTarget`'s existing behavior — so a resurrected
  record (recreated at the same rkey) un-tombstones on the next create/update
  event. (A `rev`-based ordering guard against a stale/replayed event, like
  #41 built for `survey_targets`, is deliberately deferred: protocol deletion
  is a rare, deliberate action without the reconciliation traffic that made
  replay ordering matter for targets. Worth revisiting only if it turns out
  to matter in practice.)
- `toProtocol` / `ProtocolRow` gain `deletedAt`, surfaced the same way
  `followedAt`/`lastSurveyAt` are — present only when set.
- `getProtocolsPage`, `searchProtocols`, `getProtocolsByUris`: add
  `WHERE deleted_at IS NULL`.
- `getFollowedProtocolsByDid`, `getProtocolByUri`,
  `getProtocolDetailByHandleAndRkey`: **no filter** — must keep returning
  tombstoned rows so the notice can render.
- New small query, e.g. `countSurveysByProtocolUri(atUri)`, for the
  confirmation dialog's warning copy. (Not reusing `getProtocolActivity` —
  that pulls recent surveys, target stats, and per-target weekly series,
  far more than a single count needs.)

### `src/routes/api/tap/webhook/+server.ts`

Add, alongside the existing `PROTOCOL_TARGET_NSID` delete branch:

```ts
if (evt.collection === PROTOCOL_NSID && evt.action === 'delete') {
  await tombstoneProtocolByUri(atUri);
  log.info({ atUri }, 'deleted survey protocol');
  return json({ ok: true });
}
```

### Delete action

Add a `delete` form action to the existing
`src/routes/protocols/[handle]/[rkey]/edit/+page.server.ts` (it already has
the ownership check this needs) rather than a new route:

1. Re-check ownership (existing pattern in this file).
2. Tombstone `survey_protocols` via `tombstoneProtocolByUri`.
3. For each live `protocolTarget`: `tombstoneProtocolTargetsByUris([uri])`
   then `deleteRecord(uri)`, same loop/error shape as the edit action's
   existing target-deletion code (`pdsAuthErrorFail` on failure).
4. `deleteRecord` the protocol itself, last.
5. Best-effort: `getFollowByDidAndProtocol(did, atUri)`, and if found,
   `deleteRecord` + `deleteFollow` for the author's own follow. Failure here
   is logged and swallowed, not surfaced to the user — the protocol delete
   already succeeded.
6. Redirect to the protocol's own page (now showing the deleted notice), same
   `?updated=1`-style pattern the edit action uses.

### UI

- Edit page: a "Danger zone" section below the form with a Delete button
  behind `AlertDialog` (reuse `$lib/components/ui/alert-dialog`, same pattern
  as the occurrence-delete confirm in `OrphanedOccurrences.svelte`). Copy
  names the survey count from `countSurveysByProtocolUri` when nonzero.
- Wherever protocol detail is shown to a survey (survey detail page) and
  wherever `ProtocolCard`/Followed Protocols renders a protocol: show a
  notice when `protocol.deletedAt` is set. Exact placement/wording is a small
  UI decision to make while implementing, not worth over-specifying here.

### Lexicon (optional, separate small change)

Update `authFull.json`'s `detail`/`detail:langs` to mention deletion, then
`pnpm lex:gen` + `goat lex publish --update lexicons/bio/cuanto/authFull.json`
against the live network. Can ship in this branch or as its own follow-up.

## Testing plan (TDD per AGENTS.md)

Write these failing first, against unmodified code, per file:

- `survey-protocols.test.ts`: `tombstoneProtocolByUri` sets `deleted_at`;
  `insertProtocol` clears `deleted_at` on conflict; `getProtocolsPage` /
  `searchProtocols` / `getProtocolsByUris` exclude tombstoned rows;
  `getFollowedProtocolsByDid` / `getProtocolByUri` /
  `getProtocolDetailByHandleAndRkey` still return them, with `deletedAt` set.
- `webhook.test.ts`: a `PROTOCOL_NSID` delete event tombstones the row.
- `protocols-edit.test.ts` (or a new `protocols-delete.test.ts` alongside
  it): owner can delete (tombstones DB, calls `deleteRecord` for the protocol
  and each target); non-owner gets 403; **regression test that existing
  surveys and occurrences under the protocol are untouched by the delete**
  (the core bug this issue exists to prevent); a PDS failure mid-delete
  surfaces `pdsAuthErrorFail` and leaves the DB tombstoned but PDS records
  partially live (documented, not silently swallowed).
- Frontend: Playwright for the signed-out read path (deleted-protocol notice
  renders on a public survey/protocol page); a signed-in integration test for
  the confirm dialog and delete action itself.

## What shipped (implementation notes not anticipated above)

- SvelteKit doesn't allow a `default` action alongside named actions in the
  same `+page.server.ts`. Since this file needed `delete` as a named action,
  the existing edit action was renamed `default` → `save`, and
  `ProtocolForm.svelte`'s `<Form>` now passes `action={protocol ? '?/save' :
  undefined}` (undefined when creating, so `/protocols/new`'s own untouched
  `default` action still gets plain form posts).
- The AlertDialog trigger needs `page.waitForLoadState('networkidle')`
  before Playwright interacts with it, same as the existing
  `/app/protocols/following` tests do for the follow button — without it, a
  click can land before hydration attaches the listener and silently no-op.
- **Found in manual testing after the above shipped:** the DB row tombstones
  correctly (verified directly in Postgres), but `/app/protocols/[handle]/
  [rkey]` — the exact page the delete redirect lands on — showed no
  indication anything had changed. Two separate gaps, both fixed:
  - `ProtocolDetail.svelte` never rendered a deleted notice at all (only
    `SurveyDetail.svelte` and `ProtocolCard.svelte` did). Added a destructive
    `Alert.Root` above the title, gated on `protocol.deletedAt`.
  - `+page.ts` for that route only treated `?updated=1` as "the IDB cache is
    stale, fetch fresh instead of rendering it first"; the delete redirect's
    `?deleted=1` wasn't recognized, so a protocol cached before deletion
    rendered its stale pre-deletion self even with the banner code in place.
    Both params now force the fresh-fetch path (renamed the local `updated`
    flag to `forceFresh`); `+page.svelte`'s URL cleanup strips either param
    after use, same as it already did for `updated`.
  - Regression test in `tests/protocols/delete.spec.ts` seeds the IDB cache
    via a real page visit before deleting, confirmed failing without the
    `+page.ts` fix.
- **Refined further after discussion:** a plain alert on an otherwise
  unchanged page wasn't enough, in both directions:
  - Added a `gone` variant to `Alert`/`Badge` (flat dark bg/light text,
    theme-independent — not the inverting `destructive` styling, since
    nothing here is dangerous, it's just informational) and switched all
    three "deleted" indicators to it.
  - `ProtocolDetail.svelte` still showed everything else unchanged. Split
    what a protocol record's own page shows into two categories: content the
    *author* wrote (description, target list, required fields, location
    options) and prospective actions (Follow, Start Survey, Add Past
    Survey) — both now hidden when `protocol.deletedAt` is set, since a
    common reason to delete is precisely so this content stops appearing,
    and following/surveying a dead protocol going forward makes no sense.
    Kept (initially): title/handle, Edit. **Revised further**: hide those
    too — title, author handle/avatar, follower count/"Followed by", and
    the Edit link, plus the Targets and Details tabs entirely (not just
    their now-empty target list). What's left on a deleted protocol's own
    page is just the alert, the Surveys tab, and the Stats/Export actions —
    the only things describing surveyors' own data rather than the
    author's. The target list itself needed no new code either way:
    `getProtocolTargetsForProtocols` already excludes tombstoned targets,
    and every target is tombstoned as part of deleting the protocol, so it
    arrives empty already.
  - **Closed:** the edit route now returns 410 for a tombstoned protocol —
    in `load` (so direct navigation gets a real 410 page, not the form) and
    again in the `save` action (so a stale form or a direct POST can't
    silently resurrect the protocol via `insertProtocol`'s
    `deleted_at`-clearing upsert; it hits the same 410 instead of the
    success redirect). The `delete` action itself is untouched — it's
    already a no-op on an already-tombstoned protocol via
    `tombstoneProtocolByUri`'s own `deleted_at IS NULL` guard, so no
    resurrection risk there.
- Confirm dialog and Danger Zone are now collapsed behind an initial
  centered "Delete protocol" (outline, not destructive) button rather than
  showing by default — three clicks total to actually delete, not a
  shortcut. Delete copy also dropped "PDS" for plain language, and now
  states explicitly that other people's surveys/stats are unaffected and
  that only *new* surveys against the protocol are blocked. The dialog's
  own "Delete" action uses `variant="destructive"`.
- Added a `gone` Alert/Badge variant (flat dark, theme-independent — not
  `destructive`'s inverting light/dark pair) at the user's request, for a
  fact that isn't dangerous, just informational.

### `/code-review high` findings and fixes (post-ship)

- **Correctness, confirmed and fixed:** the `delete` action tombstoned each
  DB row (`tombstoneProtocolByUri`, and each target's
  `tombstoneProtocolTargetsByUris`) *before* confirming the matching PDS
  delete succeeded. A failure partway through left a target (or the
  protocol itself) tombstoned in the DB with its PDS record still live and
  no code path back to it: `getProtocolDetailByHandleAndRkey`'s live-only
  view drops a tombstoned row, so a retry would never see it again to
  finish deleting it, and for the protocol itself, `load`'s 410 would also
  cut off the only UI path back to retry. Fixed by moving each tombstone to
  after its own confirmed PDS delete (targets batched into one
  `tombstoneProtocolTargetsByUris` call for the ones actually deleted, not
  the whole set upfront). Caught a self-inflicted test-isolation bug while
  fixing this: two new unit tests used `mockImplementation`, which (unlike
  `mockResolvedValueOnce`) persists across tests since this file's
  `beforeEach` only `clearAllMocks`, not `resetAllMocks` — leaked into and
  broke an unrelated later test until switched to chained `Once` calls.
- **Correctness, confirmed and fixed:** `getProtocolsPageByDid` (backs
  `/protocols/[handle]`, an author's public protocol list) never selected
  `deleted_at`, so a deleted protocol showed there as fully live with no
  badge — missed when the other three protocol-fetching functions were
  updated earlier in this issue.
- **Correctness, confirmed and fixed:** `/app/surveys/[handle]/[rkey]/+page.ts`
  (the signed-in survey page) only fetched a protocol when nothing was
  cached at all, unlike the survey object right above it in the same
  function, which always refreshes in the background. A protocol cached
  before deletion would never show the "Deleted" badge, potentially
  forever. Brought in line with the survey's own pattern.
- **Style nit, confirmed and fixed:** subject-verb agreement in the delete
  warning copy ("1 survey already reference it").
- **Not acted on:** a flag that the `gone` variant's hardcoded colors skip
  AGENTS.md's theme-token rule without asking the user first — the user did
  ask for exactly this treatment earlier in this same conversation, which
  the reviewer had no way to see from the diff alone.
- **Efficiency, out of scope:** N sequential `tombstoneProtocolTargetsByUris`
  calls instead of one batched call — resolved as a side effect of the
  correctness fix above, which had to restructure this loop anyway.

Regression tests for all four fixed findings live in
`protocols-edit.test.ts`, `tests/protocols/delete.spec.ts`, and
`survey-detail.test.ts`, each confirmed failing against the unfixed code
first.

## Out of scope

- Full GDPR-style erasure (delete all of a user's content without touching
  anyone else's) — needs its own design pass across every table with a `did`
  column. File separately if/when needed.
- Lazy in-session follow-record cleanup (Option B) — future issue, not
  blocking this one.
