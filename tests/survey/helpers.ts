import type { Page } from '@playwright/test';

export async function cacheAndOpenNewSurvey(
  page: Page,
  handle: string,
  protocolRkey: string,
) {
  // Visit the /app/ protocol page so it caches the protocol to IndexedDB.
  await page.goto(`/app/protocols/${handle}/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}`);
  // Wait for the protocol to load from IDB and the form to render.
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });
}

// Opens the finish confirmation dialog and clicks Finish to submit.
export async function confirmFinishSurvey(page: Page) {
  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
}
