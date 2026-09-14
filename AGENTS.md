## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: prettier, eslint, vitest, playwright

---

# Planning
- plans go in docs/
- when asked to save a plan, write it to a new file

# Development Workflow
- Branch names: start with the issue number, e.g. `123-fix-broken-embedded-photos`
- ALWAYS run `pnpm check` after changes and run `pnpm format` to address biome issues
- ALWAYS run `pnpm test` after major changes to test for regressions
- use playwright-cli to control Playwright to verify frontend work for signed out states
- write integration tests to verify frontend work for signed in states
- migrations should prefixed with YYYYMMDDXXX including the date and an integer to increment for that day, e.g. `20260415001_create_something.up.sql`
- run integration tests with `pnpm test:integration`
- run PWA integration tests with `pnpm test:pwa`
- run unit tests with `pnpm test:unit`


# Test-Driven Development (TDD)
**ALWAYS write tests before fixing code when:**
- User reports a bug (e.g., "bug:", "broken:", "doesn't work")
- User describes unexpected behavior
- User says something "should" work differently
- You are debugging or investigating a failure

**Process:**
1. Write a failing test that reproduces the issue
2. NEVER proceed if the test does not fail; ask for permission instead
3. Fix the code to make the test pass
4. NEVER make the test pass by altering the test
5. Run full test suite to ensure no regressions

# Lexicons
- after editing any file under `lexicons/`, run `pnpm lex:gen` to regenerate
  `src/lib/lexicons/`
- permission-set lexicons (e.g. `bio.cuanto.authFull`) additionally need
  `goat lex publish --update lexicons/<path>.json` run against the live
  network (authenticated as the account that owns the NSID authority) —
  the OAuth consent screen and scope resolution read the *published*
  `com.atproto.lexicon.schema` record, not the local JSON or generated TS.
  `pnpm lex:gen` alone silently has no effect on live OAuth behavior. See
  docs/2026-07-05-issue-18-oauth-scopes.md for what happens when this step
  is skipped (issue #72). Use `goat lex status` / `goat lex diff` to check
  what's live vs. local without publishing anything.

# Frontend
* ALWAYS look for an appropriate shadcn component, even if not installed
* ALWAYS try to use appropriate theme colors in layout.css; if tempted to add custom colors, ask the user
* NEVER return a bare `did`, `handle`, or `avatarUrl` from a `load` function unless it's the
  signed-in visitor's own identity. SvelteKit merges page data over layout data by key, and those
  three keys carry the visitor's identity down from src/routes/+layout.ts. Prefix it instead
  (`profileHandle`, `ownerHandle`, ...). See the comment in src/routes/+layout.ts.

# Logging
* Use the pino-based logger in src/lib/logger.ts

# Reference
- shadcn-svelte: https://www.shadcn-svelte.com/llms.txt
- playwright-cli: `playwright-cli --help`
- database: `pnpm psql` opens a psql shell against the local Postgres container
- iNaturalist API: https://api.inaturalist.org/v2/api-docs
- GBIF Species API: https://techdocs.gbif.org/openapi/checklistbank.json
