import { describe, expect, test } from 'vitest';
import type { WeeklyPoint } from '$lib/server/db/stats';
import {
  formatMean,
  markFor,
  monthTicks,
  projectY,
  seriesMax,
  seriesSummary,
  weekStartMonthTicks,
  yTicks,
} from './sparkbar';

function point(mean: number | null): WeeklyPoint {
  return {
    weekStart: '2026-07-20',
    mean,
    surveyCount: mean === null ? 0 : 1,
    totalCount: mean ?? 0,
  };
}

// Bar width 6 matches the table sparkbar, so the derived zero/floor band is 3
// and these expectations line up with what that chart already draws.
const GEO = { barWidth: 6, chartHeight: 24, max: 36, scale: 'sqrt' } as const;

describe('seriesMax', () => {
  test('returns the largest mean across every series', () => {
    expect(
      seriesMax({
        a: [point(1), point(4)],
        b: [point(9), point(2)],
      }),
    ).toBe(9);
  });

  test('ignores nulls from unsurveyed weeks', () => {
    expect(seriesMax({ a: [point(null), point(3), point(null)] })).toBe(3);
  });

  test('returns 0 when every series is all zeros', () => {
    expect(seriesMax({ a: [point(0), point(0)] })).toBe(0);
  });

  test('returns 0 for an empty record', () => {
    expect(seriesMax({})).toBe(0);
  });

  test('returns 0 when weekly data is missing', () => {
    expect(seriesMax(undefined)).toBe(0);
  });
});

describe('monthTicks', () => {
  test('labels a week that straddles a month boundary with the new month', () => {
    // Jun 29 through Jul 5, so July began mid-week.
    expect(monthTicks(['2026-06-29'])).toEqual([{ index: 0, label: 'Jul' }]);
  });

  test('labels a week that starts on the first of the month', () => {
    expect(monthTicks(['2026-06-01'])).toEqual([{ index: 0, label: 'Jun' }]);
  });

  test('leaves weeks wholly inside one month unlabeled', () => {
    expect(monthTicks(['2026-06-08', '2026-06-15'])).toEqual([]);
  });

  test('labels each boundary in a series by its index', () => {
    expect(
      monthTicks([
        '2026-05-25',
        '2026-06-01',
        '2026-06-08',
        '2026-06-15',
        '2026-06-22',
        '2026-06-29',
        '2026-07-06',
      ]),
    ).toEqual([
      { index: 1, label: 'Jun' },
      { index: 5, label: 'Jul' },
    ]);
  });

  test('labels a week that crosses into a new year', () => {
    // Dec 28 through Jan 3: the tick belongs to January, not December.
    expect(monthTicks(['2026-12-28'])).toEqual([{ index: 0, label: 'Jan' }]);
  });

  test('returns no ticks for an empty series', () => {
    expect(monthTicks([])).toEqual([]);
  });
});

describe('formatMean', () => {
  test('leaves an integer bare', () => {
    expect(formatMean(3)).toBe('3');
  });

  test('gives a fraction two decimals', () => {
    expect(formatMean(3.4)).toBe('3.40');
  });
});

describe('seriesSummary', () => {
  function week(weekStart: string, mean: number | null): WeeklyPoint {
    return {
      weekStart,
      mean,
      surveyCount: mean === null ? 0 : 1,
      totalCount: mean ?? 0,
    };
  }

  test('describes the range and the number of surveyed weeks', () => {
    const summary = seriesSummary([
      week('2026-06-01', 1),
      week('2026-06-08', 4),
      week('2026-06-15', null),
    ]);
    expect(summary).toBe(
      'Mean count per survey over the last 3 weeks: averaging 2.50, ' +
        'ranging 1 to 4, across 2 surveyed weeks',
    );
  });

  test('says so when nothing was surveyed', () => {
    expect(seriesSummary([week('2026-06-01', null)])).toBe(
      'No surveys in the last 1 weeks',
    );
  });

  test('counts a zero week as surveyed', () => {
    // Zero is a measurement, so it belongs in the average and the count.
    expect(seriesSummary([week('2026-06-01', 0), week('2026-06-08', 4)])).toBe(
      'Mean count per survey over the last 2 weeks: averaging 2, ' +
        'ranging 0 to 4, across 2 surveyed weeks',
    );
  });

  test('handles an empty series without producing NaN', () => {
    expect(seriesSummary([])).toBe('No surveys in the last 0 weeks');
  });
});

describe('weekStartMonthTicks', () => {
  test('labels the first week with the month its start falls in', () => {
    // May 18, so the strip opens with "May" rather than with nothing.
    expect(weekStartMonthTicks(['2026-05-18'])).toEqual([
      { index: 0, label: 'May' },
    ]);
  });

  test('labels the first week that starts in a new month', () => {
    // Jun 29 runs into July, but it is still a June week: labelling it "Jul"
    // would put that name under a "29" and read as July 29. Jul 6 is the first
    // week whose own start is in July.
    expect(
      weekStartMonthTicks(['2026-06-22', '2026-06-29', '2026-07-06']),
    ).toEqual([
      { index: 0, label: 'Jun' },
      { index: 2, label: 'Jul' },
    ]);
  });

  test('leaves later weeks inside one month unlabeled', () => {
    expect(
      weekStartMonthTicks(['2026-06-08', '2026-06-15', '2026-06-22']),
    ).toEqual([{ index: 0, label: 'Jun' }]);
  });

  test('does not label a week twice when it both opens and changes', () => {
    expect(weekStartMonthTicks(['2026-06-01', '2026-06-08'])).toEqual([
      { index: 0, label: 'Jun' },
    ]);
  });

  test('labels a change across a year boundary', () => {
    // Dec 28 runs into January but starts in December; Jan 4 is the January
    // week.
    expect(weekStartMonthTicks(['2026-12-28', '2027-01-04'])).toEqual([
      { index: 0, label: 'Dec' },
      { index: 1, label: 'Jan' },
    ]);
  });

  test('returns no ticks for an empty series', () => {
    expect(weekStartMonthTicks([])).toEqual([]);
  });
});

