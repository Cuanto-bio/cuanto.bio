import type { Sql } from 'postgres';
import {
  expect,
  seedOccurrence,
  seedProtocol,
  seedSurvey,
  seedSurveyTarget,
  teardownDid,
  test,
} from './fixtures.js';

// Exercises the weekly-series SQL against a real database. The unit tests in
// src/lib/server/db/stats.test.ts mock `sql` entirely, so the absence-based
// denominator (the whole point of the metric) is only covered here.

const DID = 'did:test:stats-weekly-spec';

// Anchor everything to a fixed Monday so bin boundaries are deterministic, then
// express survey dates as offsets from "now" to stay inside the 10-week window.
function weeksAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n * 7);
  return d;
}

function weekKey(d: Date): string {
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7));
  return out.toISOString().slice(0, 10);
}

type WeeklyPoint = {
  weekStart: string;
  mean: number | null;
  surveyCount: number;
  totalCount: number;
};

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';

// seedSurveyTarget writes an empty scope, but the taxa queries derive taxonID
// from the surveyTarget's copied scope, so a taxon-scoped target needs one.
async function setSurveyTargetScope(
  sql: Sql,
  surveyTargetUri: string,
  taxonId: string,
  scientificName: string,
): Promise<void> {
  await sql`
    UPDATE survey_targets
    SET record = jsonb_set(
      record,
      '{scope}',
      ${sql.json([
        {
          $type: 'bio.cuanto.protocolTarget#taxonScope',
          scientificName,
          taxonID: taxonId,
        },
      ])}::jsonb
    )
    WHERE at_uri = ${surveyTargetUri}
  `;
}

