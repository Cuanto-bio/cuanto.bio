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

test('signed-in cold launch (/app) lands on Followed Protocols, not All Protocols', async ({
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
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, 'user-mobile-nav-spec') ON CONFLICT (did) DO NOTHING`;

  try {
    await page.goto('/app');
    await page.waitForURL('**/app/protocols/following', { timeout: 8000 });
    await expect(
      page.getByRole('heading', { name: 'Followed Protocols' }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('highlights Explore (not Following) when signed in and viewing /protocols', async ({
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
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, 'user-mobile-nav-spec') ON CONFLICT (did) DO NOTHING`;

  try {
    await page.goto('/protocols');
    await expect(page.getByRole('link', { name: 'Following' })).not.toHaveClass(
      /active/,
    );
    await expect(page.getByRole('button', { name: 'Explore' })).toHaveClass(
      /active/,
    );
  } finally {
    await teardownDid(sql, DID);
  }
});

// The desktop sidebar is the only other way to the log, and it never renders
// on a phone. The native wrapper launches into /app with no address bar, so
// this popover entry is the only route to the log on the device whose failures
// it records — see https://tangled.org/cuanto.bio/cuanto.bio/issues/50.
test('reaches the diagnostic log from the Explore popover', async ({
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
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, 'user-mobile-nav-spec') ON CONFLICT (did) DO NOTHING`;

  try {
    await page.goto('/app/surveys');
    const nav = page.locator('.mobile-nav');
    await nav.getByRole('button', { name: 'Explore' }).click();
    // menuitem, not link: the popover is an ARIA menu, so its anchors take
    // role="menuitem" from it. The sidebar's Log entry is a plain link.
    await nav.getByRole('menuitem', { name: 'Log', exact: true }).click();

    await expect(page).toHaveURL('/app/log');
  } finally {
    await teardownDid(sql, DID);
  }
});

test('newly followed protocol appears in Following list immediately, without a reload', async ({
  page,
  sql,
  context,
}) => {
  const EXISTING_DID = 'did:test:mobile-nav-immediate-follow-existing';
  const NEW_DID = 'did:test:mobile-nav-immediate-follow-new';

  await teardownDid(sql, DID);
  await teardownDid(sql, EXISTING_DID);
  await teardownDid(sql, NEW_DID);
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
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, 'user-mobile-nav-spec') ON CONFLICT (did) DO NOTHING`;

  // Suppress the auto-shown "install this app" dialog that a successful
  // follow triggers on touch devices — it covers the bottom nav and blocks
  // the later click on "Following", which is unrelated to what this test
  // covers.
  await page.addInitScript(() => {
    localStorage.setItem('cuanto:install-prompt-dismissed', 'true');
  });

  // A protocol already followed before this test's actions, so the client
  // IDB cache is non-empty by the time we follow a second one — that's what
  // puts the Following page's loader on its cache-first (stale-while-
  // revalidate) path instead of the empty-cache direct-fetch path.
  const { protocolRkey: existingRkey } = await seedProtocol(
    sql,
    EXISTING_DID,
    'Already Followed Protocol',
  );
  const existingUri = `at://${EXISTING_DID}/bio.cuanto.surveyProtocol/${existingRkey}`;
  await seedFollow(sql, DID, existingUri);

  const { protocolRkey: newRkey } = await seedProtocol(
    sql,
    NEW_DID,
    'Newly Followed Protocol',
  );
  const newHandle = `user-${NEW_DID.split(':').pop()}`;

  // Delay the background sync fired after following to force the race that
  // caused the bug: the Following list must pick up the new follow from a
  // synchronous local cache update, not depend on this round trip finishing
  // before the user taps "Following". Registered before any navigation, per
  // Playwright's recommended route-then-navigate ordering.
  await page.route('**/api/sync', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });

  try {
    // Populate the client-side IDB cache with the already-followed protocol.
    await page.goto('/app/protocols/following');
    await expect(page.getByText('Already Followed Protocol')).toBeVisible();

    await page.goto(`/protocols/${newHandle}/${newRkey}`);
    // The "Unfollow" button flips on optimistically, before the POST
    // resolves, so wait for the actual follow response (not just that button)
    // to make sure the post-follow callback — which writes the local cache —
    // has actually run before we navigate away. The app layout also fires its
    // own unrelated /api/sync calls on every navigation, so we can't use that
    // request as a signal here.
    //
    // This was `?/follow` until follow/unfollow moved off form actions and onto
    // /api/protocols/[handle]/[rkey]/follow so /app could be built statically.
    // Only the URL changed; what this test guards — that the Following list
    // picks the new follow up from the synchronous local cache write rather
    // than from the delayed /api/sync round trip — is unchanged.
    const followResponse = page.waitForResponse(
      (res) =>
        /\/api\/protocols\/[^/]+\/[^/]+\/follow$/.test(
          new URL(res.url()).pathname,
        ) && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Follow this protocol' }).click();
    await followResponse;
    await expect(page.getByRole('button', { name: 'Unfollow' })).toBeVisible();

    await page.getByRole('link', { name: 'Following' }).click();
    await page.waitForURL('**/app/protocols/following');
    await expect(
      page.getByRole('heading', { name: 'Followed Protocols' }),
    ).toBeVisible();

    await expect(page.getByText('Newly Followed Protocol')).toBeVisible();
    await expect(page.getByText('Already Followed Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
    await teardownDid(sql, EXISTING_DID);
    await teardownDid(sql, NEW_DID);
  }
});
