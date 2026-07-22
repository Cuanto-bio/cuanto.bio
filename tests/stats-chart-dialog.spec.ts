import {
  expect,
  seedOccurrence,
  seedProtocol,
  seedSurvey,
  seedSurveyTarget,
  teardownDid,
  test,
} from './fixtures.js';

// The drill-in chart the table sparkbars open. Covered here rather than in unit
// tests because the parts worth protecting are the wiring: which marks reach
// the DOM, that the scale toggle actually redraws, and that wrapping the
// sparkbar in a button did not hide its summary from assistive tech.

const DID = 'did:test:stats-chart-dialog';

function weeksAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n * 7);
  return d;
}

test.describe('trend chart dialog', () => {
  let protocolAtUri: string;

  test.beforeEach(async ({ sql }) => {
    const handle = `user-${DID.split(':').pop()}`;
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${handle})
      ON CONFLICT (did) DO NOTHING
    `;
    const seeded = await seedProtocol(sql, DID);
    protocolAtUri = `at://${DID}/bio.cuanto.surveyProtocol/${seeded.protocolRkey}`;
    await seedSurveyTarget(
      sql,
      DID,
      protocolAtUri,
      seeded.taxonTargetUri,
      weeksAgo(9),
    );
    // Two weeks with counts and one surveyed week with none, so all three mark
    // kinds plus a non-flat effort line are present.
    for (const [weeks, count] of [
      [2, '6'],
      [4, '2'],
    ] as const) {
      const survey = await seedSurvey(
        sql,
        DID,
        protocolAtUri,
        'Loc',
        weeksAgo(weeks).toISOString(),
      );
      await seedOccurrence(
        sql,
        DID,
        survey.surveyAtUri,
        protocolAtUri,
        seeded.taxonTargetUri,
        count,
      );
    }
    await seedSurvey(sql, DID, protocolAtUri, 'Loc', weeksAgo(6).toISOString());
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  // The seed has no accepted identifications, so the taxa-derived tabs stay
  // empty and the sparkbars live on the Targets tab. Inactive tab panels are
  // hidden from the accessibility tree, so the tab has to be selected before
  // anything inside it is reachable.
  async function openTargetsTab(page: import('@playwright/test').Page) {
    await page.goto(
      `/stats?${new URLSearchParams({ protocols: protocolAtUri })}`,
    );
    await page.getByRole('tab', { name: /Targets/ }).click();
    const trigger = page
      .getByRole('button', { name: /Show a larger trend chart/ })
      .first();
    await expect(trigger).toBeVisible();
    return trigger;
  }

  async function openFirstChart(page: import('@playwright/test').Page) {
    const trigger = await openTargetsTab(page);
    await trigger.click();
    return page.getByRole('dialog');
  }

  test('opens a larger chart from a sparkbar', async ({ page }) => {
    const dialog = await openFirstChart(page);
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Mean count per survey, one bar per week/),
    ).toBeVisible();
    await expect(dialog.locator('svg[role="img"]')).toBeVisible();
  });

  test('draws a y axis, which the table sparkbar has none of', async ({
    page,
  }) => {
    const dialog = await openFirstChart(page);
    // The zero label anchors the axis even though no rule is drawn at zero.
    await expect(
      dialog.locator('svg text').filter({ hasText: /^0$/ }),
    ).toHaveCount(1);
    // At least one labelled gridline above zero.
    expect(
      await dialog.locator('svg line.stroke-border').count(),
    ).toBeGreaterThan(0);
  });

  test('shows the effort panel with its own caption', async ({ page }) => {
    const dialog = await openFirstChart(page);
    await expect(dialog.getByText('Surveys / week')).toBeVisible();
    await expect(dialog.locator('svg polyline')).toHaveCount(1);
  });

  test('switching to linear redraws the bars', async ({ page }) => {
    const dialog = await openFirstChart(page);
    const bar = dialog.locator('svg rect.fill-current').first();
    const sqrtHeight = await bar.getAttribute('height');

    await dialog.getByRole('radio', { name: 'Linear' }).click();
    await expect(
      dialog.getByText(/Heights are in true proportion/),
    ).toBeVisible();
    const linearHeight = await bar.getAttribute('height');

    // Square root lifts everything below the ceiling, so a sub-peak bar has to
    // shrink when the scale becomes proportional. Equal heights would mean the
    // toggle changed the prose and nothing else.
    expect(Number(linearHeight)).toBeLessThan(Number(sqrtHeight));
  });

  test('the toggle cannot be left with no scale selected', async ({ page }) => {
    const dialog = await openFirstChart(page);
    const sqrt = dialog.getByRole('radio', { name: 'Square root' });
    // Clicking the active item in a single-select ToggleGroup deselects it;
    // the chart must fall back to its default rather than blanking.
    await sqrt.click();
    await expect(dialog.locator('svg rect.fill-current').first()).toBeVisible();
    await expect(
      dialog.getByText(/Heights are compressed|Heights are in true proportion/),
    ).toBeVisible();
  });

  test('the trigger keeps the series summary available to screen readers', async ({
    page,
  }) => {
    const trigger = await openTargetsTab(page);
    // The button's own name is the action; the numbers ride along as its
    // description, which is what the svg's aria-label used to carry before the
    // button wrapped it.
    const describedBy = await trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveText(
      /Mean count per survey over the last \d+ weeks|No surveys in the last/,
    );
  });
});
