import type { Page } from '@playwright/test';
import type { Sql } from 'postgres';
import {
  expect,
  seedOccurrence,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from '../fixtures.js';

// Three clicks by design: the danger zone stays collapsed behind its own
// "Delete protocol" button rather than showing by default, so the real path
// is "Delete protocol" (reveal), then "Delete protocol" (open the confirm
// dialog), then "Delete" (destructive, inside the dialog), not a shortcut.
async function deleteProtocolViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete protocol' }).click();
  await page.getByRole('button', { name: 'Delete protocol' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
}

// Issue #25: deleting a protocol must tombstone survey_protocols and
// protocol_targets, never hard-delete them — surveys.protocol_uri and
// occurrences (via surveys) both reach survey_protocols through ON DELETE
// CASCADE foreign keys, so a hard delete would silently wipe every survey
// and occurrence recorded under it. These tests hit the real Postgres test
// DB (PDS_MOCK=true makes the PDS writes no-ops), so they're the actual
// regression coverage for that cascade, not just wiring checks.

const DID = 'did:test:delete-spec';
const HANDLE = 'user-delete-spec';
const OTHER_DID = 'did:test:delete-spec-other';
const OTHER_HANDLE = 'user-delete-spec-other';

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

async function seedFollow(
  sql: Sql,
  did: string,
  protocolUri: string,
): Promise<string> {
  const rkey = `testfollow${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const atUri = `at://${did}/bio.cuanto.surveyProtocol.follow/${rkey}`;
  await sql`
    INSERT INTO protocol_follows (at_uri, did, rkey, protocol_uri, created_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${protocolUri}, now())
  `;
  return atUri;
}

test.describe('protocol deletion', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
    await teardownDid(sql, OTHER_DID);
  });

  test('deleting a protocol tombstones it and its targets, but surveys and occurrences survive', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    const { protocolRkey, taxonTargetUri } = await seedProtocol(sql, DID);
    const protocolUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    const { surveyAtUri } = await seedSurvey(sql, DID, protocolUri);
    const { occUri } = await seedOccurrence(
      sql,
      DID,
      surveyAtUri,
      protocolUri,
      taxonTargetUri,
    );
    await seedFollow(sql, DID, protocolUri);

    await page.goto(`/protocols/${HANDLE}/${protocolRkey}/edit`);
    // Without this, the trigger click can land before hydration attaches its
    // listener and silently no-op (same reason /app/protocols/following's
    // tests wait here before interacting with a follow button).
    await page.waitForLoadState('networkidle');
    await deleteProtocolViaUi(page);

    // ?deleted=1 is transient: +page.svelte's afterNavigate strips it right
    // after using it to force a fresh (not cached) fetch, same as ?updated=1.
    await expect(page).toHaveURL(
      new RegExp(`/app/protocols/${HANDLE}/${protocolRkey}$`),
    );

    const [protocolRow] = await sql`
      SELECT deleted_at FROM survey_protocols WHERE at_uri = ${protocolUri}
    `;
    expect(protocolRow.deleted_at).not.toBeNull();

    const targetRows = await sql`
      SELECT deleted_at FROM protocol_targets WHERE protocol_uri = ${protocolUri}
    `;
    expect(targetRows.length).toBeGreaterThan(0);
    for (const row of targetRows) expect(row.deleted_at).not.toBeNull();

    const [surveyRow] = await sql`
      SELECT at_uri FROM surveys WHERE at_uri = ${surveyAtUri}
    `;
    expect(surveyRow).toBeDefined();

    const [occRow] = await sql`
      SELECT at_uri FROM occurrences WHERE at_uri = ${occUri}
    `;
    expect(occRow).toBeDefined();

    // The author's own follow is theirs to clean up; other followers' are
    // deliberately left alone (see docs/2026-09-14-issue-25).
    const followRows = await sql`
      SELECT at_uri FROM protocol_follows WHERE protocol_uri = ${protocolUri} AND did = ${DID}
    `;
    expect(followRows.length).toBe(0);
  });

  test('the warning uses singular grammar for exactly one referencing survey', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    const { protocolRkey } = await seedProtocol(sql, DID);
    await seedSurvey(
      sql,
      DID,
      `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`,
    );

    await page.goto(`/protocols/${HANDLE}/${protocolRkey}/edit`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Delete protocol' }).click();

    await expect(
      page.getByText('1 survey already references it'),
    ).toBeVisible();
    await expect(
      page.getByText('reference it', { exact: false }),
    ).not.toBeVisible();
  });

  // Regression test: reported after a real delete — the app's own /app
  // protocol page caches the protocol in IDB and, before this fix, only
  // treated `?updated=1` as "cache is stale, fetch fresh"; a `?deleted=1`
  // redirect rendered the pre-deletion cached copy with no indication
  // anything had changed, even though the DB row was correctly tombstoned.
  test('the deleted banner shows immediately on redirect, not just after a reload', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    const { protocolRkey } = await seedProtocol(sql, DID);

    // Populate the IDB cache with the pre-deletion protocol, same as a
    // surveyor who viewed it before the author deleted it.
    await page.goto(`/app/protocols/${HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');

    await page.goto(`/protocols/${HANDLE}/${protocolRkey}/edit`);
    await page.waitForLoadState('networkidle');
    await deleteProtocolViaUi(page);

    await expect(page).toHaveURL(
      new RegExp(`/app/protocols/${HANDLE}/${protocolRkey}`),
    );
    await expect(
      page.getByText('Protocol deleted by its author'),
    ).toBeVisible();
  });

  test('non-owner cannot delete a protocol', async ({ page, sql, context }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    const protocolUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    await sql`
      INSERT INTO users (did, handle) VALUES (${OTHER_DID}, ${OTHER_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    await context.addCookies([authCookie(OTHER_DID)]);

    // page.request.post is treated as a fetch (not a full-page form
    // submission), so SvelteKit wraps the action failure as a 200 response
    // carrying the real status in the body rather than as the HTTP status
    // itself; the UI-driven success path above goes through the real
    // browser form instead, where SvelteKit does use the actual status.
    const response = await page.request.post(
      `/protocols/${HANDLE}/${protocolRkey}/edit?/delete`,
      { form: {} },
    );
    const body = await response.json();
    expect(body).toMatchObject({ type: 'failure', status: 403 });

    const [protocolRow] = await sql`
      SELECT deleted_at FROM survey_protocols WHERE at_uri = ${protocolUri}
    `;
    expect(protocolRow.deleted_at).toBeNull();
  });

  test("a deleted protocol shows as deleted on its survey's public page", async ({
    page,
    sql,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    const protocolUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    const { surveyRkey } = await seedSurvey(sql, DID, protocolUri);
    await sql`
      UPDATE survey_protocols SET deleted_at = now() WHERE at_uri = ${protocolUri}
    `;

    await page.goto(`/surveys/${HANDLE}/${surveyRkey}`);
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
  });

  test("a deleted protocol shows the Deleted badge on its author's public protocol list", async ({
    page,
    sql,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, DID);
    await sql`
      UPDATE survey_protocols SET deleted_at = now()
      WHERE at_uri = ${`at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`}
    `;

    await page.goto(`/protocols/${HANDLE}`);
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
  });

  // A protocol author's stated reason for deleting is often to make what
  // they wrote (title, description, targets, required fields, location
  // options) stop appearing — the record survives in the DB for referential
  // integrity, but the app doesn't have to keep showing it. Author identity
  // (handle) and prospective actions (Follow, Start Survey, Edit) go too:
  // Edit's only effect on a deleted protocol would be to resurrect it, and
  // following/surveying it further is meaningless. Stats/export stay since
  // they describe surveyors' own data, not the author's.
  test('a deleted protocol hides everything except Surveys/Stats/Export', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    const { protocolRkey } = await seedProtocol(sql, DID);
    await sql`
      UPDATE survey_protocols SET deleted_at = now()
      WHERE at_uri = ${`at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`}
    `;
    await sql`
      UPDATE protocol_targets SET deleted_at = now()
      WHERE protocol_uri = ${`at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`}
    `;

    // Signed in as the protocol's own author, so Edit would show if anything
    // did — the strongest case for "is this really hidden".
    await page.goto(`/app/protocols/${HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');

    const main = page.locator('main');
    await expect(
      page.getByText('Protocol deleted by its author'),
    ).toBeVisible();
    await expect(
      main.getByRole('heading', { name: 'Test Protocol' }),
    ).not.toBeVisible();
    await expect(main.getByText(`@${HANDLE}`)).not.toBeVisible();
    await expect(
      main.getByText('A protocol for integration tests'),
    ).not.toBeVisible();
    await expect(main.getByText('Coast live oak')).not.toBeVisible();
    await expect(main.getByText(/follower/i)).not.toBeVisible();
    await expect(
      main.getByRole('link', { name: 'Edit', exact: true }),
    ).not.toBeVisible();
    await expect(
      main.getByRole('link', { name: 'Add Past Survey' }),
    ).not.toBeVisible();
    await expect(
      main.getByRole('link', { name: 'Start Survey' }),
    ).not.toBeVisible();
    await expect(
      main.getByRole('button', { name: 'Follow this protocol' }),
    ).not.toBeVisible();
    await expect(main.getByRole('tab', { name: /Targets/ })).not.toBeVisible();
    await expect(main.getByRole('tab', { name: 'Details' })).not.toBeVisible();

    await expect(main.getByRole('tab', { name: /Surveys/ })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Stats' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Export' })).toBeVisible();
  });

  // The edit link is already hidden on a deleted protocol's own page, but
  // the route itself is still reachable by URL, and saving there would
  // silently un-delete the protocol (insertProtocol's upsert clears
  // deleted_at). 410 makes that a hard stop instead of a silent resurrection.
  test('the edit route 410s for a tombstoned protocol', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    const { protocolRkey } = await seedProtocol(sql, DID);
    await sql`
      UPDATE survey_protocols SET deleted_at = now()
      WHERE at_uri = ${`at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`}
    `;

    const response = await page.goto(
      `/protocols/${HANDLE}/${protocolRkey}/edit`,
    );
    expect(response?.status()).toBe(410);
  });

  test('the save action 410s for a tombstoned protocol reached directly', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    const { protocolRkey } = await seedProtocol(sql, DID);
    await sql`
      UPDATE survey_protocols SET deleted_at = now()
      WHERE at_uri = ${`at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`}
    `;

    const response = await page.request.post(
      `/protocols/${HANDLE}/${protocolRkey}/edit?/save`,
      {
        form: {
          title: 'New Title',
          description: 'New Description',
          targets: '[]',
          locationOptions: '[]',
        },
      },
    );
    const body = await response.json();
    expect(body.type).toBe('error');
    expect(body.error?.message ?? body.error).toContain('deleted');

    const [protocolRow] = await sql`
      SELECT record FROM survey_protocols
      WHERE at_uri = ${`at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`}
    `;
    expect(protocolRow.record.title).not.toBe('New Title');
  });
});
