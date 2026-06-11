import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';

const FORM_ERR_DID = 'did:test:form-err-spec';
const FORM_ERR_HANDLE = 'user-form-err-spec';

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

// Removes `required` from all form fields so the browser doesn't block
// submission, letting the server-side validation run and return fail().
async function removeRequiredAttributes(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[required]')) {
      el.removeAttribute('required');
    }
  });
}

test.describe('protocol form error display', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, FORM_ERR_DID);
  });

  test('new protocol form shows server error when title is missing', async ({
    page,
    sql,
    context,
  }) => {
    await sql`
      INSERT INTO users (did, handle)
      VALUES (${FORM_ERR_DID}, ${FORM_ERR_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    await context.addCookies([authCookie(FORM_ERR_DID)]);
    await page.goto('/protocols/new');

    await removeRequiredAttributes(page);
    await page.click('button[type="submit"]');

    await expect(
      page.getByRole('alert').filter({ hasText: 'Title is required' }),
    ).toBeVisible();
  });

  test('edit protocol form shows server error when title is missing', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(FORM_ERR_DID)]);
    const { protocolRkey } = await seedProtocol(sql, FORM_ERR_DID);
    await page.goto(`/protocols/${FORM_ERR_HANDLE}/${protocolRkey}/edit`);

    await removeRequiredAttributes(page);
    await page.fill('[name="title"]', '');
    await page.click('button[type="submit"]', { force: true });

    await expect(
      page.getByRole('alert').filter({ hasText: 'Title is required' }),
    ).toBeVisible();
  });
});
