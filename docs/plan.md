# Cuanto.bio: Project Plan

## Introduction

The short term goal is to build a prototype that lets researchers specify taxa they want surveyors to look for, for surveyors to record start time, duration, and the count of each target species they found, and for the website to show all the completed surveys for a protocol.

The entire stack should be written in TypeScript. We'll be using pnpm for package management, SvelteKit as our web framework, shadcn/ui as our UI framework (`pnpm dlx shadcn-svelte init --preset bKsJALVI`). We'll use PostGIS for our data store, even though we probably won't need spatial functionality until later.

Integration tests will use Playwright. Unit tests will use vitest.

For database access we'll use [postgres.js](https://github.com/porsager/postgres) directly — tagged template literals, safe by default, no ORM abstraction to fight when writing complex queries or PostGIS spatial queries. Migrations will be hand-rolled: numbered SQL files in a `migrations/` directory, tracked by a `schema_migrations` table, applied and rolled back by a small TypeScript CLI script.

For auth, we'll use [`@atproto/oauth-client-node`](https://github.com/bluesky-social/atproto/tree/main/packages/oauth/oauth-client-node) rather than running aip as a separate service. The library handles the full atproto OAuth 2.1 flow (PAR, PKCE, DPoP, handle resolution, token refresh) within the SvelteKit process. aip's proxy pattern would add value in a multi-service architecture where several backends need authenticated PDS access, but for a single SvelteKit app the operational overhead probably outweighs the benefit.

For record syncing, we'll run [tap](https://github.com/bluesky-social/indigo/tree/main/cmd/tap) as a separate service. Tap handles firehose connection, cryptographic verification, backfill, and cursor management, delivering clean JSON events to the app via webhook. For the prototype, tap will be configured to track only authenticated users' DIDs rather than the full network.

## Background context
* [DarwinCore terms](https://dwc.tdwg.org/terms)
* [Humboldt Extension terms](https://eco.tdwg.org/terms/)
* [DarwinCore Conceptual Model](https://gbif.github.io/dwc-dp/cm)
* [DarwinCore Data Package guide](https://gbif.github.io/dwc-dp/dp/)
* [AT Protocol lexicon spec](https://atproto.com/specs/lexicon)
* [ATGeo lexiconx](https://github.com/schuyler/garganorn/tree/main/garganorn/lexicon)
* [lexicons.bio lexicons](https://github.com/lexicons-bio/lexicons.bio/tree/main/lexicons/bio/lexicons/temp)
* [Cuanto.bio proposal][./context/Cuanto.bio - enabling participatory biolgocal surveys.pdf]

## MVP

### Phase 1: Project Setup
1. Install and set updependecies for local development, including docker
container for postgres (minus tap for now)
2. Write lexicons given the data model, and generate Typscript types using @atproto/lex

### Phase 2: Basic auth
1. Sign in with oauth to an atproto user's PDS given their handle;
2. Show them they've signed in by showing their DID

### Phase 3: Survey Protocol creation
1. database migrations that create survey_protocols and survey_targets
2. tools for searching the iNaturalist API for populating taxonomic fields in SurveyTarget
3. form to allow user to author a protocol
4. SvelteKit form actions to submit the protocol to the user's PDS
5. set up tap and tap webhook or websocket and ingest the protocol when we receive it
6. show the user the protocols they've authored

### Phase 4: Survey creation
1. database migrations that create surveys, occurrences, identifications
2. frontend tool that let's user say they're starting a Survey for a Protocol which starts a timer
3. frontend should show all SurveyTargets in an eBird like fashion, with a count field tha tyou can tap to increment, and a taxon name (if the SurveyTarget has a taxonomic scope) or just the verbatim scope.
4. stopping the survey should stop the timer
5. clicking submit should post the Survey to the user's PDS
6. ingestion should pick up the new bio.lexicons.temp.survey records and add it to the database
7. user should see a list of their completed surveys and access a survey detail page to see their survey

### Phase 5: Odds & Ends
1. Support sign out

## House Keeping
- [x] Move db-specific helpers to their own dir
- [x] Set up lefthook to run checks before commit


## Offline Surveying

Offline use is important, as we expect surveyors to be completing surveys in areas with little to no internet connectivity.

- [x] Support following protocols: when a user is online, they should be able to browse existing protocols and follow them, i.e. create `bio.cuanto.surveyProtocol.follow` records. Offline functionality will depend on this so we know what protocols to cache for offline use
- [x] Make frontend a Progressive Web App (PWA) and support offline Survey creation (submitting to the PDS will still require internet)

FWIW, this was much trickier than anticipated.

## Deployment
- [x] Figure out what it will take to deploy this on railway

## UI Massage
- [ ] logo & wordmark
- [ ] home page that explains what this is and encourages sign in
- [ ] autocomplete for Atmosphere handle
- [ ] show Bluesky profile pic
- [ ] Merge pending and completed surveys; pending should be a section at the top of the surveys page
- [ ] nav in mobile; at least need crumbs if not an actual navigator; maybe persistent bottom tabs


## Analysis

Researchers are surveyors will both be interested in the outcomes of all the survey activity.

- [ ] Show recently-completed Surveys on the Protocol detail page
- [ ] Set `organismQuantityType` on all occurrences to `individuals-count` (or similar) to indicate that organismQuantity can be interpreted as an integer, even though it's a string. In the future we'll probably want to let protocols specify the `organismQuantityType` for occurrences in their surveys. We should think about where to document the values of `organismQuantityType` Cuanto.bio recognizes (in the lexicon?)
- [ ] On protocol detail page, show total / mean / median values for organismQuantity values for each SurveyTarget where `organismQuantityType` is `individuals-count`
- [ ] Export Surveys as DwC-DP from the Protocol detail page

## Lexicons.bio changes
- [ ] make a PR that proposes our changes, or perhaps separate prs for each lexicon

## Future Plans
Vague for now, but things that are on my mind.

1. Users - attempt to populate profile info w/ bsky profiles
1. this might need to happen after converting to a PWA, and maybe after recording a track, but occurences should record the coordinates when the user changes the count from 0 to 1, and remove them before submitting if the count is 0, which would record the exact location of the first occurrence
1. Design overhaul (rethink IA, come up with a logo / icon)
1. Sync local ATGeo lexicon copies with upstream: `lexicons/org/atgeo/place.json` has two
   local patches for `@atproto/lex` compatibility (`"key": "record-key"` → `"key": "any"`,
   `"type": "object"` → `"type": "unknown"` on `relations`). Monitor the
   [garganorn repo](https://github.com/schuyler/garganorn) for spec-compliant updates. This is just something we need to keep an eye on.
1. Consider publishing our own bio.cuanto.surveyProtocol.follow lexicon per atproto DNS guidance (maybe premature until we've worked out the kinks)
1. Edit surveys
1. Enter old surveys