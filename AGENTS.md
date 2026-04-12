## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: tailwindcss, shadcn-svelte

---

# Development Workflow
- Branch names: start with the issue number, e.g. `123-fix-broken-embedded-photos`

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
