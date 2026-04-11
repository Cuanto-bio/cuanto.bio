# Cuanto.bio: Project Plan

## Introduction

The short term goal is to build a prototype that lets researchers specify taxa they want surveyors to look for, for surveyors to record start time, duration, and the count of each target species they found, and for the website to show all the completed surveys for a protocol.

Aside from potential dependencies like tap or aip (we need to consider if aip is worth it or if we should build our own auth layer), the entire stack should be written in Typescript. We'll be using pnpm for package management, SvelteKit as our web framework, Drizzle as an ORM if necessary, shadcn/ui as our UI framework (`pnpm dlx shadcn-svelte init --preset bKsJALVI)`.

## Background context
* [DarwinCore terms](https://dwc.tdwg.org/terms)
* [Humboldt Extension terms](https://eco.tdwg.org/terms/)
* [DarwinCore Conceptual Model](https://gbif.github.io/dwc-dp/cm)
* [DarwinCore Data Package guide](https://gbif.github.io/dwc-dp/dp/)
* [AT Protocol lexicon spec](https://atproto.com/specs/lexicon)
* [ATGeo lexiconx](https://github.com/schuyler/garganorn/tree/main/garganorn/lexicon)
* [lexicons.bio lexicons](https://github.com/lexicons-bio/lexicons.bio/tree/main/lexicons/bio/lexicons/temp)
* [Cuanto.bio proposal][./context/Cuanto.bio - enabling participatory biolgocal surveys.pdf]
