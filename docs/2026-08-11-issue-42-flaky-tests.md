# Issue #42: root cause of the intermittent integration failures

Status: **fixed**, on branch `42-flaky-integration-tests`.

The issue catalogued five tests failing intermittently in full suite runs while
passing in isolation, across unrelated areas (survey occurrence writes, PWA
install prompt, protocol draft recovery), with no failure output captured. Both
sessions lost their evidence: once to `grep` filtering, once to Playwright
clearing `outputDir` on the next run.

## How the evidence was kept this time

Each run was invoked like this, in a loop:

```sh
PLAYWRIGHT_JSON_OUTPUT_NAME=$OUT/run-$i.json \
  pnpm exec playwright test \
    --output="$OUT/artifacts-$i" \
    --trace=retain-on-failure \
    --reporter=list,json \
  >"$OUT/run-$i.log" 2>&1
```

`--output` per run is the important part: it gives each run its own artifact
directory, so the next run cannot clear the previous one's traces. `--trace` is
what actually resolved this, since the assertion message alone would not have.

Two of the five reproduced within two runs, and both traced to one mechanism.

## Root cause 1: the service worker reloads the page on first install

`src/routes/+layout.svelte` reloaded the page on `controllerchange`,
unconditionally. That is correct for an *update* (issue #4: the old worker's JS
chunks are already evicted, so the page must reload to stop running them), but
`controllerchange` also fires on a **first** install, when the freshly activated
worker calls `clients.claim()` in `src/service-worker.ts`. There the page is
already running the newest assets, so the reload accomplishes nothing and simply
interrupts whatever the visitor had started.

The trace from `tests/home.spec.ts` shows it exactly. The click did navigate;
the reload cancelled it:

```
   0    GET 200 /                <- initial load
1949    GET  -1 /auth/signin     <- the click DID navigate; -1 = aborted
2808    GET 200 /                <- pulled back to /
3256    GET 200 /@id/__x00__virtual:service-worker
```

Run 2 caught the same reload from the other side, in one of the tests the issue
actually names:

```
tests/protocols/draft-recovery.spec.ts:83
  Error: page.evaluate: Execution context was destroyed, most likely because of
  a navigation
```

This is not only a test problem. Every first-time visitor had their page
reloaded a second or two after landing, cancelling any navigation or form entry
in flight. It explains all five catalogued tests: an in-flight navigation is
cancelled, a just-opened install dialog is thrown away, a half-filled survey
form is reset, and `page.evaluate` dies outright. It also explains why the whole
`install dialog instructions` block flaked rather than one test in it, and why
running a spec alone always passed: with only a few tests in flight the dev
server is fast and the reload lands before the test starts interacting.

**Fix**: `reloadOnControllerChange` in `src/lib/pwa/swUpdate.ts`, which reloads
only when a worker was already controlling the page. The flag is not a single
`hasController()` reading taken up front: once a first install claims the page,
the page *is* controlled, so a later update in that same session must still
reload. `swUpdate.ts` already existed to keep exactly this kind of logic
testable outside Svelte, and `watchForUpdates` already drew the same
update-vs-first-install distinction; the reload was the one piece left inline
and untested.

## Root cause 2: protocol target order was undefined

`getProtocolTargetsForProtocols` had no `ORDER BY`, and the survey form's
"Default" sort is a pass-through (`sortTargets` in `src/lib/targets.svelte.ts`),
so the order surveyors count in was whatever order Postgres happened to return.

That is stable right up until a row moves. `insertProtocolTarget` upserts with
`ON CONFLICT (at_uri) DO UPDATE` on every firehose re-delivery, and
`tombstoneProtocolTargetsByUris` tombstones with a plain `UPDATE`. In Postgres an
`UPDATE` writes a new row version at a new physical location, and an unordered
`SELECT` returns rows in physical order. Demonstrated on a scratch database:

```
 ctid  |     rkey          before          ctid  |     rkey        after one UPDATE
-------+--------------                   -------+--------------
 (0,1) | testtarget1X                     (0,2) | testtarget2X
 (0,2) | testtarget2X       ---->         (0,3) | testtarget3X
 (0,3) | testtarget3X                     (0,4) | testtarget1X
```

So re-indexing a single target silently reorders a protocol's target list for
every surveyor. `tests/survey/occurrences.spec.ts` addresses targets
positionally (`nth(0)` for the taxon-scoped target, `nth(1)` for the verbatim
one), so a reshuffle makes it count the wrong organism, which matches the issue's
run 5 exactly: both `nth(1)` tests failed while both `nth(0)` tests passed,
consistent with the third target sorting into second place.

