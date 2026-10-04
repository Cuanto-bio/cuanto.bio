# Divergences to propose upstream to lexicons.bio

**Date:** 2026-06-06

We keep `occurrence` and `identification` on the upstream lexicons.bio NSID
(`bio.lexicons.temp.v0-1.*`) and stay in sync with upstream, but carry a few
local-extension fields the app needs. These are tracked here as changes to
propose upstream so our records stay interoperable rather than permanently
forked.

**Last synced:** 2026-09-30, upstream commit
[`38fc0db`](https://github.com/lexicons-bio/lexicons.bio/commit/38fc0dbfdf9a75e04db5a8e0d76e262cd89cb8b5).
Apart from the local extensions below, our copies of `occurrence`,
`identification`, `media`, and `remark` under `lexicons/bio/lexicons/temp/v0-1/`
match upstream. To resync, copy upstream's files over ours, re-add the
extensions below, and run `pnpm lex:gen`. `src/lib/lexicons-bio.test.ts` fails
if an extension is dropped.

## occurrence (`bio.lexicons.temp.v0-1.occurrence`)

- **`eventID`** (string, `at-uri`) — the Event (e.g. a Survey) this Occurrence
  was part of, sensu DwC `dwc:eventID`. Upstream dropped it; we rely on it to
  link occurrences to surveys.
- **`surveyTargetID`** (string, `at-uri`) — the SurveyTarget this Occurrence was
  intended to satisfy (observer intent / absence semantics). Upstream dropped it.

Both link an occurrence into the survey/target graph. They reference records in
our `bio.cuanto.*` namespace, so if upstream prefers not to adopt them we keep
them as documented local extensions.

## identification (`bio.lexicons.temp.v0-1.identification`)

- **`vernacularName`** (string, maxLength 256) — common name at time of
  identification. Upstream dropped it; the app writes and displays it.

## Resolved

- **`organismQuantityType`** — re-synced to upstream: `knownValues`
  `["individuals", "percent-cover"]` with no default (we previously used
  `"individual-count"` with that as the default). No longer a divergence.
- **2026-09-30 resync** ([#78](https://tangled.org/cuanto.bio/cuanto.bio/issues/78))
  picked up upstream's `occurrence.occurrenceRemarksID`,
  `occurrence.eventRemarksID`, `occurrence.externalRecords`, and
  `identification.identificationRemarksID` (which deprecates the inline
  `identificationRemarks` string), and `media.license` moving from SPDX
  identifiers to license URIs (maxLength 32 to 128). The app already used
  license URIs for remarks and never writes `media.license` or
  `identificationRemarks`, so none of these needed app changes.

## Out of scope for upstream

The two-tier target model (`bio.cuanto.protocolTarget` = the protocol author's
canonical target, `bio.cuanto.surveyTarget` = the surveyor's durable copy) lives
entirely in our own `bio.cuanto.*` namespace and is not proposed to lexicons.bio.
`occurrence.surveyTargetID` references the surveyor's `bio.cuanto.surveyTarget`;
the originating protocolTarget is reachable via that surveyTarget's
`protocolTargetID`.
