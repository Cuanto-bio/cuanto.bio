# Spec B: Identification Records for Protocol Occurrences

**Date:** 2026-05-05
**Status:** Draft

## Overview

When the server creates Occurrence records during survey submission it does not yet
create the companion Identification AT record, leaving `acceptedIdentificationID` unset on
every Occurrence. This spec adds that missing step so both `taxonID` and
`acceptedIdentificationID` are populated, improving compatibility with other lexicons.bio apps.

## Prerequisites

- **Spec A** (namespace migration `bio.lexicons.temp.*` → `bio.lexicons.temp.v0-1.*`)
  must be completed first. All NSID references in this spec use the post-migration
  namespace.

## Prerequisite: lexicons.bio

`identification.json` in `bio.lexicons.temp.v0-1` must have the following optional field
before this spec is executed (lexicons.bio changes are tracked upstream):

| Field | Type | Format | Description |
|---|---|---|---|
| `vernacularName` | string | — | Common name at time of identification (maxLength 256) |

`taxonID` is already present upstream. Running `pnpm lex:gen` after Spec A copies the
updated file regenerates the TypeScript bindings.

## Postgres migration

New table `identifications`, following the same shape as `occurrences`:

```sql
CREATE TABLE identifications (
  at_uri         TEXT        PRIMARY KEY,
  did            TEXT        NOT NULL,
  rkey           TEXT        NOT NULL,
  occurrence_uri TEXT        NOT NULL REFERENCES occurrences(at_uri),
  record         JSONB       NOT NULL,
  indexed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Migration files: `20260505001_create_identifications.up.sql` /
`20260505001_create_identifications.down.sql`.

## DB module

New `src/lib/server/db/identifications.ts` exports a single function:

```ts
insertIdentification(did, rkey, record, atUri): Promise<void>
```

Upserts on `at_uri` conflict, consistent with `insertOccurrence` and `insertSurvey`.

## Survey submission — `POST /api/surveys`

### Pre-fetch step (before the occurrence loop)

Query `survey_targets` for all `surveyTargetUri` values in the submission in one
query. Build a `Map<string, TaxonScope>` keyed by target AT-URI, skipping entries
whose scope contains no `TaxonScope`.

### Per-occurrence logic

**No `TaxonScope` found** (verbatim-scoped or unknown target): create Occurrence as
today — no Identification is created.

**`TaxonScope` found:**

1. `createRecord(occurrence)` — same fields as today (`surveyTargetID`, `eventID`,
   `taxonID`, `organismQuantity`) → `{ uri: occUri, cid: occCid }`.
2. `createRecord(identification)` with:
   - `occurrence: { uri: occUri, cid: occCid }` (strongRef)
   - `scientificName`, `taxonRank`, `kingdom`, `taxonID`, `vernacularName` from the
     `TaxonScope` (omitting absent optional fields)
   → `{ uri: identUri, cid: identCid, rkey: identRkey }`.
3. `putRecord(occurrence with acceptedIdentificationID: { uri: identUri, cid: identCid })`
   at `occRkey` — updates the Occurrence AT record on the PDS.
4. `insertOccurrence(did, occRkey, updatedRecord, occUri)` — stores the final record
   (now carrying `identificationID`) in Postgres.
5. `insertIdentification(did, identRkey, identRecord, identUri)`.

If step 2 or 3 fails the error is logged and the loop continues; the Occurrence
exists on the PDS without `identificationID`, which is acceptable.

> **Future work:** Each taxon-scoped occurrence now requires 3 sequential PDS writes.
> This is fine for typical protocol sizes but will become a bottleneck for large
> surveys. A background queue for PDS writes should be considered at that point.

## Tap webhook — Identification ingestion

Add `IDENTIFICATION_NSID = 'bio.lexicons.temp.v0-1.identification'` to the constants
block.

### On create

Call `insertIdentification`. On FK violation (occurrence not yet in Postgres):

1. Extract `occurrence.uri` from the Identification record.
2. `fetchAtRecord(occurrenceUri)` to get the Occurrence and its `eventID` (survey URI).
3. `backfillSurvey(surveyUri)` — this ingests the survey, its occurrences, and (via
   the extended `ingestOccurrencesForSurvey` below) any Identifications for those
   occurrences.
4. Retry `insertIdentification`.

### On delete

No action (Identifications are treated as append-only in this model).

### Extended `ingestOccurrencesForSurvey`

After inserting occurrences, call `listAtRecords(did, IDENTIFICATION_NSID)` to
fetch all Identification records for the DID (no server-side filter is available),
filter client-side to those whose `occurrence.uri` matches any of the just-inserted
occurrence URIs, and call `insertIdentification` for each.

## Testing

**Unit tests:**
- `insertIdentification` — inserts correctly, upserts on `at_uri` conflict.

**Integration tests:**
- Submit a survey with a taxon-scoped occurrence; verify the Occurrence row in
  Postgres has `identificationID` set and a matching row exists in `identifications`
  with correct `scientificName`, `taxonID`, and `vernacularName`.
- Submit a survey with a verbatim-scoped occurrence; verify no row is created in
  `identifications`.
- Tap webhook receives an Identification create event; verify it lands in
  `identifications`.
- Tap webhook receives an Identification whose occurrence is not yet in Postgres;
  verify backfill runs and both records are stored.
- Regression: all existing survey submission and tap ingestion tests pass unchanged.
