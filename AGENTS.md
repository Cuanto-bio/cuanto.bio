## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: prettier, eslint, vitest, playwright

---

# Development Workflow
- Branch names: start with the issue number, e.g. `123-fix-broken-embedded-photos`
- ALWAYS run `pnpm check` after changes and run `pnpm format` to address biome issues
- use playwrite-cli to control Playwright to verify frontend work
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

# Reference
- shadcn-svelte: https://www.shadcn-svelte.com/llms.txt
- playwright-cli: `playwright-cli --help`
- database: `pnpm psql` opens a psql shell against the local Postgres container
- iNaturalist API: https://api.inaturalist.org/v2/api-docs
- GBIF Species API: https://techdocs.gbif.org/openapi/checklistbank.json