// seedProtocol always builds the same target set, so a protocol whose targets
// differ has to be seeded explicitly.
async function seedProtocolTargetingTaxon(
  sql: Sql,
  did: string,
  title: string,
  taxonId: string,
  scientificName: string,
): Promise<string> {
  const rkey = `otherproto${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const atUri = `at://${did}/bio.cuanto.surveyProtocol/${rkey}`;
  await sql`
    INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${FAKE_CID}, ${sql.json({
      $type: 'bio.cuanto.surveyProtocol',
      title,
      createdAt: new Date().toISOString(),
      requiredFields: [],
    })}, now())
  `;
  const targetRkey = `othertarget${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await sql`
    INSERT INTO protocol_targets (at_uri, did, rkey, protocol_uri, record, indexed_at)
    VALUES (
      ${`at://${did}/bio.cuanto.protocolTarget/${targetRkey}`},
      ${did}, ${targetRkey}, ${atUri},
      ${sql.json({
        $type: 'bio.cuanto.protocolTarget',
        protocol: atUri,
        createdAt: new Date().toISOString(),
        scope: [
          {
            $type: 'bio.cuanto.protocolTarget#taxonScope',
            scientificName,
            taxonID: taxonId,
          },
        ],
      })}, now()
    )
  `;
  return atUri;
}

test.describe('weekly target series', () => {
  let protocolAtUri: string;
  let taxonTargetUri: string;

  test.beforeEach(async ({ sql }) => {
    const handle = `user-${DID.split(':').pop()}`;
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${handle})
      ON CONFLICT (did) DO NOTHING
    `;
    const seeded = await seedProtocol(sql, DID);
    protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${seeded.protocolRkey}`;
    taxonTargetUri = seeded.taxonTargetUri;
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('divides total count by surveys that sought the target', async ({
    sql,
    request,
  }) => {
    const when = weeksAgo(2);
    // The target has existed all along, so both surveys sought it.
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
    );
    const a = await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      when.toISOString(),
    );
    await seedSurvey(sql, DID, protocolAtUri, 'Loc B', when.toISOString());
    await seedOccurrence(
      sql,
      DID,
      a.surveyAtUri,
      protocolAtUri,
      taxonTargetUri,
      '6',
    );

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    const series: WeeklyPoint[] = body.targetWeekly[taxonTargetUri];
    const point = series.find((p) => p.weekStart === weekKey(when));

    // 6 individuals over 2 surveys that sought the target, not 6 over the 1
    // survey that happened to detect it.
    expect(point?.surveyCount).toBe(2);
    expect(point?.totalCount).toBe(6);
    expect(point?.mean).toBe(3);
  });

  test('a surveyed week with no detection is zero, not a gap', async ({
    sql,
    request,
  }) => {
    const when = weeksAgo(3);
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
    );
    await seedSurvey(sql, DID, protocolAtUri, 'Loc A', when.toISOString());

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    const body = await resp.json();
    const series: WeeklyPoint[] = body.targetWeekly[taxonTargetUri];
    const point = series.find((p) => p.weekStart === weekKey(when));

    expect(point?.mean).toBe(0);
    expect(point?.surveyCount).toBe(1);
  });

  test('an unsurveyed week is null, not zero', async ({ sql, request }) => {
    const when = weeksAgo(3);
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
    );
    await seedSurvey(sql, DID, protocolAtUri, 'Loc A', when.toISOString());

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    const body = await resp.json();
    const series: WeeklyPoint[] = body.targetWeekly[taxonTargetUri];

    expect(series).toHaveLength(10);
    const quiet = series.find((p) => p.weekStart === weekKey(weeksAgo(6)));
    expect(quiet?.mean).toBeNull();
    expect(quiet?.surveyCount).toBe(0);
  });

  test('surveys before the target existed are excluded from the denominator', async ({
    sql,
    request,
  }) => {
    const before = weeksAgo(5);
    const after = weeksAgo(0);
    // Target born between the two surveys. The earlier one implies nothing
    // about this target; the later one is a real non-detection.
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(1),
    );
    await seedSurvey(sql, DID, protocolAtUri, 'Loc A', before.toISOString());
    await seedSurvey(sql, DID, protocolAtUri, 'Loc B', after.toISOString());

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    const body = await resp.json();
    const series: WeeklyPoint[] = body.targetWeekly[taxonTargetUri];

    expect(
      series.find((p) => p.weekStart === weekKey(before))?.mean,
    ).toBeNull();
    expect(series.find((p) => p.weekStart === weekKey(after))?.mean).toBe(0);
  });

  test('surveys after the target was retired are excluded from the denominator', async ({
    sql,
    request,
  }) => {
    const live = weeksAgo(6);
    const retired = weeksAgo(2);
    // Retired at 4 weeks ago, so the 6-week-old survey sought it and the
    // 2-week-old one did not.
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
      weeksAgo(4),
    );
    await seedSurvey(sql, DID, protocolAtUri, 'Loc A', live.toISOString());
    await seedSurvey(sql, DID, protocolAtUri, 'Loc B', retired.toISOString());

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    const body = await resp.json();
    const series: WeeklyPoint[] = body.targetWeekly[taxonTargetUri];

    expect(series.find((p) => p.weekStart === weekKey(live))?.mean).toBe(0);
    expect(
      series.find((p) => p.weekStart === weekKey(retired))?.mean,
    ).toBeNull();
  });

  test('a target sought but never detected still gets an all-zero series', async ({
    sql,
    request,
  }) => {
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
    );
    await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      weeksAgo(2).toISOString(),
    );

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    const body = await resp.json();

    // Absent from `targets` (which requires an occurrence) but present here.
    expect(body.targets).toHaveLength(0);
    expect(body.targetWeekly[taxonTargetUri]).toBeDefined();
    expect(
      body.targetWeekly[taxonTargetUri].some((p: WeeklyPoint) => p.mean === 0),
    ).toBe(true);
  });

  // The encoding is the point of the metric: a week that was surveyed and
  // found nothing must not render as a small magnitude. Zero is drawn as an
  // outline, a detection as a filled bar, an unsurveyed week as neither.
  test('renders zero as an outline and a detection as a filled bar', async ({
    sql,
    page,
  }) => {
    const detected = weeksAgo(2);
    const empty = weeksAgo(3);
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
    );
    const a = await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      detected.toISOString(),
    );
    await seedSurvey(sql, DID, protocolAtUri, 'Loc B', empty.toISOString());
    await seedOccurrence(
      sql,
      DID,
      a.surveyAtUri,
      protocolAtUri,
      taxonTargetUri,
      '4',
    );

    const handle = `user-${DID.split(':').pop()}`;
    const rkey = protocolAtUri.split('/').at(-1);
    await page.goto(`/protocols/${handle}/${rkey}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Targets/ }).click();

    const sparkbar = page.locator('svg[role=img]').first();
    await expect(sparkbar).toBeVisible();

    // Exactly one detection week and one zero week were seeded.
    await expect(sparkbar.locator('rect.fill-current')).toHaveCount(1);
    await expect(sparkbar.locator('rect.stroke-current')).toHaveCount(1);

    const bar = sparkbar.locator('rect.fill-current');
    const zero = sparkbar.locator('rect.stroke-current');
    const barTop = Number(await bar.getAttribute('y'));
    const zeroTop = Number(await zero.getAttribute('y'));
    // The zero outline must never sit higher than a real bar, or the scale
    // reads inverted.
    expect(zeroTop).toBeGreaterThan(barTop);
  });

  // The tooltip is the only place exact numbers appear, and the modal tells
  // readers to hover for them. It is a native SVG <title>, which the browser
  // resolves from the topmost element under the pointer, so the transparent
  // hit area has to be painted above the mark. Getting that order wrong hides
  // the tooltip exactly where a reader aims, and nothing else would catch it.
  test('hovering the centre of a bar resolves a tooltip with exact numbers', async ({
    sql,
    page,
  }) => {
    const detected = weeksAgo(2);
    const empty = weeksAgo(3);
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
    );
    const a = await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      detected.toISOString(),
    );
    await seedSurvey(sql, DID, protocolAtUri, 'Loc B', empty.toISOString());
    await seedOccurrence(
      sql,
      DID,
      a.surveyAtUri,
      protocolAtUri,
      taxonTargetUri,
      '4',
    );

    const handle = `user-${DID.split(':').pop()}`;
    const rkey = protocolAtUri.split('/').at(-1);
    await page.goto(`/protocols/${handle}/${rkey}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Targets/ }).click();
    await expect(page.locator('svg[role=img]').first()).toBeVisible();

    // Probe the visual centre of each mark, the way a reader would point at it,
    // and resolve the tooltip the way a browser does.
    const probed = await page.evaluate(() => {
      const svg = document.querySelector('svg[role=img]');
      if (!svg) return null;
      const resolve = (el: Element | null) => {
        if (!el) return null;
        const rc = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rc.left + rc.width / 2,
          rc.top + rc.height / 2,
        );
        let node: Element | null = hit;
        while (node && node !== document.body) {
          const title = node.querySelector(':scope > title');
          if (title) return title.textContent;
          node = node.parentElement;
        }
        return null;
      };
      return {
        bar: resolve(svg.querySelector('rect.fill-current')),
        zero: resolve(svg.querySelector('rect.stroke-current')),
      };
    });

    expect(probed?.bar).toContain('per survey');
    expect(probed?.zero).toContain('per survey');
  });

  test('surveys outside the 10-week window are excluded', async ({
    sql,
    request,
  }) => {
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(30),
    );
    const old = await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      weeksAgo(20).toISOString(),
    );
    await seedOccurrence(
      sql,
      DID,
      old.surveyAtUri,
      protocolAtUri,
      taxonTargetUri,
      '99',
    );

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    const body = await resp.json();
    const series: WeeklyPoint[] | undefined = body.targetWeekly[taxonTargetUri];

    // The lifetime totals still see it, but the 10-week series must not.
    expect(body.targets[0]?.totalCount).toBe(99);
    expect(series?.every((p) => p.mean === null) ?? true).toBe(true);
  });
});

// The per-taxon denominator is every survey in the week, which is right for a
// single protocol but dilutes the mean once several are selected: surveys under
// a protocol that never sought the taxon would otherwise count against it.
test.describe('weekly taxon series across multiple protocols', () => {
  const QUERCUS = 'https://www.gbif.org/species/2878688';
  let protocolAtUri: string;
  let taxonTargetUri: string;

  test.beforeEach(async ({ sql }) => {
    const handle = `user-${DID.split(':').pop()}`;
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${handle})
      ON CONFLICT (did) DO NOTHING
    `;
    const seeded = await seedProtocol(sql, DID);
    protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${seeded.protocolRkey}`;
    taxonTargetUri = seeded.taxonTargetUri;
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('a protocol that never targets the taxon does not dilute its mean', async ({
    sql,
    request,
  }) => {
    const when = weeksAgo(2);
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
    );
    const a = await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      when.toISOString(),
    );
    await seedOccurrence(
      sql,
      DID,
      a.surveyAtUri,
      protocolAtUri,
      taxonTargetUri,
      '6',
    );
    await setSurveyTargetScope(
      sql,
      `at://${DID}/bio.cuanto.surveyTarget/${taxonTargetUri.split('/').at(-1)}`,
      QUERCUS,
      'Quercus agrifolia',
    );

    // A fungus protocol has nothing to say about an oak, so its survey must
    // not count toward the oak's denominator.
    const otherUri = await seedProtocolTargetingTaxon(
      sql,
      DID,
      'Fungus Protocol',
      'https://www.gbif.org/species/9999999',
      'Amanita muscaria',
    );
    await seedSurvey(sql, DID, otherUri, 'Loc B', when.toISOString());

    const protocols = [protocolAtUri, otherUri]
      .map(encodeURIComponent)
      .join(',');
    const resp = await request.get(`/api/stats?protocols=${protocols}`);
    const body = await resp.json();
    const series: WeeklyPoint[] = body.taxonWeekly[QUERCUS];
    const point = series.find((p) => p.weekStart === weekKey(when));

    expect(point?.surveyCount).toBe(1);
    expect(point?.mean).toBe(6);
  });

  test('a protocol that does target the taxon contributes a real zero', async ({
    sql,
    request,
  }) => {
    const when = weeksAgo(2);
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      taxonTargetUri,
      weeksAgo(9),
    );
    const a = await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      when.toISOString(),
    );
    await seedOccurrence(
      sql,
      DID,
      a.surveyAtUri,
      protocolAtUri,
      taxonTargetUri,
      '6',
    );
    await setSurveyTargetScope(
      sql,
      `at://${DID}/bio.cuanto.surveyTarget/${taxonTargetUri.split('/').at(-1)}`,
      QUERCUS,
      'Quercus agrifolia',
    );

    // This one sought the same oak and found none, which is a true absence and
    // must pull the mean down.
    const otherUri = await seedProtocolTargetingTaxon(
      sql,
      DID,
      'Other Oak Protocol',
      QUERCUS,
      'Quercus agrifolia',
    );
    await seedSurvey(sql, DID, otherUri, 'Loc B', when.toISOString());

    const protocols = [protocolAtUri, otherUri]
      .map(encodeURIComponent)
      .join(',');
    const resp = await request.get(`/api/stats?protocols=${protocols}`);
    const body = await resp.json();
    const series: WeeklyPoint[] = body.taxonWeekly[QUERCUS];
    const point = series.find((p) => p.weekStart === weekKey(when));

    expect(point?.surveyCount).toBe(2);
    expect(point?.mean).toBe(3);
  });
});

