import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';
import { seedTaxonTargets } from '../survey/helpers.js';

const EDIT_DID = 'did:test:edit-spec';
const EDIT_HANDLE = 'user-edit-spec';
const OTHER_DID = 'did:test:edit-spec-other';
const OTHER_HANDLE = 'user-edit-spec-other';

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

// ── Protocol editing ─────────────────────────────────────────────────────────

test.describe('protocol editing', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, EDIT_DID);
    await teardownDid(sql, OTHER_DID);
  });

  test('edit button visible for protocol author', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await expect(
      page.getByRole('link', { name: 'Edit', exact: true }),
    ).toBeVisible();
  });

  test('edit button not visible for non-owner', async ({
    page,
    sql,
    context,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await sql`
      INSERT INTO users (did, handle) VALUES (${OTHER_DID}, ${OTHER_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    await context.addCookies([authCookie(OTHER_DID)]);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await expect(
      page.getByRole('link', { name: 'Edit', exact: true }),
    ).not.toBeVisible();
  });

  test('non-owner cannot access edit route directly', async ({
    page,
    sql,
    context,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await sql`
      INSERT INTO users (did, handle) VALUES (${OTHER_DID}, ${OTHER_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    await context.addCookies([authCookie(OTHER_DID)]);
    const response = await page.goto(
      `/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`,
    );
    expect(response?.status()).toBe(403);
  });

  test('unauthenticated user is redirected to sign in', async ({
    page,
    sql,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('edit form pre-populates title and description', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await expect(page.locator('[name="title"]')).toHaveValue('Test Protocol');
    await expect(page.locator('[name="description"]')).toHaveValue(
      'A protocol for integration tests',
    );
  });

  test('successful edit updates title in DB and redirects', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);

    await page.fill('[name="title"]', 'Updated Protocol Title');

    await page.click('text=Save changes');
    await expect(page).toHaveURL(
      `/app/protocols/${EDIT_HANDLE}/${protocolRkey}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Updated Protocol Title' }),
    ).toBeVisible();

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM survey_protocols WHERE did = ${EDIT_DID} LIMIT 1
    `;
    expect(row.record.title).toBe('Updated Protocol Title');
  });

  test('editing replaces survey targets', async ({ page, sql, context }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    const protocolUri = `at://${EDIT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);

    // Remove all existing targets
    let removeCount = await page.locator('button[aria-label="Remove"]').count();
    while (removeCount > 0) {
      await page.locator('button[aria-label="Remove"]').first().click();
      removeCount = await page.locator('button[aria-label="Remove"]').count();
    }

    // Add a new verbatim target
    await page.click('text=+ Add custom target');
    await page
      .locator('[placeholder="Describe what to look for…"]')
      .fill('Freshwater fish');

    await page.click('text=Save changes');
    await expect(page).toHaveURL(
      `/app/protocols/${EDIT_HANDLE}/${protocolRkey}`,
    );

    // Removed targets are tombstoned (deleted_at set), not hard-deleted, so
    // filter to the live ones -- what the protocol's current target list is.
    const targets = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM protocol_targets
      WHERE protocol_uri = ${protocolUri} AND deleted_at IS NULL
    `;
    expect(targets).toHaveLength(1);
    const scope = (
      targets[0].record.scope as { verbatimTargetScope: string }[]
    )[0];
    expect(scope.verbatimTargetScope).toBe('Freshwater fish');
  });
});

// ── Target classification (issue #81) ────────────────────────────────────────
// The server's iNat requests are answered by INAT_MOCK (playwright.config.ts),
// with canned ancestries in src/lib/server/inat-mock.ts.

test.describe('target classification', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, EDIT_DID);
  });

  async function liveTargetScope(
    sql: import('postgres').Sql,
    protocolRkey: string,
    scientificName: string,
  ) {
    const protocolUri = `at://${EDIT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    const rows = await sql<{ record: { scope: Record<string, string>[] } }[]>`
      SELECT record FROM protocol_targets
      WHERE protocol_uri = ${protocolUri} AND deleted_at IS NULL
    `;
    return rows
      .map((r) => r.record.scope[0])
      .find((s) => s.scientificName === scientificName);
  }

  test('saving a new taxon target stores its classification', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    // Only the search endpoint, not /api/taxa/classifications
    await page.route(
      (url) => url.pathname === '/api/taxa',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                inatId: 48548,
                scientificName: 'Vanessa cardui',
                taxonRank: 'species',
                commonName: 'Painted Lady',
                kingdom: 'Animalia',
                taxonID: 'https://www.inaturalist.org/taxa/48548',
              },
            ],
          }),
        }),
    );
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await page.fill(
      '[placeholder="Search iNaturalist taxa (e.g. Quercus)"]',
      'Vanessa',
    );
    await page.getByText('Vanessa cardui').click();

    await page.click('text=Save changes');
    await expect(page).toHaveURL(
      `/app/protocols/${EDIT_HANDLE}/${protocolRkey}`,
    );

    const scope = await liveTargetScope(sql, protocolRkey, 'Vanessa cardui');
    expect(scope).toMatchObject({
      kingdom: 'Animalia',
      order: 'Lepidoptera',
      family: 'Nymphalidae',
      higherClassification:
        'Animalia | Arthropoda | Hexapoda | Insecta | Pterygota | Lepidoptera | Papilionoidea | Nymphalidae | Nymphalinae | Nymphalini | Vanessa',
    });
    // An existing target the author didn't ask to classify is left alone
    const existing = await liveTargetScope(
      sql,
      protocolRkey,
      'Orienthella piunca',
    );
    expect(existing).not.toHaveProperty('family');
  });

  test('the backfill button classifies existing targets once saved', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    // Of the seeded targets only Orienthella piunca is an iNat taxon; Quercus
    // agrifolia is a GBIF taxon and the third is verbatim.
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    // The button is server-rendered; wait for hydration so the click lands
    await page.waitForLoadState('networkidle');

    const button = page.getByRole('button', {
      name: 'Add taxonomy to 1 target',
    });
    await button.click();
    await expect(
      page.getByText('Added taxonomy to 1 target. Save to keep it.'),
    ).toBeVisible();
    await expect(button).not.toBeVisible();

    await page.click('text=Save changes');
    await expect(page).toHaveURL(
      `/app/protocols/${EDIT_HANDLE}/${protocolRkey}`,
    );
    const scope = await liveTargetScope(
      sql,
      protocolRkey,
      'Orienthella piunca',
    );
    expect(scope).toMatchObject({
      phylum: 'Mollusca',
      order: 'Nudibranchia',
      family: 'Coryphellidae',
      higherClassification:
        'Animalia | Mollusca | Gastropoda | Heterobranchia | Euthyneura | Ringipleura | Nudipleura | Nudibranchia | Aeolidina | Fionoidea | Coryphellidae | Orienthella',
    });
  });

  test('the backfill button stops offering targets iNat has no taxonomy for', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    // Not in INAT_MOCK's canned data, so iNat "has no taxonomy" for it
    await seedTaxonTargets(sql, EDIT_DID, protocolRkey, [
      {
        scientificName: 'Unknownia mysteriosa',
        taxonRank: 'species',
        taxonID: 'https://www.inaturalist.org/taxa/999999999',
      },
    ]);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: 'Add taxonomy to 2 targets' })
      .click();
    await expect(
      page.getByText(
        'Added taxonomy to 1 target. Could not find taxonomy for 1. Save to keep it.',
      ),
    ).toBeVisible();
    // Asking again wouldn't find anything new
    await expect(
      page.getByRole('button', { name: /Add taxonomy/ }),
    ).not.toBeVisible();
  });

  test('the backfill button leaves new targets to be classified on save', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.route(
      (url) => url.pathname === '/api/taxa',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                inatId: 48548,
                scientificName: 'Vanessa cardui',
                taxonRank: 'species',
                commonName: 'Painted Lady',
                kingdom: 'Animalia',
                taxonID: 'https://www.inaturalist.org/taxa/48548',
              },
            ],
          }),
        }),
    );
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await page.waitForLoadState('networkidle');
    await page.fill(
      '[placeholder="Search iNaturalist taxa (e.g. Quercus)"]',
      'Vanessa',
    );
    await page.getByText('Vanessa cardui').click();
    // Only the seeded Orienthella piunca, not the unsaved Vanessa cardui
    await expect(
      page.getByRole('button', { name: 'Add taxonomy to 1 target' }),
    ).toBeVisible();
  });

  test('the backfill button does not count a target removed while it was working', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    const unknownTaxonID = 'https://www.inaturalist.org/taxa/999999999';
    await seedTaxonTargets(sql, EDIT_DID, protocolRkey, [
      {
        scientificName: 'Unknownia mysteriosa',
        taxonRank: 'species',
        taxonID: unknownTaxonID,
      },
    ]);
    // Hold the lookup until the target has been removed; iNat finds nothing
    let respond = () => {};
    const removed = new Promise<void>((resolve) => {
      respond = resolve;
    });
    await page.route('**/api/taxa/classifications**', async (route) => {
      await removed;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: {} }),
      });
    });
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: 'Add taxonomy to 2 targets' })
      .click();
    await page
      .locator('li')
      .filter({ has: page.locator(`a[href="${unknownTaxonID}"]`) })
      .getByRole('button', { name: 'Remove' })
      .click();
    respond();

    await expect(
      page.getByText('Could not find taxonomy for 1 target.'),
    ).toBeVisible();
    await expect(page.getByText(/Added taxonomy/)).not.toBeVisible();
  });

  test('the backfill button asks the author to sign in again when their session has expired', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.route('**/api/taxa/classifications**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      }),
    );
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: 'Add taxonomy to 1 target' })
      .click();
    await expect(
      page.getByText(
        'Your session has expired. Sign in again to add taxonomy.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Could not fetch taxonomy from iNaturalist.'),
    ).not.toBeVisible();
  });

  test('the backfill button is absent when no target needs classification', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    const protocolUri = `at://${EDIT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    await sql`
      UPDATE protocol_targets
      SET record = jsonb_set(
        jsonb_set(record, '{scope,0,family}', '"Coryphellidae"'),
        '{scope,0,higherClassification}',
        '"Animalia | Mollusca | Gastropoda | Nudibranchia | Coryphellidae | Orienthella"'
      )
      WHERE protocol_uri = ${protocolUri}
        AND record->'scope'->0->>'scientificName' = 'Orienthella piunca'
    `;
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await expect(page.getByLabel('Title')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Add taxonomy/ }),
    ).not.toBeVisible();
  });
});
