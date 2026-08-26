import {
  expect,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from './fixtures.js';

const DID = 'did:test:surveys-spec';

test.describe('/surveys — surveyedBy filter', () => {
  let protocolAtUri: string;

  test.beforeEach(async ({ sql }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('filters the survey list to just that surveyor and shows a chip', async ({
    sql,
    page,
  }) => {
    const otherDid = 'did:test:surveys-spec-other';
    await sql`
      INSERT INTO users (did, handle) VALUES (${otherDid}, 'other-surveyor')
      ON CONFLICT (did) DO NOTHING
    `;
    try {
      await seedSurvey(sql, DID, protocolAtUri);
      await seedSurvey(sql, otherDid, protocolAtUri);

      const handle = `user-${DID.split(':').pop()}`;
      const params = new URLSearchParams({ surveyedBy: DID });
      await page.goto(`/surveys?${params}`);

      await expect(page.getByText(`Surveyor: @${handle}`)).toBeVisible();
      // Only the requested surveyor's survey should render; the other
      // surveyor's survey (under the same protocol) must be excluded.
      await expect(page.locator('main ul > li')).toHaveCount(1);
    } finally {
      await teardownDid(sql, otherDid);
    }
  });

  test('degrades to an unfiltered list when surveyedBy does not resolve to a user', async ({
    sql,
    page,
  }) => {
    await seedSurvey(sql, DID, protocolAtUri);

    const params = new URLSearchParams({ surveyedBy: 'did:test:nonexistent' });
    await page.goto(`/surveys?${params}`);

    await expect(page.getByText(/^Surveyor:/)).not.toBeVisible();
  });
});
