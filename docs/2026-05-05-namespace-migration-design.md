# Spec A: Namespace Migration — `bio.lexicons.temp.*` → `bio.lexicons.temp.v0-1.*`

**Date:** 2026-05-05
**Status:** Draft

## Overview

The upstream lexicons.bio repository version-namespaces its lexicons under
`bio.lexicons.temp.v0-1.*`. This spec migrates the Cuanto project to use that namespace
and to adopt any upstream field changes (e.g. `acceptedIdentificationID`).

Changes to lexicons.bio itself are out of scope; they are tracked separately upstream.

This spec is a prerequisite for the Incidental Occurrences feature (Spec B).

## Prerequisite

The following lexicons must exist in `../lexicons.bio/lexicons/bio/lexicons/temp/v0-1/`
before executing this spec:

- `occurrence.json` — already exists; must include `surveyTargetID`, `eventID`, and
  `organismQuantity` fields in addition to the already-landed `taxonID` and
  `acceptedIdentificationID`.
- `identification.json` — already exists with `taxonID`.
- `media.json` — already exists.
- `survey.json`, `surveyTarget.json`, `surveyProtocol.json` — proposed upstream; under
  review.

## Migration steps

1. **Copy JSONs** — copy all six files from
   `../lexicons.bio/lexicons/bio/lexicons/temp/v0-1/` into
   `lexicons/bio/lexicons/temp/v0-1/`:
   `occurrence`, `identification`, `media`, `survey`, `surveyTarget`, `surveyProtocol`.

2. **Remove old files** — delete the flat `bio.lexicons.temp.*` JSON files:
   `lexicons/bio/lexicons/temp/{occurrence,survey,surveyTarget,surveyProtocol}.json`.

3. **Regenerate TypeScript** — run `pnpm lex:gen`. This rebuilds `src/lib/lexicons/`
   from scratch, producing new modules under `bio/lexicons/temp/v0-1/`.

4. **Update source references** — two passes across all `.ts` and `.svelte` files:
   - Find-and-replace `bio.lexicons.temp.` → `bio.lexicons.temp.v0-1.` (namespace
     prefix). Import paths change from `$lib/lexicons/bio/lexicons/temp/occurrence` to
     `$lib/lexicons/bio/lexicons/temp/v0-1/occurrence`, etc.
   - Find-and-replace `identificationID` → `acceptedIdentificationID` where it refers
     to the Occurrence field. The local lexicon used the old name (string, at-uri); the
     upstream uses `acceptedIdentificationID` (ref to `com.atproto.repo.strongRef`).

5. **Fix type breakage** — run `pnpm check` to surface any missed references,
   including `$type` literals and `at-uri` fixture strings in tests.

## Testing

No new test logic is required — this is a namespace rename plus field rename with no
behavioral change.

- **`pnpm check`** — TypeScript must pass cleanly.
- **Fixture strings** — test files containing hardcoded `at-uri` strings and `$type`
  literals get the same find-and-replace treatment as source files.
- **`pnpm test`** — all existing unit and integration tests must pass unchanged. A
  failing test indicates a missed reference.

No data migration is needed; there are no production records under the old NSIDs.
