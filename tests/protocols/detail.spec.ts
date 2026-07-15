import type { Page } from '@playwright/test';
import {
  expect,
  seedOccurrence,
  seedProtocol,
  seedProtocolWithLocationOptions,
  seedSurvey,
  teardownDid,
  test,
} from '../fixtures.js';

// The public protocol detail page (signed out). Signed-in visitors get
// redirected to the /app equivalent, which renders the same ProtocolDetail
// component.

const DID = 'did:test:protocol-detail-spec';
const HANDLE = 'user-protocol-detail-spec';

// The page is server rendered, so the tabs are in the DOM before the client
// bundle has attached its click handlers. Switching tabs is a one-shot click
// Playwright won't retry, so wait for hydration before asking for one.
async function gotoDetail(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test.describe('protocol detail tabs', () => {
  let protocolRkey: string;
  let olderSurveyRkey: string;
  let newerSurveyRkey: string;

  test.beforeEach(async ({ sql }) => {
    const seeded = await seedProtocol(sql, DID);
    protocolRkey = seeded.protocolRkey;
    const protocolUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    const older = await seedSurvey(
      sql,
      DID,
      protocolUri,
      'Older Place',
      '2026-01-01T00:00:00Z',
    );
    const newer = await seedSurvey(
      sql,
      DID,
      protocolUri,
      'Newer Place',
      '2026-02-01T00:00:00Z',
    );
    olderSurveyRkey = older.surveyRkey;
    newerSurveyRkey = newer.surveyRkey;

    // Both occurrences hit the taxon target, so it has 2 surveys and 8
    // individuals; the other two targets have never been counted.
    await seedOccurrence(
      sql,
      DID,
      older.surveyAtUri,
      protocolUri,
      seeded.taxonTargetUri,
      '3',
    );
    await seedOccurrence(
      sql,
      DID,
      newer.surveyAtUri,
      protocolUri,
      seeded.taxonTargetUri,
      '5',
    );
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('labels each tab with its count', async ({ page }) => {
    await page.goto(`/protocols/${HANDLE}/${protocolRkey}`);

    await expect(page.getByRole('tab', { name: 'Surveys (2)' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Targets (3)' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Details' })).toBeVisible();
  });

  test('surveys tab lists the most recent surveys first', async ({ page }) => {
    await page.goto(`/protocols/${HANDLE}/${protocolRkey}`);

    const panel = page.getByRole('tabpanel');
    const links = panel.locator('a[href^="/surveys/"]');
    await expect(links).toHaveCount(2);
    await expect(links.first()).toHaveAttribute(
      'href',
      `/surveys/${HANDLE}/${newerSurveyRkey}`,
    );
    await expect(links.last()).toHaveAttribute(
      'href',
      `/surveys/${HANDLE}/${olderSurveyRkey}`,
    );
  });

  test('targets tab shows survey and individual counts per target', async ({
    page,
  }) => {
    await gotoDetail(page, `/protocols/${HANDLE}/${protocolRkey}`);
    await page.getByRole('tab', { name: 'Targets (3)' }).click();

    const counted = page
      .getByRole('row')
      .filter({ hasText: 'Quercus agrifolia' });
    await expect(
      counted.getByRole('cell', { name: '2', exact: true }),
    ).toBeVisible();
    await expect(
      counted.getByRole('cell', { name: '8', exact: true }),
    ).toBeVisible();

    // A target nobody has counted still gets a row, with zeroes.
    const uncounted = page.getByRole('row').filter({ hasText: 'All birds' });
    await expect(
      uncounted.getByRole('cell', { name: '0', exact: true }),
    ).toHaveCount(2);
  });

  test('details tab shows created date and required fields', async ({
    page,
  }) => {
    await gotoDetail(page, `/protocols/${HANDLE}/${protocolRkey}`);
    await page.getByRole('tab', { name: 'Details' }).click();

    const panel = page.getByRole('tabpanel');
    await expect(
      panel.getByRole('rowheader', { name: 'Created' }),
    ).toBeVisible();
    await expect(
      panel.getByRole('rowheader', { name: 'Required Fields' }),
    ).toBeVisible();
    await expect(
      panel.getByRole('cell', { name: 'No required fields' }),
    ).toBeVisible();
  });
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
    await seedOccurrence(sql, LAST_DID, olderUri, protocolUri, taxonTargetUri);
    await seedOccurrence(sql, LAST_DID, newerUri, protocolUri, taxonTargetUri);

    await gotoDetail(page, `/protocols/${LAST_HANDLE}/${protocolRkey}`);
    await page.getByRole('tab', { name: 'Targets (3)' }).click();

    // The more recent survey wins; the older one is not linked. Scoped to the
    // targets panel, since the surveys panel lists every recent survey.
    const panel = page.getByRole('tabpanel');
    await expect(
      panel.locator(`a[href="/surveys/${LAST_HANDLE}/${newerRkey}"]`),
    ).toBeVisible();
    await expect(
      panel.locator(`a[href="/surveys/${LAST_HANDLE}/${olderRkey}"]`),
    ).toHaveCount(0);

    // The second target has no occurrences, so its row shows an em dash.
    const verbatimRow = page.getByRole('row').filter({ hasText: 'All birds' });
    await expect(verbatimRow).toContainText('—');
    await expect(verbatimRow.locator('a[href^="/surveys/"]')).toHaveCount(0);
  });
});

// ── Followed by line ──────────────────────────────────────────────────────────

const FB_DID = 'did:test:followed-by-spec';
const FB_HANDLE = 'user-followed-by-spec';

test.describe('protocol detail Followed by line', () => {
  const followerDids = [
    'did:test:fb-follower-a',
    'did:test:fb-follower-b',
    'did:test:fb-follower-c',
  ];

  test.afterEach(async ({ sql }) => {
    for (const did of followerDids) {
      await sql`DELETE FROM users WHERE did = ${did}`;
    }
    await teardownDid(sql, FB_DID);
  });

  test('names recent followers with avatars and a "+ N more" tail', async ({
    page,
    sql,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, FB_DID);
    const protocolUri = `at://${FB_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    // Three followers; the two most recent are named, the third folds into
    // "+ 1 more". Only the newest has an avatar, so the other two render as
    // initial fallbacks.
    const followers = [
      {
        did: followerDids[0],
        handle: 'amylpatten',
        avatar: 'https://example.com/amy.png',
        createdAt: '2026-03-01T00:00:00Z',
      },
      {
        did: followerDids[1],
        handle: 'damontighe',
        avatar: null,
        createdAt: '2026-02-01T00:00:00Z',
      },
      {
        did: followerDids[2],
        handle: 'thirduser',
        avatar: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    for (const f of followers) {
      await sql`
        INSERT INTO users (did, handle, avatar_url)
        VALUES (${f.did}, ${f.handle}, ${f.avatar})
        ON CONFLICT (did) DO NOTHING
      `;
      const rkey = `fbfollow-${f.handle}`;
      const atUri = `at://${f.did}/bio.cuanto.surveyProtocol.follow/${rkey}`;
      await sql`
        INSERT INTO protocol_follows (at_uri, did, rkey, protocol_uri, created_at)
        VALUES (${atUri}, ${f.did}, ${rkey}, ${protocolUri}, ${f.createdAt})
      `;
    }

    await page.goto(`/protocols/${FB_HANDLE}/${protocolRkey}`);

    await expect(
      page.getByText('Followed by amylpatten, damontighe + 1 more'),
    ).toBeVisible();

    // The newest follower's avatar renders as an image in the stack.
    await expect(
      page.locator('img[src="https://example.com/amy.png"]'),
    ).toHaveCount(1);
  });

  test('names a lone follower with no "+ more" tail', async ({ page, sql }) => {
    const { protocolRkey } = await seedProtocol(sql, FB_DID);
    const protocolUri = `at://${FB_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    await sql`
      INSERT INTO users (did, handle) VALUES (${followerDids[0]}, ${'solo'})
      ON CONFLICT (did) DO NOTHING
    `;
    const atUri = `at://${followerDids[0]}/bio.cuanto.surveyProtocol.follow/solo`;
    await sql`
      INSERT INTO protocol_follows (at_uri, did, rkey, protocol_uri, created_at)
      VALUES (${atUri}, ${followerDids[0]}, ${'solo'}, ${protocolUri}, now())
    `;

    await page.goto(`/protocols/${FB_HANDLE}/${protocolRkey}`);

    await expect(
      page.getByText('Followed by solo', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/\+ \d+ more/)).toHaveCount(0);
  });
});

test.describe('protocol detail details tab with place options', () => {
  const LOC_DID = 'did:test:protocol-detail-loc-spec';
  const LOC_HANDLE = 'user-protocol-detail-loc-spec';
  let protocolRkey: string;

  test.beforeEach(async ({ sql }) => {
    ({ protocolRkey } = await seedProtocolWithLocationOptions(sql, LOC_DID));
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, LOC_DID);
  });

  test('lists place options in the details tab', async ({ page }) => {
    await gotoDetail(page, `/protocols/${LOC_HANDLE}/${protocolRkey}`);
    await page.getByRole('tab', { name: 'Details' }).click();

    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('Place Options (2)')).toBeVisible();
    await expect(panel.getByText('China Camp')).toBeVisible();
    await expect(panel.getByText('Mission Creek')).toBeVisible();
  });
});
