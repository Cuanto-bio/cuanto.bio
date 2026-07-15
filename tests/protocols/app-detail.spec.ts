import type { Page } from '@playwright/test';
import {
  expect,
  seedOccurrence,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from '../fixtures.js';

// The signed-in protocol detail page (/app). Unlike the public page, which
// server renders a resolved `activity`, this route serves the cached protocol
// immediately and streams `activity` in over it. This pins down what the page
// shows during that streaming window.
//
// Reaching that window takes a client-side navigation. A full page load server
// renders the route, and the server has no IndexedDB cache to serve from, so it
// takes the cold path and resolves `activity` before responding.

const DID = 'did:test:app-protocol-detail-spec';
const HANDLE = 'user-app-protocol-detail-spec';

function authCookie() {
  return {
    name: 'did',
    value: DID,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

// Hold the activity fetch open so assertions can run while it is still in
// flight, the way a slow connection would.
async function delayActivityFetch(page: Page, rkey: string, ms: number) {
  await page.route(`**/api/protocols/${HANDLE}/${rkey}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test('shows a loading state, not an offline message, while activity streams in', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([authCookie()]);
  const seeded = await seedProtocol(sql, DID, 'Streaming Protocol');
  const protocolUri = `at://${DID}/bio.cuanto.surveyProtocol/${seeded.protocolRkey}`;
  const survey = await seedSurvey(sql, DID, protocolUri, 'Some Place');
  await seedOccurrence(
    sql,
    DID,
    survey.surveyAtUri,
    protocolUri,
    seeded.taxonTargetUri,
    '3',
  );

  try {
    const openProtocol = () =>
      page.getByRole('link', { name: 'Streaming Protocol' }).click();

    // Only a cold load in the browser writes the protocol to IndexedDB, so
    // reach the detail page by clicking through from the list. Coming back to
    // it a second time then takes the warm path that streams activity in.
    await page.goto('/app/protocols');
    await openProtocol();
    await expect(page.getByRole('tab', { name: 'Surveys (1)' })).toBeVisible();

    await page.goBack();
    await delayActivityFetch(page, seeded.protocolRkey, 3000);
    await openProtocol();

    // The cached protocol has rendered, so the tabs are on screen and the
    // activity fetch behind them is still in flight. The browser is online and
    // the fetch is merely slow, so claiming the surveys are unavailable
    // offline would be a lie.
    await expect(page.getByRole('tab', { name: 'Details' })).toBeVisible();
    await expect(page.getByText('Loading surveys…')).toBeVisible();
    await expect(
      page.getByText('Surveys are unavailable offline.'),
    ).toBeHidden();

    // The counts land once the fetch resolves.
    await expect(page.getByRole('tab', { name: 'Surveys (1)' })).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

// Being offline is one way for `activity` to never arrive; the other is a
// failed request while online, which is what this exercises. Genuine offline
// rendering needs the service worker, so it lives in the PWA suite.
test('says surveys could not be loaded when the request fails', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([authCookie()]);
  const seeded = await seedProtocol(sql, DID, 'Streaming Protocol');

  try {
    const openProtocol = () =>
      page.getByRole('link', { name: 'Streaming Protocol' }).click();

    await page.goto('/app/protocols');
    await openProtocol();
    await expect(page.getByRole('tab', { name: 'Surveys (0)' })).toBeVisible();

    await page.goBack();
    await page.route(
      `**/api/protocols/${HANDLE}/${seeded.protocolRkey}`,
      (route) => route.fulfill({ status: 500, body: 'nope' }),
    );
    await openProtocol();

    // The cached protocol still renders, but its activity never arrives. The
    // user is online, so blaming it on being offline would be wrong.
    await expect(
      page.getByRole('heading', { name: 'Streaming Protocol' }),
    ).toBeVisible();
    await expect(page.getByText('Surveys could not be loaded.')).toBeVisible();
    await expect(
      page.getByText('Surveys are unavailable offline.'),
    ).toBeHidden();
  } finally {
    await teardownDid(sql, DID);
  }
});

// navigator.onLine can report "online" even when real connectivity is down
// (e.g. a broken VPN), so the offline status can't rely on it — it has to be
// inferred from whether the fetch itself ever reached the server.
test('says surveys are unavailable offline when the request never reaches the server', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([authCookie()]);
  const seeded = await seedProtocol(sql, DID, 'Streaming Protocol');

  try {
    const openProtocol = () =>
      page.getByRole('link', { name: 'Streaming Protocol' }).click();

    await page.goto('/app/protocols');
    await openProtocol();
    await expect(page.getByRole('tab', { name: 'Surveys (0)' })).toBeVisible();

    await page.goBack();
    await page.route(
      `**/api/protocols/${HANDLE}/${seeded.protocolRkey}`,
      (route) => route.abort('failed'),
    );
    await openProtocol();

    // The cached protocol still renders, but the fetch behind it failed
    // before ever reaching the server.
    await expect(
      page.getByRole('heading', { name: 'Streaming Protocol' }),
    ).toBeVisible();
    await expect(
      page.getByText('Surveys are unavailable offline.'),
    ).toBeVisible();
    await expect(page.getByText('Surveys could not be loaded.')).toBeHidden();
  } finally {
    await teardownDid(sql, DID);
  }
});
