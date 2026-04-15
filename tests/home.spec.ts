import { expect, test } from '@playwright/test';

test('sign in link navigates to sign in page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/auth/signin');
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});
