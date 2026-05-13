# Incidental Occurrences Design

**Date:** 2026-05-05
**Status:** Draft

## Overview

Surveyors regularly encounter organisms outside a protocol's defined targets. This spec covers "incidentals" — occurrences a user adds during a survey that have no `surveyTargetID` but whose `eventID` points to the Survey. These must work both online and offline.

This spec assumes two prerequisites are completed first:
- **Spec A**: Namespace migration from `bio.lexicons.temp.*` to `bio.lexicons.temp.v0-1.*`
- **Spec B**: Server creates Identification records alongside Occurrences and sets both `taxonID` and `acceptedIdentificationID` on each Occurrence

## Out of scope

Ambiguous or unidentifiable incidentals (e.g. `verbatimIdentification`, `occurrenceRemarks`) are deferred to future work.

## Local data model

`PendingSurvey` gains a new optional field that defaults to `[]` on read for old records, requiring no IDB version bump:

```ts
interface IncidentalOccurrence {
  localId: string;       // client-generated uuid; stable UI key
  placeholder?: string;  // free text entered offline; seeds autocomplete on resolution
  taxonID?: string;      // e.g. "https://www.inaturalist.org/taxa/12345"
  scientificName?: string;
  taxonRank?: string;
  vernacularName?: string;
  kingdom?: string;
  organismQuantity?: string;
}
```

An incidental is **unresolved** when `taxonID` is absent. The existing `occurrences[]` shape is unchanged.

## UI

### Adding a custom target

An "Add incidental" button sits below the protocol target list, always visible regardless of connectivity. Tapping it opens the existing Sheet/Dialog component with two modes:

- **Online**: a taxon autocomplete field hitting the existing `/api/taxa` endpoint, showing `vernacularName (scientificName)` suggestions. Selecting a result populates all taxon fields. Organism quantity input below.
- **Offline**: a plain text "What did you see?" field that captures `placeholder`. Organism quantity input below. Saving creates an unresolved incidental.

### Incidentals section

Incidentals appear in an "Incidentals" section below the protocol targets. Each row shows:
- Resolved: taxon name (vernacular + scientific) + count badge
- Unresolved: `placeholder` text in muted/italic style with an unresolved indicator

Tapping a row opens the Sheet/Dialog to edit it. If unresolved and the user is now online, the autocomplete is pre-seeded with `placeholder`. A delete action is available in the detail view. The count badge increments on tap, same as protocol targets.

## Submission blocking

`finish()` checks `incidentals.some(i => !i.taxonID)` before showing the finish confirmation dialog. If unresolved incidentals exist:

- The dialog is suppressed and an inline error appears instead.
- Unresolved rows are highlighted in the "Incidentals" section.
- Tapping an unresolved row opens the sheet with the autocomplete pre-seeded from `placeholder`. Resolution clears the error.

`uploadAllPending()` skips surveys with unresolved incidentals during background upload sweeps, alongside the existing skip for incomplete surveys.

**Resume flow**: a user who enters a placeholder offline, saves the draft, and returns online can resolve placeholders normally through the resume path — no special handling needed.

## Server API

`POST /api/surveys` accepts an optional `incidentals` field (absent treated as `[]`):

```ts
type IncidentalInput = {
  taxonID: string;
  scientificName: string;
  taxonRank: string;
  vernacularName?: string;
  kingdom?: string;
  organismQuantity?: string;
};

// Added to SurveyInput:
incidentals?: IncidentalInput[];
```

Any incidental missing `taxonID` or `scientificName` is rejected with 422. (The client blocks submission before this point, so this is a safety check.)

For each incidental the server:
1. Creates an **Occurrence** record on the PDS — `eventID` points to the survey, no `surveyTargetID`; `taxonID` set from the input (known before any PDS writes).
2. Creates an **Identification** record on the PDS — `occurrence` is a strongRef to step 1; `scientificName`, `taxonRank`, `kingdom` from input; `taxonID` and `vernacularName` as Cuanto extensions.
3. Updates the Occurrence on the PDS to set `acceptedIdentificationID: { uri, cid }` (strongRef) pointing to the Identification from step 2.
4. Both records are stored in Postgres.

This mirrors the pattern Spec B establishes for protocol occurrences, minus `surveyTargetID`.

## Testing

- **Unit tests**: helper checking for unresolved incidentals; `PendingSurvey` read path defaulting `incidentals` to `[]` for old records.
- **Integration tests**:
  - Online: add a custom target via autocomplete, finish survey, verify Occurrence and Identification created with correct taxon data and no `surveyTargetID`.
  - Offline: add a custom target with a placeholder, verify finish is blocked; go online, resolve, verify successful submission.
  - Regression: existing protocol occurrence tests pass unchanged.
