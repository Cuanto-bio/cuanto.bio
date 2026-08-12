import { expect, test } from '../fixtures.js';
import { cacheAndOpenNewSurvey } from '../survey/helpers.js';

const DID = 'did:test:survey-spec';
const HANDLE = 'user-survey-spec';

// seedProtocol's three targets, in the order they were created.
const CREATION_ORDER = [
  'Coast live oak (Quercus agrifolia)',
  'All birds',
  "Fisher's aeolid (Orienthella piunca)",
];

function labelsOf(page: import('@playwright/test').Page) {
  // The label button in each target row; the row's other button is the counter.
  // Scoped to the target list itself so the sidebar's own <li> buttons (handle,
  // Sign out) can't drift into the comparison.
  return page.locator(
    'ul:has([aria-label="Increase count"]) li button:not([aria-label="Increase count"])',
  );
}

async function renderedTargetLabels(page: import('@playwright/test').Page) {
  const texts = await labelsOf(page).allTextContents();
  return texts.map((t) => t.replace(/\s+/g, ' ').trim());
}

test('lists targets in creation order under the default sort', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);

  expect(await renderedTargetLabels(page)).toEqual(CREATION_ORDER);
});

// The appview upserts a protocolTarget every time the firehose re-delivers a
// record it already has (survey-protocols.ts, ON CONFLICT (at_uri) DO UPDATE),
// and tombstones one with a plain UPDATE. In Postgres an UPDATE writes a new
// row version at a new physical location, and a SELECT with no ORDER BY hands
// rows back in physical order -- so re-indexing a single target silently
// reshuffles the protocol's target list for every surveyor.
//
// The "default" sort is a pass-through (sortTargets in targets.svelte.ts), so
// whatever order the query returns is the order the survey form renders. Tests
// that address targets positionally (survey/occurrences.spec.ts uses nth(0) for
// the taxon-scoped target and nth(1) for the verbatim one) then count the wrong
// organism, which is issue #42's occurrences.spec.ts failures.
test('keeps target order stable after a target is re-indexed', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await sql`
    UPDATE protocol_targets
    SET record = record
    WHERE did = ${DID} AND rkey LIKE 'testtarget1%'
  `;

  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);

  expect(await renderedTargetLabels(page)).toEqual(CREATION_ORDER);
});
