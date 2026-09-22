# Issue #73: Survey event remarks

Issue: <https://tangled.org/cuanto.bio/cuanto.bio/issues/73>

## What this adds

lexicons.bio added `bio.lexicons.temp.v0-1.remark`: free text that fills a
Darwin Core `*Remarks` term on another record, kept as its own record so
authored prose, a potential creative work, can be attributed and licensed
separately from the facts in the record it describes.

Surveyors can now write a note on a survey. The note becomes a Remark record
with `dwcTerm: "eventRemarks"` whose `subject` is the survey, and the survey
points back at it through a new `bio.cuanto.survey.eventRemarksID`.

## The forward reference is what counts

The lexicon is explicit that the forward reference is authoritative: "a remark
nothing references fills no term." So `survey.eventRemarksID` is the only thing
the read path follows. `remarks.subject_uri` exists for indexing a subject's
remarks and for spotting a reference that points at the wrong record, but it is
never the basis for displaying a note.

That decides the write order everywhere: **write the remark first, then the
survey**, so the survey never names a record that does not exist.

## Why there is no third write

The occurrence/identification pair solves the same circularity with three
writes: create the occurrence, create the identification pointing back at it,
then re-write the occurrence with a forward strongRef
(`src/lib/server/survey-records.ts`).

A remark needs only two, because both AT-URIs are known before either write.
The survey's rkey is client-chosen (#13) and the remark reuses it, exactly as an
identification reuses its occurrence's rkey. Different collection, so no key
collision, and `putRecord` at a stable key means a retried POST overwrites
instead of creating a second remark.

On edit, the rkey comes from the existing `eventRemarksID` rather than from the
survey, since another client may have written the remark at a key of its own
choosing and overwriting our derived key would orphan that record.

## Failure behavior

`writeEventRemark` returns null on an ordinary failure, and the survey saves
without a note: the same bargain as an identification that fails to attach to
its occurrence, where losing the extra record must not cost the surveyor the
observation.

Auth failures are the deliberate exception and propagate. Widening the OAuth
scope (below) invalidates every existing session, so swallowing that error would
save the survey and silently drop the note on exactly the sessions that need to
re-consent. It reaches the route's 403 `pds_permission_required` instead.

## The OAuth scope widens, so every session re-consents

`bio.lexicons.temp.v0-1.remark` joins `REPO_COLLECTIONS` in
`src/lib/server/auth.ts`. `isScopeSufficient` defaults its required scope to the
whole `SCOPE` string and requires every `repo:` collection in it, so **every
already-signed-in user must reconnect before their next PDS write.** There is no
way to write a new collection without this. The handling path already exists
(commit `3545406`); `src/lib/server/auth.test.ts` now asserts the stale grant is
rejected rather than leaving it to be discovered in production.

No `goat lex publish` was needed: `authFull.json` covers `bio.cuanto.*` only,
and `bio.lexicons.*` collections are granted as plain `repo:` scopes.

## Licensing

The remark lexicon's `license` takes a license *document URI*
(`https://creativecommons.org/licenses/by/4.0/`), not an SPDX identifier. Note
that the vendored `media.json` still uses SPDX ids; upstream has since changed
that and we have not resynced (#78). The two are not interchangeable.

The surveyor picks one default on `/app/account`
(`users.default_remark_license`), and the **server** stamps it onto the record
rather than the client sending it, so a survey drafted offline days ago
publishes under whatever default is in force when it finally uploads. A stored
value we no longer offer degrades to CC0 rather than reaching the PDS. A
per-record picker is #75.

## `remarks` has no foreign key, on purpose

Like `survey_targets`, and for three reasons: a remark can name any record as
its subject, tap can deliver a remark before the record it describes, and
`surveys` already cascades from `survey_protocols` in a way that would silently
take remarks with it. The tap branch therefore needs no backfill: an early
remark simply lands and waits to be pointed at.

The webhook also ingests terms we do not consume yet (`occurrenceRemarks`, #74)
rather than dropping them, since another client may already be writing them and
a 500 there stalls every queued record behind it.

## Every cacheable survey payload has to carry the note

Found while writing the integration tests, and the one non-obvious bug in this
change. `syncOfflineData` runs on every `/app` navigation and `cacheSurvey`
replaces the whole IndexedDB entry, so a payload missing the note strips it from
a copy another route had already cached in full. Opening the edit form then
showed an empty textarea, and saving would have deleted the note the surveyor
never touched.

So hydration lives in a shared `attachEventRemarks`
(`src/lib/server/db/surveys.ts`) applied by every endpoint whose surveys the
client caches: `getSurveyDetailByHandleAndRkey`, `GET /api/sync`, and
`GET /api/surveys`. The public `getSurveysPage` list is deliberately left alone;
nothing caches from it and the list does not show notes.

## Deploy note

`TAP_COLLECTION_FILTERS` must gain `bio.lexicons.temp.v0-1.remark`. The Railway
value is set in the dashboard, not in the repo (`.railway/railway.ts` uses
`preserve()`), so updating `compose.yml` and `README.md` does not update prod.

## Out of scope, filed separately

- #74 occurrence-level remarks (blocked on #78 for `occurrenceRemarksID`)
- #75 per-record license picker
- #76 `eventRemarks` in the DwC-DP export
- #77 `bio.cuanto.protocolTarget` missing from `TAP_COLLECTION_FILTERS`
  (pre-existing, found while planning this)
- #78 resync the vendored lexicons.bio schemas with upstream
