# Taxonomic sort mode for survey targets (issue #81)

https://tangled.org/cuanto.bio/cuanto.bio/issues/81

Split out from https://tangled.org/cuanto.bio/cuanto.bio/issues/10 (author-defined
target order). #10 stays open for field-guide / route ordering that only an author
can express; this issue is the surveyor-facing sort mode.

## Goal

Add a "Taxonomic" option to the target sort dropdown that groups targets by
classification: species in a genus together, genera in a family together, up to
kingdom. A higher-rank target (e.g. genus *Vanessa*) sorts directly above its
descendants. Within a level, order is alphabetical. Phylogenetic sequence (e.g.
bird checklist order) is out of scope.

## Approach

Store classification on the record using the Darwin Core rank terms, not resolved
client-side:

- `taxonScope` can hold taxa from any authority. A client-side resolver would need
  one implementation per authority; record fields are authority-neutral, since
  whoever writes the target fills them in from their own source.
- It follows the existing `kingdom` field.
- It works offline with no extra requests, and it travels with the record to any
  other consumer.

Classification reaches records two ways, both for iNat taxa only:

1. **New targets, automatically on save.** The new and edit save actions add
   classification to targets being created. That covers every add path
   (autocomplete, bulk paste, iNat place import) and costs no extra PDS writes.
2. **Existing targets, via a button** in the protocol edit form. It fills in
   classification in form state, and the author saves as usual. Backfilling means
   one `putRecord` per target, since each target is its own record, so it happens
   when the author asks for it rather than as a side effect of any save.

### Why surveyTarget propagation doesn't matter here

