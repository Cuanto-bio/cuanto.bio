# 🚧 Under Construction

Things are still pretty rough, FYI.

# Cuanto.bio

Cuanto.bio is a tool for counting organisms as part of a biolgical survey. Researchers can create protocols that define what organisms surveyors should look for and what information they should collect about them, and surveyors complete surveys that follow those protocols. Think of it like eBird but for everything!

## Goals
1. Allow researchers to author protocols for surveys
1. Allow volunteers to complete surveys by following the protocols
1. Allow everyone to see the aggregates results of the surveys following a protocol and export the data as a [DarwinCore Data Package (DwC-DP)](https://gbif.github.io/dwc-dp/dp/).

## Technology
Cuanto.bio is built on the [AT Protocol](https://atproto.com), which means user data lives in places users control and can be re-used by a variety of applications.

## Architecture

The app is a [SvelteKit](https://svelte.dev/docs/kit) application with a PostgreSQL database (w/ Docker Compose config if desired) used for server-side session and sync state. Signed-in functionality like completing surveys works offline as a Progressive Web App with local data stored in IndexedDB.

### Route layout

```
src/routes/
├── (root)               Public landing page and auth flows
├── auth/                Sign-in / sign-out
├── oauth/               AT Protocol OAuth callback
├── protocols/           Public, server-rendered protocol browse and detail pages
├── surveys/             Public, server-rendered survey browse and detail pages
├── api/                 JSON API endpoints consumed by the /app client
│   ├── me               Current user session info
│   ├── sync             Bulk data sync payload (protocols, surveys)
│   ├── protocols/       Protocol detail and follow-state endpoints
│   ├── surveys/         Survey CRUD endpoints
│   └── tap/webhook      AT Protocol firehose webhook
└── app/                 Offline-capable authenticated app (see below)
    ├── protocols/       Followed-protocol list and detail
    ├── surveys/         Survey list, detail, new survey, and pending queue
    └── (layout)         IDB-first auth + background sync on mount
```

### Offline PWA — `/app` route

Everything under `/app` is designed to work without a network connection:

- **Service worker** (`src/service-worker.ts`) caches the SvelteKit app shell
    at install time and serves it for every `/app/*` navigation, online or
    offline. Public `/protocols` pages use a stale-while-revalidate strategy
    so they load instantly from cache while a fresh response arrives in the
    background.

- **IndexedDB** (`src/lib/offline/db.ts`) is the client-side store. It holds the
  signed-in user record, followed protocols, cached surveys, and a pending-surveys
  queue for work done while offline.

- **`/app` layout** (`src/routes/app/+layout.ts`) runs entirely client-side
  (`ssr = false`). On load it calls `/api/me` to verify the session; if that
  succeeds it saves the user to IDB and fires `syncOfflineData` in the background.
  If the network is unreachable it falls back to the IDB user record so the app
  remains usable.

- **Sync** (`src/lib/offline/sync.ts`) calls `/api/sync` to fetch the user's
  followed protocols and recent surveys in one request, then writes them to IDB.

- **API endpoints** under `/api/` are thin JSON wrappers around the server-side
  database and AT Protocol PDS calls. The `/app` pages call these endpoints on
  navigation and fall back to IDB when the fetch fails, making every page
  readable offline.

- **Pending surveys** created offline are stored in the `pending-surveys` IDB
  store and uploaded via `/api/surveys` once the device is back online.

## Deploying to Railway

I'm currently using Railway to host cuanto.bio in case you need a reference setup.

### Services

Create three Railway services in a project:

1. **PostGIS** — deploy the `postgis/postgis:16-3.4` Docker image
2. **tap** — deploy `ghcr.io/bluesky-social/indigo/tap:latest` as a Docker image service
3. **app** — an empty repo and connect it with the CLI (`railway connect`) or deploy from Github

### Environment variables

**App service:**

| Variable | Description |
|---|---|
| `DATABASE_URL` | Injected automatically if you use the Railway Postgres plugin |
| `PUBLIC_URL` | The public URL of the app, e.g. `https://cuanto.bio` |
| `PUBLIC_OAUTH_CLIENT_ID` | Same as `PUBLIC_URL` (ATProto uses the app URL as the OAuth client ID) |
| `PRIVATE_OAUTH_KEY` | JWK for signing OAuth tokens — generate with `pnpm gen-key` |
| `TAP_ADMIN_PASSWORD` | Shared secret for authenticating TAP webhook requests |
| `TAP_URL` | Internal Railway URL of the TAP service |

**TAP service:**

| Variable | Description |
|---|---|
| `TAP_WEBHOOK_URL` | Internal Railway URL of the app's webhook endpoint, e.g. `https://<app-internal>/api/tap/webhook` |
| `TAP_ADMIN_PASSWORD` | Must match the value set on the app service |
| `TAP_SIGNAL_COLLECTION` | `bio.lexicons.temp.surveyProtocol` |
| `TAP_COLLECTION_FILTERS` | `bio.lexicons.temp.surveyProtocol,bio.lexicons.temp.surveyTarget,bio.lexicons.temp.survey,bio.cuanto.surveyProtocol.follow,bio.lexicons.temp.occurrence` |

### Migrations

Run migrations via the Railway CLI before or after deploying:

```sh
railway run --service <app-service-name> pnpm migrate:up
```

### Replaying historical data

To backfill records created before the webhook was live, unset `TAP_NO_REPLAY` on the TAP service and redeploy:

```sh
railway variable delete --service <tap-service-name> TAP_NO_REPLAY
railway redeploy --service <tap-service-name>
```

TAP will replay all known records through the webhook on startup. Set `TAP_NO_REPLAY=true` again afterward to prevent re-replaying on future restarts.

## Development setup

**Prerequisites:** Node.js 20+, pnpm, Docker

This should get you running at 127.0.0.1:5173, with the caveat that not all PWA functionality will work. For that you'll probably need to use `pnpm build && pnpm preview` and a reverse proxy of some kind to get a public URL with SSL.

```sh
cp .env.example .env
docker compose up -d
pnpm install
pnpm migrate:up
pnpm dev
```

## Running tests

```sh
pnpm test:db:setup # once
pnpm test
```

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
