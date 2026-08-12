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

// Submits the protocol form with `required` stripped, so the browser's own
// constraint validation doesn't block submission and the server-side check can
// run and return fail().
//
// The stripping and the submit have to happen in a single evaluate. Input
// applies its attributes through a {...restProps} spread, so Svelte puts
// `required` straight back when it hydrates -- and hydration lands after
// page.goto() resolves, late enough under a loaded dev server that a separate
// strip-then-click would find the attributes restored and the submit blocked.
// One evaluate is one task, which hydration cannot interleave with.
async function submitWithoutClientValidation(
  page: import('@playwright/test').Page,
  { clearTitle = false } = {},
) {
  await page.evaluate((clear) => {
    const title = document.querySelector(
      '[name="title"]',
    ) as HTMLInputElement | null;
    const form = title?.form;
    if (!form) throw new Error('protocol form not found');

    for (const el of form.querySelectorAll('[required]')) {
      el.removeAttribute('required');
    }
    if (clear && title) {
      title.value = '';
      // Keeps a hydrated bind:value in sync with the cleared DOM value.
      title.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    // requestSubmit, not submit(): it still fires the submit event, so
    // use:enhance is exercised whenever the form has already hydrated.
    form.requestSubmit(submit ?? undefined);
  }, clearTitle);
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

    await submitWithoutClientValidation(page);

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

    await submitWithoutClientValidation(page, { clearTitle: true });

    await expect(
      page.getByRole('alert').filter({ hasText: 'Title is required' }),
    ).toBeVisible();
  });
});
