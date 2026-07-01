import { devices } from '@playwright/test';
import { expect, test } from './fixtures.js';

const { viewport, hasTouch, isMobile } = devices['iPhone 15'];
test.use({ viewport, hasTouch, isMobile, serviceWorkers: 'block' });

const MOCK_ACTOR = {
  did: 'did:plc:signinspecactor',
  handle: 'alice.bsky.social',
  displayName: 'Alice',
};

test('selecting a handle suggestion closes the popover and keeps it closed', async ({
  page,
}) => {
  await page.route('**/xrpc/app.bsky.actor.searchActorsTypeahead**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ actors: [MOCK_ACTOR] }),
    }),
  );

  await page.goto('/auth/signin');

  const handleInput = page.locator('input[name="handle"]');
  await handleInput.pressSequentially('alice.b');

  const suggestion = page.locator('button', { hasText: 'alice.bsky.social' });
  await suggestion.first().waitFor({ state: 'visible' });
  await suggestion.first().tap();

  await expect(handleInput).toHaveValue('alice.bsky.social');

  // Give the debounced search (200ms) plus a mocked round trip time to fire
  // again if the popover were going to incorrectly reappear.
  await page.waitForTimeout(500);

  await expect(
    page.locator('button', { hasText: 'alice.bsky.social' }),
  ).toHaveCount(0);
});
