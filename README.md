# Cuanto.bio

Cuanto.bio is a tool for counting organisms as part of a biolgical survey. Researchers can create protocols that define what organisms surveyors should look for and what information they should collect about them, and surveyors complete surveys that follow those protocols. Think of it like eBird but for everything!

## Goals
1. Allow researchers to author protocols for surveys
1. Allow volunteers to complete surveys by following the protocols
1. Allow everyone to see the aggregates results of the surveys following a protocol and export the data as a [DarwinCore Data Package (DwC-DP)](https://gbif.github.io/dwc-dp/dp/).

## Technology
Cuanto.bio is built on the [AT Protocol](https://atproto.com), which means user data lives in places users control and can be re-used by a variety of applications.

## Development setup

**Prerequisites:** Node.js 20+, pnpm, Docker

```sh
cp .env.example .env   # fill in PRIVATE_OAUTH_KEY
docker compose up -d
pnpm install
pnpm migrate:up
pnpm dev
```

## Running tests

### Unit tests

```sh
pnpm test:unit
```

### Integration tests

Integration tests run against a dedicated `cuanto_test` database. Before running them for the first time, or after adding new migrations:

```sh
pnpm test:db:setup
```

Then:

```sh
pnpm test:integration
```

`pnpm test:db:setup` is idempotent — safe to re-run if something goes wrong.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm migrate:up` | Apply pending migrations to the dev database |
| `pnpm migrate:down` | Roll back the latest migration |
| `pnpm test:db:setup` | Create and migrate the integration test database (run once) |
| `pnpm test:unit` | Run unit tests |
| `pnpm test:integration` | Run Playwright integration tests |
| `pnpm test` | Run all tests |
| `pnpm check` | Type-check and lint |
| `pnpm format` | Auto-fix formatting |
| `pnpm psql` | Open a psql shell against the dev database |
