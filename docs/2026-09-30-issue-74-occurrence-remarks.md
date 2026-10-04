# Issue #74: Occurrence remarks

Issue: <https://tangled.org/cuanto.bio/cuanto.bio/issues/74>

Follow-up to #73 (`docs/2026-09-21-survey-event-remarks.md`). Surveyors can
attach a remark to an individual counted target. It is the same
`bio.lexicons.temp.v0-1.remark` record, with `dwcTerm: "occurrenceRemarks"`,
referenced from `occurrence.occurrenceRemarksID`.

## Lexicon

The vendored `occurrence.json` has no `occurrenceRemarksID`. Rather than wait
on the full resync (#78), copy upstream's definition of that one field
verbatim (a plain `at-uri` string) and run `pnpm lex:gen`. Everything else
upstream changed stays with #78.

No `goat lex publish`: the field is on a `bio.lexicons.*` record we vendor, and
the remark collection is already in `REPO_COLLECTIONS`, so the OAuth scope does
not change and no session has to re-consent.

## Write order and rkeys

Same rule as #73: the forward reference is authoritative, so **the remark is
written before the occurrence** and deleted only once nothing points at it.

The remark reuses its occurrence's rkey, like the identification does. Survey
and occurrence rkeys are distinct TIDs, so event and occurrence remarks share
the remark collection without colliding.

- POST already derives the occurrence rkey deterministically
  (`deterministicTid(surveyRkey/targetUri)`), so the remark AT-URI is known up
  front.
- PUT creates new occurrences with `createRecord`, which picks the rkey on the
  PDS. Switch to `putRecord` at a `generateTid()` rkey so the remark can be
  written first.

`writeEventRemark`/`deleteEventRemark` generalize to a remark writer taking the
`dwcTerm`, with the same failure bargain: an ordinary failure saves the
occurrence without the remark; auth failures propagate.

## Edit semantics

Each occurrence in the PUT payload gets an optional `remark`, with the same
tri-state as the survey's `eventRemark`: undefined preserves, null or a blank
body deletes, an object replaces. On rewrite, follow the existing
`occurrenceRemarksID` rkey rather than our derived one.

The rebuild of an existing occurrence currently carries only
`acceptedIdentificationID` forward. It must also carry `occurrenceRemarksID`,
or any edit would drop the reference.

Only remarks in the surveyor's own repo are rewritten or deleted (same guard as
`ownRemarkUri` in #73).

## Decision: a deleted occurrence takes its remark with it

The issue left open whether an occurrence's remark survives the occurrence
being deleted during an edit. It does not. The lexicon says a remark nothing
references fills no term, so keeping it only leaves an orphan in the
surveyor's repo that no client will ever show. This applies to:

- an occurrence removed in an edit (`deletedOccurrenceUris`)
- a survey deleted with `deleteOccurrences` (the default)

A survey deleted with `deleteOccurrences=false` keeps its occurrences, which
still reference their remarks, so those remarks stay too.

Order: a survey DELETE removes the survey's own remark first, as in #73, so an
auth failure stops before anything else is touched and a retry finds it
intact. Occurrence remarks are different. Both survey DELETE and an edit
delete an occurrence's remark only after the occurrence (whether the remark
was cleared or the occurrence removed), and only if the occurrence's PDS
delete succeeded, so the PDS never holds a reference to a deleted remark.

Known gap: if the session expires between an edit deleting an occurrence and
deleting its remark, the auth error propagates with the occurrence already
gone. A retried PUT no longer finds that occurrence in the survey, so the
remark is orphaned. The window is two consecutive PDS calls; accepted.

## Licenses

A remark keeps the license it already has, even one we do not offer (e.g.
another client published it under something else). The form sends that
license back, the survey remark's picker lists it as its own option, and
`validateRemark` accepts a license we do not offer only when it matches the
one the remark being edited already has. The account default is looked up at
most once per request (`remarkLicenseResolver`), however many remarks need it.

## Form whitespace gotcha

The remark indicator sits between the target name and the count button. Any
whitespace before its `{#if}` becomes a text node in the row, which turned
"Vanessa 0" into "Vanessa  0" and broke the taxonomic sort spec. The markup
uses an HTML comment to swallow it.

## Read path

`attachEventRemarks` becomes `attachRemarks` and also hydrates
`occurrence.remark` from `occurrenceRemarksID`, accepting only a remark by the
surveyor whose `subject` is that occurrence and whose `dwcTerm` is
`occurrenceRemarks`. It already runs on every endpoint whose surveys the client
caches, which is the requirement #73 found.

## Form

- `PendingSurvey.occurrences[]` and the PUT occurrence inputs gain
  `remark?: { body; license? }`.
- The target sheet (tap a target's name) gets a Remarks textarea under the
  quantity, with the same byte-limit check as the survey remark. It is
  disabled until the target has a count: a target without one gets no
  occurrence, so a remark there would have nothing to describe and would be
  silently dropped. Remarks about targets that were not found (e.g. "searched
  the usual places") are a reasonable future want, but would need somewhere
  other than an occurrence to live.
- No per-occurrence license picker. A new remark gets the account default at
  upload; an edited remark keeps the license it already has (the client sends
  it back). A picker can come later if anyone wants one.
- A counted target with a remark shows a remark indicator in the list.
- `SurveyDetail` shows each occurrence's remark under it.

## Tap webhook

Already ingests remark records of any `dwcTerm` (#73). Occurrence ingestion
needs no change beyond the regenerated lexicon.

## Out of scope

- Remarks on incidentals
- `occurrenceRemarks` in the DwC-DP export (alongside #76)
- The rest of the lexicon resync (#78)
