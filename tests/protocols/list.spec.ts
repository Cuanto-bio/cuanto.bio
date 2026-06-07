import {
  expect,
  seedOccurrence,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from '../fixtures.js';

const DID = 'did:test:protocols-spec';
const HANDLE = 'user-protocols-spec';

// ── Public protocol list routes ───────────────────────────────────────────────

test('/protocols shows protocol titles', async ({ page, sql }) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID);

  try {
    await page.goto('/protocols');
    await expect(
      page.getByRole('link', { name: /Test Protocol.*@user-protocols-spec/ }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('/protocols/[handle] shows protocol titles for that user', async ({
  page,
  sql,
}) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID);

  try {
    await page.goto(`/protocols/${HANDLE}`);
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

// ── Last Survey column ────────────────────────────────────────────────────────

const LAST_DID = 'did:test:last-survey-spec';
const LAST_HANDLE = 'user-last-survey-spec';

test.describe('protocol detail Last Survey column', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, LAST_DID);
  });

  test('links to the most recent survey per target', async ({ page, sql }) => {
    await sql`INSERT INTO users (did, handle) VALUES (${LAST_DID}, ${LAST_HANDLE}) ON CONFLICT (did) DO NOTHING`;
    const { protocolRkey } = await seedProtocol(sql, LAST_DID);
    const protocolUri = `at://${LAST_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    const targets = await sql<{ at_uri: string; record: { scope: unknown } }[]>`
      SELECT at_uri, record FROM protocol_targets
      WHERE protocol_uri = ${protocolUri}
      ORDER BY indexed_at ASC
    `;
    const taxonTargetUri = targets[0].at_uri;

    // Older and newer survey, both with an occurrence for the first target.
    const { surveyRkey: olderRkey } = await seedSurvey(
      sql,
      LAST_DID,
      protocolUri,
      'Older Location',
      '2026-01-01T10:00:00.000Z',
    );
    const { surveyRkey: newerRkey } = await seedSurvey(
      sql,
      LAST_DID,
      protocolUri,
      'Newer Location',
      '2026-05-01T10:00:00.000Z',
    );
    const olderUri = `at://${LAST_DID}/bio.cuanto.survey/${olderRkey}`;
    const newerUri = `at://${LAST_DID}/bio.cuanto.survey/${newerRkey}`;
    await seedOccurrence(sql, LAST_DID, olderUri, taxonTargetUri);
    await seedOccurrence(sql, LAST_DID, newerUri, taxonTargetUri);

    await page.goto(`/protocols/${LAST_HANDLE}/${protocolRkey}`);

    // The more recent survey wins; the older one is not linked.
    await expect(
      page.locator(`a[href="/surveys/${LAST_HANDLE}/${newerRkey}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`a[href="/surveys/${LAST_HANDLE}/${olderRkey}"]`),
    ).toHaveCount(0);

    // The second target has no occurrences — its row shows an em dash.
    const verbatimRow = page.getByRole('row').filter({ hasText: 'All birds' });
    await expect(verbatimRow).toContainText('—');
    await expect(verbatimRow.locator('a[href^="/surveys/"]')).toHaveCount(0);
  });
});