Sync never refreshes a surveyTarget's `scope`
(`src/lib/server/materialize-targets.ts:138` reuses the surveyTarget's own copy).
That's fine: the survey form and survey detail both sort `protocol.targets`, which
are protocolTargets (`SurveyForm.svelte:480`, `SurveyDetail.svelte:98`; `Target`
in `src/lib/offline/db.ts:21` wraps `AtProtocolTarget`). Once a protocolTarget is
re-indexed with classification, surveyors see it on their next protocol sync.

### Verified iNat behavior (2026-09-28)

- The search form, `GET /v2/taxa?id=<ids>&per_page=500`, accepts 500 ids in one
  request but **ignores `ancestors` in `fields`**. It does return `ancestor_ids`
  (which end with the taxon's own id). An earlier draft of this plan got this
  wrong: that check counted results without looking at their fields.
- The path form, `GET /v2/taxa/<ids>?fields=id,ancestors.rank,ancestors.name`,
  returns ancestors but accepts at most 30 ids (`422 Too many IDs` at 31).
- So classifications take two searches: `fields=id,ancestor_ids` for the taxa,
  then `fields=id,name,rank` for the unique ancestor ids. For 500 swallowtail
  and brush-footed butterfly species that was 838 unique ancestors, so about 3
  requests in all, against 17 with the path form.
- `GET /v2/observations/species_counts` ignores `fields=taxon.ancestors.*`.
- `ancestors` excludes the taxon itself, and includes ranks Darwin Core has no term
  for (subphylum, subclass, infraorder, ...), which we ignore.

### Verified Darwin Core terms (2026-09-28, https://dwc.tdwg.org/list/)

Rank terms: `kingdom`, `phylum`, `class`, `order`, `superfamily`, `family`,
`subfamily`, `tribe`, `subtribe`, `genus`, `subgenus`. Each field stores the name as
the source gives it
(for iNat, the ancestor's `name`).

`subgenus` deliberately holds the bare subgenus name (e.g. `Parastygis`), not the
genus-qualified form in the dwc:subgenus examples (`Abacetus (Parastygis)`,
`Dicranum subgen. Orthodicranum`). Those forms follow each nomenclatural code's
citation style, and a protocol can mix taxa from several codes; the genus is
already in `genus`.

## Decisions (settled 2026-09-28)

1. All eleven Darwin Core rank terms, all optional.
2. Backfill of existing targets is an explicit button; new targets are classified
   on save.
3. Protocols that are never backfilled keep their targets in the "unclassified"
   group at the end of the taxonomic sort. No index-time or client-side fallback.
4. Integration tests mock iNat with an `INAT_MOCK=true` env flag, following
   `PDS_MOCK` (`src/lib/server/pds.ts:208`): the iNat calls are made by the server,
   so Playwright's `page.route` can't intercept them.

## Implementation steps

TDD throughout: write each unit's tests first and confirm they fail.

### 1. Lexicon

`lexicons/bio/cuanto/protocolTarget.json`, `taxonScope.properties`: add optional
string fields `phylum`, `class`, `order`, `superfamily`, `family`, `subfamily`,
`tribe`, `subtribe`, `genus`, `subgenus`. Describe each as the Darwin Core term of
the same name, e.g. "Full scientific name of the family in which the taxon is
classified, following dwc:family." The `subgenus` description should say it holds
the subgenus name alone, without the genus. Mention in the `taxonScope`
description that these fields drive taxonomic grouping.

- `pnpm lex:gen`, then confirm the generated TS in `src/lib/lexicons/` compiles
  with `class` and `order` as property names.
- No `goat lex publish`: this isn't a permission set.
- `surveyTarget` refs `protocolTarget#taxonScope`, so it picks up the fields
  automatically.

### 2. Shared, client-safe helpers (`src/lib/targets.svelte.ts`)

- `CLASSIFICATION_RANKS`: the eleven ranks, highest first, `as const`, plus
  `type ClassificationRank` and `type Classification = Partial<Record<ClassificationRank, string>>`.
- `needsClassification(scope)`: true when the first scope entry is a taxon scope,
  its `taxonID` matches `https://www.inaturalist.org/taxa/<digits>`, it has no rank
  field other than `kingdom`, and its `taxonRank` isn't `kingdom` or `phylum`
  (at most a kingdom sits above those, so there is nothing more to add).
- `inatTaxonNumber(taxonID)`: parses the numeric id, or returns undefined.
- `withClassification(scope, classification)`: returns a new scope array with the
  classification merged into `scope[0]`. **Adds missing fields only; never
  overwrites** a value already on the record (including `kingdom`).
- Tests in `src/lib/targets.test.ts` for all three.

### 3. iNat classification fetch (`src/lib/inat.ts` + new server module)

- `src/lib/inat.ts`: `classificationFromAncestors(ancestors)` maps
  `{ rank, name }[]` to a `Classification`, keeping only Darwin Core ranks and
  storing each ancestor's `name` as is. Unit tests.
- New `src/lib/server/inat-taxa.ts`:
  `fetchInatClassifications(ids: number[]): Promise<Map<number, Classification>>`.
  - Makes the two searches described under "Verified iNat behavior", each in
    chunks of 500 ids, with the same `User-Agent` as `/api/taxa`.
  - Throws on a non-OK response; callers decide how to degrade.
  - When `process.env.INAT_MOCK === 'true'`, returns canned classifications from a
    fixture map in `src/lib/server/inat-mock.ts` without any HTTP call. Unknown ids
    are simply absent, as they would be from iNat. Put a comment on the flag
    explaining why it exists, mirroring the `PDS_MOCK` one.
  - Tests: chunks 501 ids into two requests; parses ancestors; throws on 5xx;
    the mock path makes no fetch.

### 4. Classify new targets on save

- New helper in `src/lib/server/inat-taxa.ts`:
  `classifyTargets<T extends { scope: unknown[] }>(targets: T[]): Promise<T[]>`. It
  applies `needsClassification`, `fetchInatClassifications`, and
  `withClassification`. On a fetch error it logs a warning via `$lib/logger` and
  returns the targets unchanged, so a save never fails because iNat is down.
- `src/routes/protocols/new/+page.server.ts`: classify all parsed targets before
  building records.
- `src/routes/protocols/[handle]/[rkey]/edit/+page.server.ts`: classify only
  `toAdd` (targets without `atUri`). Existing targets are left as submitted, so a
  save never rewrites untouched records.
- Tests in `protocols-new.test.ts` / `protocols-edit.test.ts`: `vi.mock` the new
  module (as `$lib/server/pds` is mocked there). Assert that new targets reach
  `createRecord` classified, that existing unchanged targets produce no
  `putRecord`, and that a classification failure still saves.

### 5. Backfill button

- New endpoint `GET /api/taxa/classifications?ids=1,2,3` returning
  `{ results: { [id]: Classification } }`, via `fetchInatClassifications`.
  Respond 422 on a missing, malformed, or >500-id list (per project convention for
  input validation), and 502 when iNat fails. Unit tests in the style of
  `src/routes/api/taxa/taxa.test.ts`.
- `src/lib/components/ProtocolForm.svelte`, edit mode only: in the targets section,
  when `targets.filter(t => needsClassification(t.scope)).length > 0`, show a
  secondary button, e.g. "Add taxonomy to 12 targets". Look for a fitting shadcn
  pattern (Button with a loading state; an Alert or muted text for the result).
  On click: fetch in chunks of 500, apply `withClassification` to the matching
  targets in form state, and report "Added taxonomy to N targets. Save to keep
  it." or an error. The existing unsaved-changes guard then treats the change
  like any other edit, and the normal save writes the changed targets via the
  existing `toUpdate` diff.
- Hide the button once nothing needs classification. Targets iNat couldn't
  resolve stay eligible, so it may still show a smaller count; say so in the
  result message.

### 6. Sort

`src/lib/targets.svelte.ts`:

- `TargetSort` gains `'taxonomic'`.
- `taxonomicSortKey(scope): string[] | null`:
  - `null` for verbatim targets, and for taxon targets with no rank field beyond
    `kingdom` unless their own `taxonRank` is `kingdom` or `phylum` (the
    unclassified group).
  - Otherwise, the eleven rank values in `CLASSIFICATION_RANKS` order, with missing
    ones as `''`. If `taxonRank` is one of the eleven, put `scientificName` in that
    slot and truncate after it (`ancestors` excludes self, so a genus target has no
    `genus` field). Otherwise append `scientificName`.
  - Resulting behavior: genus *Vanessa* `[…, Nymphalidae, Nymphalinae, Nymphalini, '', Vanessa]`
    is a prefix of *Vanessa cardui*, so it sorts first. A target at a rank Darwin
    Core lacks (e.g. subclass) has empty lower slots and sorts at the top of its
    parent group. An empty slot sorts before any name, so a taxon lacking an
    intermediate rank sorts ahead of its siblings that have one.
- The `taxonomic` branch of `sortTargets` orders three groups: classified targets
  (element-wise `localeCompare`, shorter prefix first, tiebreak on
  `scientificName`), then unclassified taxon targets by `scientificName`, then
  verbatim targets by `verbatimTargetScope`.
- Tests in `src/lib/targets.test.ts`: species grouped under genus under family;
  genus target directly above its species; family target above its genera;
  subfamilies keep their genera together within a family; a target at a non-DwC
  rank sorts at the top of its parent; unclassified taxa after classified;
  verbatim last; `restoredState: { targetSort: 'taxonomic' }` round-trips.

### 7. Sort UI

`src/lib/components/TargetFilterControls.svelte`: add
`<DropdownMenu.RadioItem value="taxonomic">Taxonomic</DropdownMenu.RadioItem>`
after "Common name".

### 8. Integration tests

- `playwright.config.ts`: add `INAT_MOCK: 'true'` to `webServer.env`. Give
  `inat-mock.ts` classifications for the iNat taxon ids used in
  `tests/fixtures.ts` and by the new tests.
- `tests/survey/targets.spec.ts`, in the "target sort and filter dropdown" block:
  seed a protocol whose targets already carry classification. For example: genus
  *Vanessa*, *Vanessa cardui*, *Danaus plexippus* (also Nymphalidae, different
  subfamily), *Papilio glaucus* (Papilionidae), a taxon with no classification,
  and a verbatim target. Choose "Taxonomic" and assert the row order. This may
  need a new fixture or an option on `seedProtocol` in `tests/fixtures.ts`.
- `tests/protocols/editing.spec.ts`:
  - Adding a new taxon target (autocomplete result mocked with `page.route` as in
    `search.spec.ts`) and saving stores it with classification from the mock.
  - Backfill: a protocol with unclassified iNat targets shows the button with the
    right count. Clicking it and saving stores the classification, and the button
    goes away.
  - A save without using the button leaves existing targets unchanged.

### 9. Checks

`pnpm check`, `pnpm format`, `pnpm test:unit`, `pnpm test:integration`.

### 10. Rollout

After deploy, open each existing production protocol's edit page and use the
button (or ask its author to). Worth a note on #81 when closing it.

## Out of scope / follow-ups

- Copying the new ranks onto Identification records in
  `src/lib/server/survey-records.ts:38`, which copies `kingdom` today. That depends
  on whether the occurrence lexicon wants them; separate issue.
- Author ordering (#10) and a `defaultTargetSort` protocol field.
- Classification for non-iNat authorities. The record fields support it; no UI
  adds such taxa yet.
