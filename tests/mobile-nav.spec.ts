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
  await context.addCookies([
    {
      name: 'did',
      value: DID,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const { protocolRkey } = await seedProtocol(sql, DID);
  const protocolUri = `at://${DID}/bio.lexicons.temp.surveyProtocol/${protocolRkey}`;
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
