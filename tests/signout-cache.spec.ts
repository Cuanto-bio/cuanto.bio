import {
  expect,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from './fixtures.js';

const A_DID = 'did:test:signout-cache-a';
const B_DID = 'did:test:signout-cache-b';

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

/** A route handler that holds requests until `release` is called. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

test.afterEach(async ({ sql }) => {
  for (const did of [A_DID, B_DID]) await teardownDid(sql, did);
});

test("a sync still in flight at sign-out does not leave that user's surveys for the next one", async ({
  page,
  sql,
  context,
}) => {
  const a = await seedProtocol(sql, A_DID);
  await seedSurvey(
    sql,
    A_DID,
    `at://${A_DID}/bio.cuanto.surveyProtocol/${a.protocolRkey}`,
    'Alder Marsh',
  );
  const b = await seedProtocol(sql, B_DID);
  await seedSurvey(
    sql,
    B_DID,
    `at://${B_DID}/bio.cuanto.surveyProtocol/${b.protocolRkey}`,
    'Bishop Dune',
  );

  await context.addCookies([authCookie(A_DID)]);
  await page.goto('/app/surveys');
  await expect(page.getByText('Alder Marsh')).toBeVisible();

  // Sign-out clears IndexedDB and then does a full-page navigation, but the
  // old page keeps running until that navigation commits. Hold the sync the
  // account page kicks off, and the sign-out navigation, so the sync's
  // response arrives in exactly that window.
  const sync = gate();
  const signOutNav = gate();
  await page.route('**/api/sync', async (route) => {
    await sync.opened;
    await route.continue().catch(() => {});
  });
  await page.route('**/auth/signout', async (route) => {
    await signOutNav.opened;
    await route.continue().catch(() => {});
  });

  const syncRequested = page.waitForRequest('**/api/sync');
  await page.goto('/app/account');
  await syncRequested;

  const signOutRequested = page.waitForRequest('**/auth/signout');
  await page
    .getByRole('main')
    .getByRole('button', { name: /sign out/i })
    .click();
  // The navigation request means the IndexedDB clear has finished.
  await signOutRequested;

  const syncAnswered = page.waitForResponse('**/api/sync');
  sync.release();
  await (await syncAnswered).finished();
  // Give the old page a moment to do whatever it does with that response.
  await page.waitForTimeout(500);
  signOutNav.release();
  await page.waitForURL((url) => url.pathname === '/');

  await page.unroute('**/api/sync');
  await page.unroute('**/auth/signout');
  await context.addCookies([authCookie(B_DID)]);
  await page.goto('/app/surveys');

  await expect(page.getByText('Bishop Dune')).toBeVisible();
  await expect(page.getByText('Alder Marsh')).not.toBeVisible();
});
