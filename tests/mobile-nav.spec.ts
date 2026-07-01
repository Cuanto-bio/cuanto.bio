import { devices } from '@playwright/test';
import type { Sql } from 'postgres';
import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

const DID = 'did:test:mobile-nav-spec';

async function seedFollow(sql: Sql, did: string, protocolUri: string) {
  const rkey = `testfollow${Date.now()}`;
  const atUri = `at://${did}/bio.cuanto.surveyProtocol.follow/${rkey}`;
  await sql`
    INSERT INTO protocol_follows (at_uri, did, rkey, protocol_uri, created_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${protocolUri}, now())
  `;
}

const { viewport, hasTouch, isMobile } = devices['iPhone 15'];
test.use({ viewport, hasTouch, isMobile });

test('shows "Followed Protocols" after navigating from /app/protocols/following to a protocol detail', async ({
  page,
  sql,
  context,
}) => {
  await teardownDid(sql, DID);
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
    await page.goto('/app/protocols/following');
    await page.getByRole('link', { name: 'Test Protocol' }).click();
    await page.waitForURL('**/app/protocols/*/*', { timeout: 8000 });
    await expect(
      page.getByRole('link', { name: 'Followed Protocols' }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('resets scroll position after navigating from a scrolled-down list to a protocol detail', async ({
  page,
  sql,
  context,
}) => {
  const otherDids = Array.from(
    { length: 15 },
    (_, i) => `did:test:mobile-nav-scroll-${i}`,
  );

  await teardownDid(sql, DID);
  for (const otherDid of otherDids) await teardownDid(sql, otherDid);

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
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, 'user-mobile-nav-scroll-spec') ON CONFLICT (did) DO NOTHING`;

  for (const otherDid of otherDids) {
    const { protocolRkey } = await seedProtocol(sql, otherDid);
    const protocolUri = `at://${otherDid}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    await seedFollow(sql, DID, protocolUri);
  }

  try {
    await page.goto('/app/protocols/following');

    const scrollContainer = page.locator('.mobile-scroll');
    const lastLink = page.locator('main ul li').last().getByRole('link');
    await lastLink.scrollIntoViewIfNeeded();

    const scrolledAmount = await scrollContainer.evaluate((el) => el.scrollTop);
    expect(scrolledAmount).toBeGreaterThan(0);

    await lastLink.click();
    await page.waitForURL('**/app/protocols/*/*', { timeout: 8000 });

    await expect(
      page.getByRole('link', { name: 'Followed Protocols' }),
    ).toBeVisible();
    await expect(scrollContainer).toHaveJSProperty('scrollTop', 0);
  } finally {
    await teardownDid(sql, DID);
    for (const otherDid of otherDids) await teardownDid(sql, otherDid);
  }
});