describe('yTicks', () => {
  test('rounds the ceiling up to a clean value', () => {
    expect(yTicks(42)).toEqual({ max: 50, values: [0, 10, 20, 30, 40, 50] });
  });

  test('leaves an already-clean ceiling alone', () => {
    expect(yTicks(1000).max).toBe(1000);
  });

  test('handles fractional means without floating point noise', () => {
    expect(yTicks(0.4)).toEqual({ max: 0.4, values: [0, 0.1, 0.2, 0.3, 0.4] });
  });

  test('handles means well below 1', () => {
    expect(yTicks(0.04).values).toEqual([0, 0.01, 0.02, 0.03, 0.04]);
  });

  test('gives an all-zero series no axis to draw', () => {
    // Every week was surveyed and none found anything. There is no magnitude
    // to label, and a [0] axis would imply the scale means something.
    expect(yTicks(0)).toEqual({ max: 0, values: [] });
  });

  test('gives an empty series no axis to draw', () => {
    expect(yTicks(-1)).toEqual({ max: 0, values: [] });
  });
});

describe('projectY', () => {
  test('puts the ceiling at the top and zero at the bottom', () => {
    expect(projectY(36, GEO)).toBe(0);
    expect(projectY(0, GEO)).toBe(24);
  });

  test('places a labelled gridline where a bar of that value ends', () => {
    // The axis and the bars must agree, so this is the same 9 -> 12 the bar
    // case asserts.
    const mark = markFor(point(9), 0, GEO);
    expect(projectY(9, GEO)).toBe(mark.kind === 'bar' ? mark.y : -1);
  });

  test('compresses the low end under sqrt', () => {
    // A quarter of the ceiling sits at half height, not a quarter.
    expect(projectY(9, GEO)).toBe(12);
  });

  test('is proportional under linear', () => {
    expect(projectY(9, { ...GEO, scale: 'linear' })).toBe(18);
  });

  test('collapses to the baseline when there is no ceiling', () => {
    expect(projectY(5, { ...GEO, max: 0 })).toBe(24);
  });
});

describe('markFor', () => {
  test('draws a counted week as a filled bar', () => {
    // 36 is the ceiling, so a mean of 9 is sqrt(9)/sqrt(36) = half height.
    expect(markFor(point(9), 0, GEO)).toEqual({
      kind: 'bar',
      x: 0,
      y: 12,
      width: 6,
      height: 12,
    });
  });

  test('draws a surveyed-but-empty week as a zero outline, not a short bar', () => {
    expect(markFor(point(0), 0, GEO)).toEqual({
      kind: 'zero',
      x: 0,
      y: 21,
      width: 6,
      height: 3,
    });
  });

  test('draws an unsurveyed week as a dot', () => {
    expect(markFor(point(null), 0, GEO)).toEqual({
      kind: 'none',
      cx: 3,
      cy: 22.5,
      r: 1.5,
    });
  });

  test('floors a tiny sqrt bar at the zero mark so it stays legible', () => {
    // Without a floor this would be 0.5px. It must not fall below the zero
    // outline either, or a week that found something would rank under one that
    // found nothing.
    const mark = markFor(point(0.0625), 0, GEO);
    expect(mark).toMatchObject({ kind: 'bar', height: 3 });
  });

  test('lets a tiny linear bar fall below the zero mark', () => {
    // The whole reason to switch to linear is to see true proportion, so the
    // sqrt floor is dropped. Fill is what still separates it from a zero week.
    const mark = markFor(point(0.0625), 0, { ...GEO, scale: 'linear' });
    expect(mark).toMatchObject({ kind: 'bar', height: 1 });
  });

  test('keeps a nonzero linear bar visible rather than vanishing', () => {
    const mark = markFor(point(1e-9), 0, { ...GEO, scale: 'linear' });
    expect(mark).toMatchObject({ kind: 'bar', height: 1 });
  });

  test('scales linearly when asked to', () => {
    // Half the ceiling is half the height, unlike sqrt where it would be ~71%.
    expect(markFor(point(18), 0, { ...GEO, scale: 'linear' })).toMatchObject({
      kind: 'bar',
      height: 12,
    });
  });

  test('offsets every mark by the x it is given', () => {
    expect(markFor(point(9), 40, GEO)).toMatchObject({ x: 40 });
    expect(markFor(point(0), 40, GEO)).toMatchObject({ x: 40 });
    expect(markFor(point(null), 40, GEO)).toMatchObject({ cx: 43 });
  });

  test('caps the zero band so it stays a marker on the larger chart', () => {
    // Half of a 20px bar would be 10px, which is 5% of a 200px plot and starts
    // reading as a quantity rather than as the floor.
    const wide = { ...GEO, barWidth: 20, chartHeight: 200, max: 36 };
    expect(markFor(point(0), 0, wide)).toMatchObject({ height: 6, y: 194 });
    expect(markFor(point(null), 0, wide)).toMatchObject({ r: 3, cy: 197 });
  });

  test('falls back to the floor when the ceiling is zero', () => {
    // seriesMax returns 0 when nothing was ever counted; dividing by it would
    // produce NaN geometry and an invisible chart.
    const mark = markFor(point(5), 0, { ...GEO, max: 0 });
    expect(mark).toMatchObject({ kind: 'bar', height: 3 });
  });
});
