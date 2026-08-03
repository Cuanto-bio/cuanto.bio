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
});
