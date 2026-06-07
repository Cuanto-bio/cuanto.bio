import {
  expect,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from '../fixtures.js';

// ── Public survey routes ───────────────────────────────────────────────────────

const PUBLIC_DID = 'did:test:survey-public';
const PUBLIC_HANDLE = 'user-survey-public';

test('/surveys shows location name from JSONB record', async ({
  page,
  sql,
}) => {
  await sql`
    INSERT INTO users (did, handle) VALUES (${PUBLIC_DID}, ${PUBLIC_HANDLE})
    ON CONFLICT (did) DO NOTHING
  `;
  const { protocolRkey } = await seedProtocol(sql, PUBLIC_DID);
  const protocolUri = `at://${PUBLIC_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  await seedSurvey(sql, PUBLIC_DID, protocolUri, 'Public Test Meadow');

  try {
    await page.goto('/surveys');
    await expect(page.getByText('Public Test Meadow')).toBeVisible();
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, PUBLIC_DID);
  }
});

test('/surveys/[handle] shows surveys for that user from JSONB record', async ({
  page,
  sql,
}) => {
  await sql`
    INSERT INTO users (did, handle) VALUES (${PUBLIC_DID}, ${PUBLIC_HANDLE})
    ON CONFLICT (did) DO NOTHING
  `;
  const { protocolRkey } = await seedProtocol(sql, PUBLIC_DID);
  const protocolUri = `at://${PUBLIC_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  await seedSurvey(sql, PUBLIC_DID, protocolUri, 'Handle Route Meadow');

  try {
    await page.goto(`/surveys/${PUBLIC_HANDLE}`);
    await expect(page.getByText('Handle Route Meadow')).toBeVisible();
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, PUBLIC_DID);
  }
});

// ── Survey ordering ───────────────────────────────────────────────────────────

const ORDER_DID = 'did:test:survey-order-spec';

test('GET /api/surveys returns surveys ordered by createdAt DESC', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: ORDER_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await teardownDid(sql, ORDER_DID);
  const { protocolRkey } = await seedProtocol(sql, ORDER_DID);
  const protocolUri = `at://${ORDER_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

  const older = '2026-01-01T00:00:00.000Z';
  const newer = '2026-06-01T00:00:00.000Z';

  // Seed older survey first, then newer, to confirm DB insertion order doesn't
  // determine result order.
  await seedSurvey(sql, ORDER_DID, protocolUri, 'Older Site', older);
  await seedSurvey(sql, ORDER_DID, protocolUri, 'Newer Site', newer);

  try {
    const res = await page.request.get('/api/surveys');
    expect(res.ok()).toBe(true);
    const surveys = await res.json();
    expect(surveys).toHaveLength(2);
    expect(surveys[0].record.createdAt).toBe(newer);
    expect(surveys[1].record.createdAt).toBe(older);
  } finally {
    await teardownDid(sql, ORDER_DID);
  }
});

test('/app/surveys renders surveys in createdAt DESC order', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: ORDER_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await teardownDid(sql, ORDER_DID);
  const { protocolRkey } = await seedProtocol(sql, ORDER_DID);
  const protocolUri = `at://${ORDER_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

  // Seed older first to confirm insertion order doesn't determine display order.
  await seedSurvey(
    sql,
    ORDER_DID,
    protocolUri,
    'Older Site',
    '2026-01-01T00:00:00.000Z',
  );
  await seedSurvey(
    sql,
    ORDER_DID,
    protocolUri,
    'Newer Site',
    '2026-06-01T00:00:00.000Z',
  );

  try {
    await page.goto('/app/surveys');
    await page.waitForLoadState('networkidle');

    const items = page.locator('ul').last().locator('li');
    await expect(items.nth(0)).toContainText('Newer Site');
    await expect(items.nth(1)).toContainText('Older Site');
  } finally {
    await teardownDid(sql, ORDER_DID);
  }
});