**Fix**: `ORDER BY indexed_at, rkey`. `indexed_at` is the order the appview first
saw the targets and survives the upserts, which leave it untouched. `rkey` breaks
ties: it is a TID, so it sorts by creation time, and it is the only ordering
signal left after `scripts/reindex-protocol.ts`, which upserts inside a
transaction where `now()` is constant and therefore gives every row an identical
`indexed_at`.

This is narrower than issue #10 (author-chosen target order), which is still
open and still needs its schema decision. This only makes the existing default
order deterministic; #10's design note already assumes creation order (`rkey` /
`createdAt`) as the backfill order, so the two agree.

## Root cause 3: a test edited the DOM before hydration undid it

`tests/protocols/form-errors.spec.ts` did not appear in the issue. It surfaced
during verification of the two fixes above, and it is the same shape as the
rest: it passed 10/10 in isolation while failing in a full run.

It stripped `required` from the form fields so the browser's constraint
validation would not block submission, then clicked submit as a separate step.
But `src/lib/components/ui/input/input.svelte` applies its attributes through a
`{...restProps}` spread, and Svelte re-applies spreads when it hydrates. Probed
directly: remove the attribute right after `goto()` and it is back three seconds
later.

```
PROBE RESULT {"before":{"had":true,"nowHas":false},"requiredAfter":true}
```

So whenever hydration landed between the strip and the click, `required` was
restored, the browser blocked submission, and no server error ever rendered.

**Fix**: the strip and the submit now happen inside a single `page.evaluate`.
One evaluate is one task, and hydration cannot interleave with it. The
assertion is untouched, and `form.requestSubmit()` still fires the submit event
so `use:enhance` is exercised whenever the form has already hydrated.

This race is in the test and predates this branch. Changing the reload timing is
what exposed it, which is worth stating plainly rather than filing it as
"fixed a flake we happened to notice."

## Tests

- `src/lib/pwa/swUpdate.test.ts`: first install must not reload, an update
  must, an update after a first install must, and never more than once.
- `tests/service-worker.spec.ts`: counts document loads on a first visit;
  was 2, must be 1.
- `tests/protocols/target-order.spec.ts`: targets render in creation order,
  and still do after one is re-indexed.

## Verification

Same harness, same machine, same working tree, before and after.

| | runs | runs with a failure |
|---|---|---|
| before (main) | 2 | 2 (`home.spec.ts`, `draft-recovery.spec.ts`) |
| after | 6 | 0 |

Six clean runs of 242 tests. Against the roughly 30-45% per-run failure rate in
the issue's own tables, six consecutive clean runs would happen about 5% of the
time by luck, so this is good evidence but not proof; the argument rests mainly
on each root cause being identified and demonstrated directly rather than on the
run count.

`pnpm test:pwa` also passes (9/9). That suite matters here because it runs
against a production build and exercises the service worker for real, including
offline app-shell loading, which is the behavior the first-install reload was
adjacent to.

## A note on the two "unidentified" failures

The issue's run 2 and the follow-up comment's run 3 were both lost to output
filtering. Neither is recoverable, but neither needs to be: all three causes
found here are load-sensitive races that fire anywhere in the suite, and the
`install dialog instructions` block flaking as a *block* (both of its tests) is
already the signature of a cause that is not specific to any one test. A sixth
distinct flaky test is possible; nothing in this investigation implies one.

## Deliberately not changed

`getSurveyTargetsByDidAndProtocol` is also unordered. Its only consumer,
`materialize-targets.ts`, keys results by URI, so order cannot affect it. Worth
ordering if it ever feeds a rendered list.

A scan of `src/lib/server/db` for the same bug class (a multi-row `SELECT` with
no `ORDER BY` whose result reaches the UI) turns up three more. None of them is
implicated in any failure seen here, so they are listed rather than changed:
picking the right order for each is a separate call, and widening this diff on
speculation would make it harder to review.

- `getOccurrencesForSurveys` (`surveys.ts`): the occurrences shown under a
  survey. Most exposed of the three, since `occurrences` rows are upserted by
  the tap webhook and so move physically for the same reason target rows did.
- `protocol-follows.ts:99`: the follower list on a protocol.
- `survey-protocols.ts:289` and `:311`: protocol title lists.

The surveys lists themselves are fine; they order by `created_at DESC`.

## Advice for the next person who hits a flake here

Copy `test-results/` before doing anything else, as the issue's comment already
warned. Better, do not create the problem: run with `--output=<dir-per-run>` and
`--trace=retain-on-failure`, and never pipe the run through `grep`. Both times
this issue lost its evidence, the very next command destroyed it.
