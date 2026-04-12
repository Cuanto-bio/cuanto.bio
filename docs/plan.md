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
