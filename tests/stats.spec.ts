import {
  expect,
  seedIncidentalOccurrence,
  seedOccurrence,
  seedProtocol,
  seedSurvey,
  seedSurveyWithCoordinates,
  teardownDid,
  test,
} from './fixtures.js';

const DID = 'did:test:stats-spec';

// ── /api/protocols search ─────────────────────────────────────────────────────

test.describe('/api/protocols', () => {
  test.beforeEach(async ({ sql }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${`user-${DID.split(':').pop()}`})
      ON CONFLICT (did) DO NOTHING
    `;
    await seedProtocol(sql, DID);
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  // Omitting `q` used to 422. It now lists the collection, because /app/protocols
  // needs a list it can fetch client-side (no +page.server.ts) and a bare
  // collection GET is the natural place for it. Matches /api/protocols/following,
  // which also returns a bare Protocol[]. The `?q=` search mode is unchanged and
  // still returns the thinner {results} shape the autocomplete wants.
  test('lists protocols when q is omitted', async ({ request }) => {
    const resp = await request.get('/api/protocols');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    const titles = body.map(
      (p: { record: { title: string } }) => p.record.title,
    );
    expect(titles).toContain('Test Protocol');
  });

  test('includes targets in the listed protocols', async ({ request }) => {
    const resp = await request.get('/api/protocols');
    const body = await resp.json();
    const seeded = body.find(
      (p: { record: { title: string } }) => p.record.title === 'Test Protocol',
    );
    expect(seeded).toBeDefined();
    expect(Array.isArray(seeded.targets)).toBe(true);
    expect(seeded.targets.length).toBeGreaterThan(0);
  });

  test('returns matching protocols for a query', async ({ request }) => {
    const resp = await request.get('/api/protocols?q=Test');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.results).toBeDefined();
    const titles = body.results.map((r: { title: string }) => r.title);
    expect(titles).toContain('Test Protocol');
  });
});

// ── /api/users search ─────────────────────────────────────────────────────────

test.describe('/api/users', () => {
  test.beforeEach(async ({ sql }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${`user-${DID.split(':').pop()}`})
      ON CONFLICT (did) DO NOTHING
    `;
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('returns no results when q is omitted', async ({ request }) => {
    const resp = await request.get('/api/users');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.results).toEqual([]);
  });

  test('returns matching users for a query', async ({ request }) => {
    const resp = await request.get('/api/users?q=stats-spec');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    const handles = body.results.map((r: { handle: string }) => r.handle);
    expect(handles).toContain(`user-${DID.split(':').pop()}`);
  });

  test('returns each result with a did and handle', async ({ request }) => {
    const resp = await request.get('/api/users?q=stats-spec');
    const body = await resp.json();
    const match = body.results.find((r: { did: string }) => r.did === DID);
    expect(match).toEqual({ did: DID, handle: `user-${DID.split(':').pop()}` });
  });
});

// ── /stats page load with protocol URI in URL ─────────────────────────────────

