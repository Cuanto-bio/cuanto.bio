# Divergences to propose upstream to lexicons.bio

**Date:** 2026-06-06

We keep `occurrence` and `identification` on the upstream lexicons.bio NSID
(`bio.lexicons.temp.v0-1.*`) and stay in sync with upstream, but carry a few
local-extension fields the app needs. These are tracked here as changes to
propose upstream so our records stay interoperable rather than permanently
forked.

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

## Out of scope for upstream

The two-tier target model (`bio.cuanto.protocolTarget` = the protocol author's
canonical target, `bio.cuanto.surveyTarget` = the surveyor's durable copy) lives
entirely in our own `bio.cuanto.*` namespace and is not proposed to lexicons.bio.
`occurrence.surveyTargetID` references the surveyor's `bio.cuanto.surveyTarget`;
the originating protocolTarget is reachable via that surveyTarget's
`protocolTargetID`.
