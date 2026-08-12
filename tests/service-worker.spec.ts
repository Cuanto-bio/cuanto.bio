import { expect, test } from '@playwright/test';

// Every test gets a fresh browser context, so every test is a *first* service
// worker install: no worker controls the page when it loads. The worker's
// 'activate' handler calls clients.claim(), which fires 'controllerchange' in
// the page even though the page is already running the newest assets.
//
// The root layout reloads on controllerchange. That is correct for an update
// (issue #4: the old worker's JS chunks have been evicted) but used to fire on
// first install too, yanking the page out from under the visitor a second or
// two after they land and aborting whatever they had already started. That was
// the engine behind issue #42's intermittent failures across unrelated specs:
// an in-flight navigation cancelled, a just-opened dialog thrown away, or
// page.evaluate dying with "Execution context was destroyed".
test('does not reload the page when the first-install worker claims it', async ({
  page,
}) => {
  // Registered before the first navigation so the initial load is counted too.
  // Playwright's own event, rather than a flag in the page, because a reload
  // destroys the page's execution context and takes any in-page state with it.
  const loads: string[] = [];
  page.on('load', () => loads.push(page.url()));

  await page.goto('/');

  // clients.claim() sets navigator.serviceWorker.controller and dispatches
  // controllerchange in the same task, so once a controller is visible here the
  // layout's handler has already run and any reload it triggers is in flight.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForLoadState('networkidle');

  expect(loads).toHaveLength(1);
});
