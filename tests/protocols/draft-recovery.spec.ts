import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';

const DRAFT_DID = 'did:test:draft-recovery-spec';
const DRAFT_HANDLE = 'user-draft-recovery-spec';

// A draft saved this long ago is treated as abandoned (see auth/signin's
// return_to cookie, which uses the same 10-minute window for the reauth
// round trip this draft is meant to survive).
const STALE_AGE_MS = 20 * 60 * 1000;
const FRESH_AGE_MS = 1000;

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

function makeDraft(title: string, description: string, ageMs: number) {
  return {
    title,
    description,
    requiredFieldDate: false,
    requiredFieldDuration: false,
    requiredFieldSurveyorCount: false,
    targets: [],
    places: [],
    savedAt: Date.now() - ageMs,
  };
}

// The draft-restore logic removes its sessionStorage entry as soon as it reads
// it (whether or not the draft turns out to be stale), which only happens once
// the client bundle hydrates. Server-rendered markup can't reflect the draft at
// all (sessionStorage doesn't exist on the server), so asserting on field
// values right after goto() risks reading that pre-hydration snapshot instead
// of the outcome of the restore logic. Waiting for removal pins the check to
// after hydration has actually run.
async function waitForDraftCleared(
  page: import('@playwright/test').Page,
  key: string,
) {
  await page.waitForFunction((k) => sessionStorage.getItem(k) === null, key);
  // For the stale-discard case, the expected end state ('') is identical to
  // the pre-hydration SSR default, so an auto-retrying toHaveValue('') can
  // false-pass by reading the DOM before the draft-discard logic has actually
  // run. Padding past the removal above (a real signal that hydration ran)
  // guards against that false positive; matches the fixed waits already used
  // elsewhere in this suite (signin.spec.ts, survey/form.spec.ts).
  await page.waitForTimeout(500);
}

test.describe('protocol form draft recovery', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DRAFT_DID);
  });

  test('discards a new-protocol draft older than the reauth window', async ({
    page,
    context,
  }) => {
    await context.addCookies([authCookie(DRAFT_DID)]);
    const draft = makeDraft(
      'Stale Draft Title',
      'Stale description',
      STALE_AGE_MS,
    );
    await page.addInitScript((d) => {
      sessionStorage.setItem('protocol-draft:new', JSON.stringify(d));
    }, draft);

    await page.goto('/protocols/new');
    await waitForDraftCleared(page, 'protocol-draft:new');

    await expect(page.getByLabel('Title')).toHaveValue('');
    await expect(page.getByLabel('Description')).toHaveValue('');
  });

  test('restores a new-protocol draft saved within the reauth window', async ({
    page,
    context,
  }) => {
    await context.addCookies([authCookie(DRAFT_DID)]);
    const draft = makeDraft(
      'Fresh Draft Title',
      'Fresh description',
      FRESH_AGE_MS,
    );
    await page.addInitScript((d) => {
      sessionStorage.setItem('protocol-draft:new', JSON.stringify(d));
    }, draft);

    await page.goto('/protocols/new');

    await expect(page.getByLabel('Title')).toHaveValue('Fresh Draft Title');
    await expect(page.getByLabel('Description')).toHaveValue(
      'Fresh description',
    );
    const remaining = await page.evaluate(() =>
      sessionStorage.getItem('protocol-draft:new'),
    );
    expect(remaining).toBeNull();
  });

  test('discards a stale edit draft in favor of the current record', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DRAFT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, DRAFT_DID);
    const atUri = `at://${DRAFT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    const draft = makeDraft(
      'Stale Edit Title',
      'Stale edit description',
      STALE_AGE_MS,
    );
    const draftKey = `protocol-draft:edit:${atUri}`;
    await page.addInitScript(
      ({ key, d }) => {
        sessionStorage.setItem(key, JSON.stringify(d));
      },
      { key: draftKey, d: draft },
    );

    await page.goto(`/protocols/${DRAFT_HANDLE}/${protocolRkey}/edit`);
    await waitForDraftCleared(page, draftKey);

    await expect(page.getByLabel('Title')).toHaveValue('Test Protocol');
    await expect(page.getByLabel('Description')).toHaveValue(
      'A protocol for integration tests',
    );
  });
});
