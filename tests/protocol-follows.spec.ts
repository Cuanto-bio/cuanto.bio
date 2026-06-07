import type { Sql } from 'postgres';
import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

const DID = 'did:test:follow-spec';
const HANDLE = 'user-follow-spec';

let followCounter = 0;

async function seedFollow(
  sql: Sql,
  did: string,
  protocolUri: string,
  createdAt: Date = new Date(),
): Promise<string> {
  const rkey = `testfollow${Date.now()}${followCounter++}`;
  const atUri = `at://${did}/bio.cuanto.surveyProtocol.follow/${rkey}`;
  await sql`
    INSERT INTO protocol_follows (at_uri, did, rkey, protocol_uri, created_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${protocolUri}, ${createdAt})
  `;
  return atUri;
}

test('follow button visible when authenticated', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const { protocolRkey } = await seedProtocol(sql, DID);

  try {
    await page.goto(`/protocols/${HANDLE}/${protocolRkey}`);
    await expect(
      page.getByRole('button', { name: 'Follow this protocol' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Unfollow' }),
    ).not.toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('follow flow', async ({ page, sql, context }) => {
  await context.addCookies([
    {
      name: 'did',
      value: DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const { protocolRkey } = await seedProtocol(sql, DID);

  try {
    await page.goto(`/protocols/${HANDLE}/${protocolRkey}`);
    const followBtn = page.getByRole('button', {
      name: 'Follow this protocol',
    });
    await expect(followBtn).toBeVisible();

    await followBtn.click();

    await expect(page.getByRole('button', { name: 'Unfollow' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Follow this protocol' }),
    ).not.toBeVisible();

    // Follower count increments
    await expect(page.getByText('1 follower')).toBeVisible();

    // Protocol appears in /protocols/following
    await page.goto('/app/protocols/following');
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('unfollow flow', async ({ page, sql, context }) => {
  await context.addCookies([
    {
      name: 'did',
      value: DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const { protocolRkey } = await seedProtocol(sql, DID);
  const protocolUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  await seedFollow(sql, DID, protocolUri);

  try {
    await page.goto(`/protocols/${HANDLE}/${protocolRkey}`);
    const unfollowBtn = page.getByRole('button', { name: 'Unfollow' });
    await expect(unfollowBtn).toBeVisible();

    await unfollowBtn.click();

    await expect(
      page.getByRole('button', { name: 'Follow this protocol' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Unfollow' }),
    ).not.toBeVisible();

    // Follower count decrements
    await expect(page.getByText('0 followers')).toBeVisible();

    // Protocol no longer appears in /protocols/following
    await page.goto('/app/protocols/following');
    await expect(page.getByText('Test Protocol')).not.toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('unauthenticated view shows follower count but no follow button', async ({
  page,
  sql,
}) => {
  const { protocolRkey } = await seedProtocol(sql, DID);
  const protocolUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  await seedFollow(sql, DID, protocolUri);

  try {
    await page.goto(`/protocols/${HANDLE}/${protocolRkey}`);
    await expect(page.getByText(/follower/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Follow this protocol' }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Unfollow' }),
    ).not.toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('/protocols/following empty state', async ({ page, sql, context }) => {
  await context.addCookies([
    {
      name: 'did',
      value: DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;

  try {
    await page.goto('/app/protocols/following');
    await expect(
      page.getByText("You haven't followed any protocols yet."),
    ).toBeVisible();
  } finally {
    await sql`DELETE FROM users WHERE did = ${DID}`;
  }
});

test('/app/protocols/following requires auth', async ({ page }) => {
  await page.goto('/app/protocols/following');
  await expect(page).toHaveURL(/\/auth\/signin/);
});

test('/app/protocols/following renders protocols in follow date DESC order', async ({
  page,
  sql,
  context,
}) => {
  const DID_A = 'did:test:follow-order-a';
  const DID_B = 'did:test:follow-order-b';

  await context.addCookies([
    {
      name: 'did',
      value: DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;

  const { protocolRkey: rKeyA } = await seedProtocol(sql, DID_A);
  const { protocolRkey: rKeyB } = await seedProtocol(sql, DID_B);
  const uriA = `at://${DID_A}/bio.cuanto.surveyProtocol/${rKeyA}`;
  const uriB = `at://${DID_B}/bio.cuanto.surveyProtocol/${rKeyB}`;

  const handleA = `user-${DID_A.split(':').pop()}`;
  const handleB = `user-${DID_B.split(':').pop()}`;

  // Follow A first (older), then B (newer).
  await seedFollow(sql, DID, uriA, new Date('2026-01-01T00:00:00.000Z'));
  await seedFollow(sql, DID, uriB, new Date('2026-06-01T00:00:00.000Z'));

  try {
    await page.goto('/app/protocols/following');
    await page.waitForLoadState('networkidle');

    const items = page.locator('main ul li');
    await expect(items.nth(0)).toContainText(handleB);
    await expect(items.nth(1)).toContainText(handleA);
  } finally {
    await teardownDid(sql, DID);
    await teardownDid(sql, DID_A);
    await teardownDid(sql, DID_B);
  }
});