test.describe('/stats page', () => {
  let protocolAtUri: string;

  test.beforeEach(async ({ sql }) => {
    const handle = `user-${DID.split(':').pop()}`;
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${handle})
      ON CONFLICT (did) DO NOTHING
    `;
    const { protocolRkey } = await seedProtocol(sql, DID);
    protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('loads without error when protocol URI is in URL params', async ({
    page,
  }) => {
    const params = new URLSearchParams({ protocols: protocolAtUri });
    await page.goto(`/stats?${params}`);
    await expect(
      page.getByRole('heading', { name: 'Stats Explorer' }),
    ).toBeVisible();
  });

  test('shows the protocol pill for the preloaded protocol', async ({
    page,
  }) => {
    const params = new URLSearchParams({ protocols: protocolAtUri });
    await page.goto(`/stats?${params}`);
    await expect(page.getByText('Test Protocol')).toBeVisible();
  });

  test('loads stats from surveyedBy alone, with no protocol pill and no "select a protocol" placeholder', async ({
    page,
    sql,
  }) => {
    await seedSurvey(sql, DID, protocolAtUri);
    const handle = `user-${DID.split(':').pop()}`;
    const params = new URLSearchParams({ surveyedBy: DID });
    await page.goto(`/stats?${params}`);
    await expect(page.getByText(`Surveys by @${handle}`)).toBeVisible();
    await expect(page.getByText('Test Protocol')).not.toBeVisible();
    await expect(
      page.getByText('Select a protocol to load stats.'),
    ).not.toBeVisible();
  });

  test('lets you pick a surveyor from the autocomplete and see it applied', async ({
    page,
    sql,
  }) => {
    await seedSurvey(sql, DID, protocolAtUri);
    const handle = `user-${DID.split(':').pop()}`;

    await page.goto('/stats');
    await page.getByPlaceholder('Search surveyors…').fill(handle);
    await page.getByRole('button', { name: `@${handle}`, exact: true }).click();

    await expect(page.getByText(`Surveys by @${handle}`)).toBeVisible();
    await expect(page.getByPlaceholder('Search surveyors…')).not.toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`surveyedBy=${encodeURIComponent(DID)}`),
    );
  });
});

// ── /api/stats endpoint ───────────────────────────────────────────────────────

test.describe('/api/stats', () => {
  let protocolAtUri: string;
  let verbatimTargetUri: string;

  test.beforeEach(async ({ sql }) => {
    const handle = `user-${DID.split(':').pop()}`;
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${handle})
      ON CONFLICT (did) DO NOTHING
    `;
    const seed = await seedProtocol(sql, DID);
    protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${seed.protocolRkey}`;
    verbatimTargetUri = seed.verbatimTargetUri;
    await seedSurvey(sql, DID, protocolAtUri);
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('returns 422 when protocols param is missing', async ({ request }) => {
    const resp = await request.get('/api/stats');
    expect(resp.status()).toBe(422);
  });

  test('returns stats for a valid protocol URI', async ({ request }) => {
    const params = new URLSearchParams({ protocols: protocolAtUri });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.surveyCount).toBe(1);
    expect(body.taxa).toBeDefined();
    expect(Array.isArray(body.targets)).toBe(true);
  });

  test('targets includes verbatim-scoped targets with label', async ({
    request,
    sql,
  }) => {
    const { surveyAtUri } = await seedSurvey(sql, DID, protocolAtUri);
    await seedOccurrence(
      sql,
      DID,
      surveyAtUri,
      protocolAtUri,
      verbatimTargetUri,
    );

    const params = new URLSearchParams({ protocols: protocolAtUri });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    const verbatimTarget = body.targets.find(
      (t: { protocolTargetUri: string }) =>
        t.protocolTargetUri === verbatimTargetUri,
    );
    expect(verbatimTarget).toBeDefined();
    expect(verbatimTarget.label).toBe('All birds');
    expect(verbatimTarget.scopeType).toBe('verbatim');
  });

  test('bbox filter returns surveys within bounds', async ({
    request,
    sql,
  }) => {
    await seedSurveyWithCoordinates(
      sql,
      DID,
      protocolAtUri,
      'SF Location',
      '37.7749',
      '-122.4194',
    );
    const params = new URLSearchParams({
      protocols: protocolAtUri,
      bboxNorth: '38',
      bboxSouth: '37',
      bboxEast: '-122',
      bboxWest: '-123',
    });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.surveyCount).toBeGreaterThanOrEqual(1);
  });

  test('bbox filter excludes surveys outside bounds', async ({
    request,
    sql,
  }) => {
    await seedSurveyWithCoordinates(
      sql,
      DID,
      protocolAtUri,
      'SF Location',
      '37.7749',
      '-122.4194',
    );
    const params = new URLSearchParams({
      protocols: protocolAtUri,
      bboxNorth: '42',
      bboxSouth: '40',
      bboxEast: '-70',
      bboxWest: '-75',
    });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.surveyCount).toBe(0);
  });

  test('handles organism quantity larger than INT4 max without error', async ({
    request,
    sql,
  }) => {
    const { surveyAtUri } = await seedSurvey(sql, DID, protocolAtUri);
    const { taxonTargetUri } = await seedProtocol(sql, DID);
    await seedOccurrence(
      sql,
      DID,
      surveyAtUri,
      protocolAtUri,
      taxonTargetUri,
      '3000000000',
    );
    const params = new URLSearchParams({ protocols: protocolAtUri });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.totalIndividuals).toBeGreaterThanOrEqual(3000000000);
  });

  test('totalIndividuals excludes incidental occurrences', async ({
    request,
    sql,
  }) => {
    const { surveyAtUri } = await seedSurvey(sql, DID, protocolAtUri);
    await seedIncidentalOccurrence(
      sql,
      DID,
      surveyAtUri,
      'https://www.inaturalist.org/taxa/99999',
      'Incidentalis incidentalis',
    );
    const params = new URLSearchParams({ protocols: protocolAtUri });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.totalIndividuals).toBe(0);
  });

  test('taxa list excludes incidental occurrences', async ({
    request,
    sql,
  }) => {
    const surveyAtUri = `at://${DID}/bio.cuanto.survey/testsurvey-incidental`;
    await sql`
      INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
      VALUES (
        ${surveyAtUri}, ${DID}, ${'testsurvey-incidental'}, ${protocolAtUri},
        now(),
        ${sql.json({ $type: 'bio.cuanto.survey', protocol: { uri: protocolAtUri }, createdAt: new Date().toISOString() })},
        now()
      )
      ON CONFLICT (at_uri) DO NOTHING
    `;
    await seedIncidentalOccurrence(
      sql,
      DID,
      surveyAtUri,
      'https://www.inaturalist.org/taxa/99999',
      'Incidentalis incidentalis',
    );

    const params = new URLSearchParams({ protocols: protocolAtUri });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    const taxonIds = body.taxa.map((t: { taxonId: string }) => t.taxonId);
    expect(taxonIds).not.toContain('https://www.inaturalist.org/taxa/99999');
  });

  test('returns 422 when surveyedBy is not a valid DID', async ({
    request,
  }) => {
    const params = new URLSearchParams({
      protocols: protocolAtUri,
      surveyedBy: 'not-a-did',
    });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(422);
  });

  test('surveyedBy restricts survey counts to that surveyor alone', async ({
    request,
    sql,
  }) => {
    const otherDid = 'did:test:stats-spec-other';
    await sql`
      INSERT INTO users (did, handle) VALUES (${otherDid}, 'other-surveyor')
      ON CONFLICT (did) DO NOTHING
    `;
    try {
      await seedSurvey(sql, otherDid, protocolAtUri);

      // beforeEach already seeded one survey for DID, so with both surveyors
      // counted the protocol shows two.
      const unfiltered = await request.get(
        `/api/stats?${new URLSearchParams({ protocols: protocolAtUri })}`,
      );
      expect((await unfiltered.json()).surveyCount).toBe(2);

      const filteredToDid = await request.get(
        `/api/stats?${new URLSearchParams({ protocols: protocolAtUri, surveyedBy: DID })}`,
      );
      expect((await filteredToDid.json()).surveyCount).toBe(1);

      const filteredToOther = await request.get(
        `/api/stats?${new URLSearchParams({ protocols: protocolAtUri, surveyedBy: otherDid })}`,
      );
      expect((await filteredToOther.json()).surveyCount).toBe(1);
    } finally {
      await teardownDid(sql, otherDid);
    }
  });

  test('surveyedBy alone (no protocols) aggregates across every protocol the user has surveyed under', async ({
    request,
    sql,
  }) => {
    const { protocolRkey: secondRkey } = await seedProtocol(
      sql,
      DID,
      'Second Test Protocol',
    );
    const secondProtocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${secondRkey}`;
    await seedSurvey(sql, DID, secondProtocolAtUri);

    // beforeEach already seeded one survey under protocolAtUri; this adds a
    // second survey under a different protocol, so a surveyCount of 2 here
    // only holds if surveyedBy alone isn't implicitly scoped to one protocol.
    const params = new URLSearchParams({ surveyedBy: DID });
    const resp = await request.get(`/api/stats?${params}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.surveyCount).toBe(2);
  });
});
