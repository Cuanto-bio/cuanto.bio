import { expect, test } from '@playwright/test';

test('sign in link navigates to sign in page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/auth/signin');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