test.describe('malformed protocol target records', () => {
  test.beforeEach(async ({ sql }) => {
    const handle = `user-${DID.split(':').pop()}`;
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${handle})
      ON CONFLICT (did) DO NOTHING
    `;
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  // The indexer takes records off the firehose, so a protocolTarget whose scope
  // is not an array can reach the table even though the lexicon forbids it.
  // Every other jsonb access in the targets query degrades to null on bad
  // input; scope_count must not be the one that takes the endpoint down.
  test('a non-array scope does not fail the whole stats query', async ({
    sql,
    request,
  }) => {
    const seeded = await seedProtocol(sql, DID);
    const protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${seeded.protocolRkey}`;
    const when = weeksAgo(2);
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      seeded.taxonTargetUri,
      weeksAgo(9),
    );
    const survey = await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      when.toISOString(),
    );
    await seedOccurrence(
      sql,
      DID,
      survey.surveyAtUri,
      protocolAtUri,
      seeded.taxonTargetUri,
      '4',
    );

    // An object where the lexicon requires an array.
    await sql`
      UPDATE protocol_targets
      SET record = jsonb_set(record, '{scope}', ${sql.json({
        $type: 'bio.cuanto.protocolTarget#taxonScope',
        scientificName: 'Quercus agrifolia',
      })})
      WHERE at_uri = ${seeded.taxonTargetUri}
    `;

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    const target = body.targets.find(
      (t: { protocolTargetUri: string }) =>
        t.protocolTargetUri === seeded.taxonTargetUri,
    );
    // The row still reports its counts; only the scope-derived fields degrade.
    expect(target?.totalCount).toBe(4);
    expect(target?.scopeCount).toBe(0);
  });

  // protocol_targets is LEFT JOINed, so a survey_target whose protocol target
  // was never indexed leaves every pt-derived column null. scopeCount is typed
  // number, so it has to arrive as one.
  test('scopeCount is a number when the protocol target is missing', async ({
    sql,
    request,
  }) => {
    const seeded = await seedProtocol(sql, DID);
    const protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${seeded.protocolRkey}`;
    const when = weeksAgo(2);
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      seeded.taxonTargetUri,
      weeksAgo(9),
    );
    const survey = await seedSurvey(
      sql,
      DID,
      protocolAtUri,
      'Loc A',
      when.toISOString(),
    );
    await seedOccurrence(
      sql,
      DID,
      survey.surveyAtUri,
      protocolAtUri,
      seeded.taxonTargetUri,
      '5',
    );
    // survey_targets keeps its copy of the target, so the stats row survives.
    await sql`DELETE FROM protocol_targets WHERE at_uri = ${seeded.taxonTargetUri}`;

    const resp = await request.get(
      `/api/stats?protocols=${encodeURIComponent(protocolAtUri)}`,
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    const target = body.targets.find(
      (t: { protocolTargetUri: string }) =>
        t.protocolTargetUri === seeded.taxonTargetUri,
    );
    expect(target?.scopeCount).toBe(0);
    expect(typeof target?.scopeCount).toBe('number');
  });
});
