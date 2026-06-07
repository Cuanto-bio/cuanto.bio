import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';

const EDIT_DID = 'did:test:edit-spec';
const EDIT_HANDLE = 'user-edit-spec';
const OTHER_DID = 'did:test:edit-spec-other';
const OTHER_HANDLE = 'user-edit-spec-other';

function authCookie(did: string) {
  return {
    name: 'did',
    value: did,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

// ── Protocol editing ─────────────────────────────────────────────────────────

test.describe('protocol editing', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, EDIT_DID);
    await teardownDid(sql, OTHER_DID);
  });

  test('edit button visible for protocol author', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  });

  test('edit button not visible for non-owner', async ({
    page,
    sql,
    context,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await sql`
      INSERT INTO users (did, handle) VALUES (${OTHER_DID}, ${OTHER_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    await context.addCookies([authCookie(OTHER_DID)]);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await expect(page.getByRole('link', { name: 'Edit' })).not.toBeVisible();
  });

  test('non-owner cannot access edit route directly', async ({
    page,
    sql,
    context,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await sql`
      INSERT INTO users (did, handle) VALUES (${OTHER_DID}, ${OTHER_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    await context.addCookies([authCookie(OTHER_DID)]);
    const response = await page.goto(
      `/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`,
    );
    expect(response?.status()).toBe(403);
  });

  test('unauthenticated user is redirected to sign in', async ({
    page,
    sql,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('edit form pre-populates title and description', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await expect(page.locator('[name="title"]')).toHaveValue('Test Protocol');
    await expect(page.locator('[name="description"]')).toHaveValue(
      'A protocol for integration tests',
    );
  });

  test('successful edit updates title in DB and redirects', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);

    await page.fill('[name="title"]', 'Updated Protocol Title');

    await page.click('text=Save changes');
    await expect(page).toHaveURL(
      `/app/protocols/${EDIT_HANDLE}/${protocolRkey}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Updated Protocol Title' }),
    ).toBeVisible();

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM survey_protocols WHERE did = ${EDIT_DID} LIMIT 1
    `;
    expect(row.record.title).toBe('Updated Protocol Title');
  });

  test('editing replaces survey targets', async ({ page, sql, context }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    const protocolUri = `at://${EDIT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);

    // Remove all existing targets
    let removeCount = await page.locator('button[aria-label="Remove"]').count();
    while (removeCount > 0) {
      await page.locator('button[aria-label="Remove"]').first().click();
      removeCount = await page.locator('button[aria-label="Remove"]').count();
    }

    // Add a new verbatim target
    await page.click('text=+ Add custom target');
    await page
      .locator('[placeholder="Describe what to look for…"]')
      .fill('Freshwater fish');

    await page.click('text=Save changes');
    await expect(page).toHaveURL(
      `/app/protocols/${EDIT_HANDLE}/${protocolRkey}`,
    );

    const targets = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM protocol_targets WHERE protocol_uri = ${protocolUri}
    `;
    expect(targets).toHaveLength(1);
    const scope = (
      targets[0].record.scope as { verbatimTargetScope: string }[]
    )[0];
    expect(scope.verbatimTargetScope).toBe('Freshwater fish');
  });
});
