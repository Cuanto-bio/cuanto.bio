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

## Future Plans
Vague for now, but things that are on my mind

1. Make frontend a Progressive Web App (PWA) and support offline Survey creation (submitting to the PDS will still require internet)
1. Support following protocols: when a user is online, they should be able to browse existing protocols and follow them, i.e. create `bio.cuanto.surveyProtocol.follow` records
1. Show completed Surveys on the Protocol detail page
1. Export Surveys as DwC-DP from the Protocol detail page
