import {
  expect,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from './fixtures.js';

const DID = 'did:test:profile-spec';
const HANDLE = `user-${DID.split(':').pop()}`;

test.describe('/profile/[handle]', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('returns 404 for an unknown handle', async ({ request }) => {
    const resp = await request.get('/profile/nonexistent-handle-xyz');
    expect(resp.status()).toBe(404);
  });

  test('shows a heading for a user with no activity', async ({ sql, page }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;

    await page.goto(`/profile/${HANDLE}`);

    await expect(
      page.getByRole('heading', { name: `@${HANDLE}` }),
    ).toBeVisible();
    // did:test:* never resolves against the real Bluesky API, so no profile
    // card and no protocols/surveys means no filterable Stats Explorer link.
    // did:test:* users never have Bluesky data regardless of connectivity,
    // so this absence must not be blamed on being offline.
    await expect(
      page.getByText('Bluesky profile details will be available when online.'),
    ).toHaveCount(0);
  });

  // did:test:* never resolves against the real Bluesky API, so this seeds the
  // cache columns directly (as getCachedBskyProfile's read-through cache
  // would have populated them from a real fetch) rather than going through a
  // live fetch, to verify the page actually reads from the cache.
  test('shows cached Bluesky profile data without needing a live fetch', async ({
    sql,
    page,
  }) => {
    await sql`
      INSERT INTO users (
        did, handle, avatar_url, bsky_display_name, bsky_description,
        bsky_profile_fetched_at
      )
      VALUES (
        ${DID}, ${HANDLE}, 'https://example.com/avatar.jpg', 'Ken-ichi',
        'Naturalist, see https://cuanto.bio', now()
      )
      ON CONFLICT (did) DO NOTHING
    `;

    await page.goto(`/profile/${HANDLE}`);

    const main = page.locator('main');
    await expect(main.getByText('Ken-ichi')).toBeVisible();
    await expect(main.getByText('Bluesky')).toBeVisible();
    await expect(main.getByText('Naturalist, see')).toBeVisible();
    await expect(
      main.getByRole('link', { name: 'https://cuanto.bio' }),
    ).toHaveAttribute('href', 'https://cuanto.bio');
  });

  test('notes that Bluesky details need a connection, when offline', async ({
    sql,
    page,
  }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;

    await page.goto(`/profile/${HANDLE}`);
    // Wait for hydration: useOnline's 'offline' listener is registered by
    // client-side component script, which runs after page.goto resolves.
    // Dispatching before that lands is a no-op -- nothing is listening yet.
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByText('Bluesky profile details will be available when online.'),
    ).toHaveCount(0);

    // /profile isn't covered by the service worker (only /app/* and
    // /protocols/* are), so there's no cached response to reload against
    // while genuinely offline here, unlike offline.pwa.spec.ts's pattern of
    // going offline and then navigating. Dispatching the event directly
    // exercises useOnline's real listener instead.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await expect(
      page.getByText('Bluesky profile details will be available when online.'),
    ).toBeVisible();
  });

  test('links to protocols, surveys, and a surveyedBy-filtered Stats Explorer, with counts', async ({
    sql,
    page,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    const protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    await seedSurvey(sql, DID, protocolAtUri);

    await page.goto(`/profile/${HANDLE}`);

    // Scoped to <main>: the sidebar has its own generic "Protocols"/"Surveys"
    // nav links that would otherwise also match by accessible name.
    const main = page.locator('main');
    const protocolsLink = main.locator(`a[href="/protocols/${HANDLE}"]`);
    await expect(protocolsLink).toContainText('1');

    const surveysLink = main.locator(`a[href="/surveys/${HANDLE}"]`);
    await expect(surveysLink).toContainText('1');

    const statsLink = main.getByRole('link', { name: /Stats/ });
    const href = await statsLink.getAttribute('href');
    // Links with surveyedBy alone (no protocols enumerated), so Stats
    // Explorer aggregates every protocol this user has surveyed under
    // instead of pre-selecting them as individual protocol chips.
    expect(href).toBe(`/stats?surveyedBy=${encodeURIComponent(DID)}`);

    await statsLink.click();
    await page.waitForURL('**/stats?**');
    await expect(page.getByText(`Surveys by @${HANDLE}`)).toBeVisible();
  });

  // The profile load's `did`/`handle` describe the profile being viewed, not
  // the visitor. SvelteKit merges page data over layout data by key, so if
  // those keys ever collided with the root layout's signed-in-user fields,
  // a signed-out visitor viewing someone else's profile would see the
  // sidebar mistake that profile for their own signed-in session.
  test("does not leak the viewed profile into the sidebar's signed-in state", async ({
    sql,
    page,
  }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;

    // Fresh context: no signed-in cache, so this visitor is genuinely
    // signed out.
    await page.goto(`/profile/${HANDLE}`);

    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign out/ })).toHaveCount(0);
    await expect(page.getByText('Your Surveys')).toHaveCount(0);
  });
});

test.describe('Handle links to profile', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('links the owner handle on a protocol detail page to their profile', async ({
    sql,
    page,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    await page.goto(`/protocols/${HANDLE}/${protocolRkey}`);
    await expect(page.locator(`a[href="/profile/${HANDLE}"]`)).toBeVisible();
  });

  test('links the surveyor handle on a survey detail page to their profile', async ({
    sql,
    page,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    const protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    const { surveyRkey } = await seedSurvey(sql, DID, protocolAtUri);
    await page.goto(`/surveys/${HANDLE}/${surveyRkey}`);
    await expect(page.locator(`a[href="/profile/${HANDLE}"]`)).toBeVisible();
  });

  test('does not add a nested profile link on a protocol card in a listing', async ({
    sql,
    page,
  }) => {
    await seedProtocol(sql, DID);
    await page.goto('/protocols');
    // ProtocolCard's handle already sits inside the card's own outer <a> to
    // the protocol; linking it too would nest anchors, which is invalid HTML.
    await expect(page.locator(`a[href="/profile/${HANDLE}"]`)).toHaveCount(0);
  });
});
