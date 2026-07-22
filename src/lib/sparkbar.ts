import { nice, ticks } from 'd3-array';
import type { WeeklyPoint } from '$lib/server/db/stats';

// The largest weekly mean across every series in a table, used as the shared
// ceiling so bar heights are comparable from row to row. Without this each
// sparkbar would scale to its own peak and a rare taxon would look identical
// to an abundant one.
export function seriesMax(
  weekly: Record<string, WeeklyPoint[]> | undefined,
): number {
  if (!weekly) return 0;
  let max = 0;
  for (const points of Object.values(weekly)) {
    for (const point of points) {
      if (point.mean !== null && point.mean > max) max = point.mean;
    }
  }
  return max;
}

// Means are rarely round; two decimals unless it is an integer.
export function formatMean(mean: number): string {
  return Number.isInteger(mean) ? String(mean) : mean.toFixed(2);
}

// One sentence describing the whole series, for readers who get the chart as a
// single image rather than as ten bars. Shared so the table sparkbar, the
// drill-in chart, and the button that opens it all describe a row identically.
export function seriesSummary(points: WeeklyPoint[]): string {
  const surveyed = points.filter((p) => p.mean !== null);
  if (surveyed.length === 0) {
    return `No surveys in the last ${points.length} weeks`;
  }
  const means = surveyed.map((p) => p.mean as number);
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  return (
    `Mean count per survey over the last ${points.length} weeks: ` +
    `averaging ${formatMean(mean)}, ranging ${formatMean(Math.min(...means))} ` +
    `to ${formatMean(Math.max(...means))}, across ` +
    `${surveyed.length} surveyed weeks`
  );
}

// How many labeled values the y axis aims for. d3 treats this as a hint and
// will return a few more or fewer to keep the step a round number.
const Y_TICK_TARGET = 4;

export type YAxis = {
  // The ceiling the bars are drawn against, rounded up from the data max to
  // whatever value the topmost tick landed on. Charts must scale to this rather
  // than to the raw max, or the top bar would overshoot its own axis.
  max: number;
  values: number[];
};

// Round numbers for the y axis, via d3-array so the 1/2/5 step selection and
// the floating point cleanup (0.1, 0.2, 0.3 rather than 0.30000000000000004)
// are not hand-rolled. Only the tick math is borrowed; the pixel mapping lives
// in markFor, which is why d3-scale is not a dependency.
export function yTicks(dataMax: number): YAxis {
  // A series with nothing counted has no magnitude to label. d3 would hand back
  // a lone 0, which draws an axis implying the scale means something.
  if (dataMax <= 0) return { max: 0, values: [] };
  const [, max] = nice(0, dataMax, Y_TICK_TARGET);
  return { max, values: ticks(0, max, Y_TICK_TARGET) };
}

export type ScaleType = 'sqrt' | 'linear';

export type MarkGeometry = {
  barWidth: number;
  chartHeight: number;
  // Shared ceiling across every row, from seriesMax, or the nicened ceiling
  // from yTicks when an axis is drawn.
  max: number;
  scale: ScaleType;
};

// A week is one of three things, and they are different in kind rather than in
// degree: a filled bar means "found some", an outline means "looked, found
// none", a dot means "did not look". Both the table sparkbar and the dialog
// chart resolve that here so the vocabulary cannot drift between them; each
// still styles the result itself, since the larger chart wants heavier strokes.
export type Mark =
  | { kind: 'bar'; x: number; y: number; width: number; height: number }
  | { kind: 'zero'; x: number; y: number; width: number; height: number }
  | { kind: 'none'; cx: number; cy: number; r: number };

// Pixel y for a value, with 0 at the bottom edge of the plot and the ceiling at
// the top. The y axis labels and the bar tops both come from here, so a
// labelled gridline always lands exactly where a bar of that value would end.
export function projectY(value: number, geo: MarkGeometry): number {
  const { chartHeight, max, scale } = geo;
  if (max <= 0) return chartHeight;
  const ratio =
    scale === 'sqrt' ? Math.sqrt(value) / Math.sqrt(max) : value / max;
  return chartHeight - ratio * chartHeight;
}

// Ceiling on the floor band. Half the bar width keeps the mark in proportion at
// sparkbar size, but the dialog chart's 20px bars would give a 10px band, which
// on a 200px plot is 5% of full height and starts reading as a small magnitude
// rather than as a floor. Capping holds it to a marker.
const MAX_FLOOR = 6;

// The zero outline and the shortest bar share this height, so neither state can
// appear to outrank the other; fill is what separates them. Derived from bar
// width so a wider chart gets a proportionate mark, bounded so it never implies
// a quantity.
function floorHeight(barWidth: number): number {
  return Math.max(2, Math.min(barWidth / 2, MAX_FLOOR));
}

export function markFor(
  point: WeeklyPoint,
  x: number,
  geo: MarkGeometry,
): Mark {
  const { barWidth, chartHeight, max, scale } = geo;
  const floor = floorHeight(barWidth);

  if (point.mean === null) {
    const r = floor / 2;
    // Centered in the band the zero outline occupies, so all three states share
    // one visual floor.
    return { kind: 'none', cx: x + barWidth / 2, cy: chartHeight - r, r };
  }

  if (point.mean === 0) {
    return {
      kind: 'zero',
      x,
      y: chartHeight - floor,
      width: barWidth,
      height: floor,
    };
  }

  // A ceiling of zero alongside a positive mean is contradictory data, since
  // the ceiling is the largest mean seen. Rather than divide by it and emit NaN
  // geometry, fall back to the floor: visible, and not a claim about magnitude.
  if (max <= 0) {
    return {
      kind: 'bar',
      x,
      y: chartHeight - floor,
      width: barWidth,
      height: floor,
    };
  }

  // Square root is the table default because weekly means span two orders of
  // magnitude: on a linear scale at 24px every row but the most abundant
  // collapses onto the baseline. Linear is offered in the dialog, where the
  // chart is tall enough for small values to survive and the y axis makes the
  // proportion worth reading literally.
  //
  // The floors differ for the same reason. Under sqrt a bar may not fall below
  // the zero mark, or a week that found something would rank below one that
  // found nothing. Under linear that floor would be a lie about magnitude, so
  // it drops to a single pixel: enough that a counted week always leaves ink,
  // little enough that the reader sees how small it really is.
  const minHeight = scale === 'sqrt' ? floor : 1;
  const height = Math.max(minHeight, chartHeight - projectY(point.mean, geo));
  return { kind: 'bar', x, y: chartHeight - height, width: barWidth, height };
}

// Labels the first week that *starts* in each month, unlike monthTicks below,
// which labels the week a month began inside. The drill-in chart prints each
// week's start day directly above this strip, so the month name has to agree
// with the number it sits under: "Jul" beneath a "29" that means June 29 reads
// as July 29. The cost is that the marker can sit up to six days after the
// month actually began, which is invisible across a ten-week axis. The sparkbar
// has no day numbers to disagree with, so it keeps the boundary-accurate form.
export function weekStartMonthTicks(weekStarts: string[]): MonthTick[] {
  const ticks: MonthTick[] = [];
  let previousMonth: number | null = null;
  weekStarts.forEach((weekStart, index) => {
    const start = new Date(`${weekStart}T00:00:00Z`);
    const month = start.getUTCMonth();
    // The opening week is always labelled. Its month is simply the month of its
    // own start date, and without it every week before the first change would
    // carry no month at all.
    if (previousMonth === null || month !== previousMonth) {
      ticks.push({
        index,
        label: start.toLocaleDateString(undefined, {
          month: 'short',
          timeZone: 'UTC',
        }),
      });
    }
    previousMonth = month;
  });
  return ticks;
}

export type MonthTick = {
  // Index into the week list, i.e. which bar the label sits above.
  index: number;
  label: string;
};

// Labels the week in which a month began, not the week whose Monday happens to
// fall in a new month: a week running Jun 29 to Jul 5 is where July started, so
// it carries "Jul" even though its own weekStart is in June. Only boundaries
// get a label, so the weeks before the first one stay bare rather than
// borrowing a month name that did not begin there.
export function monthTicks(weekStarts: string[]): MonthTick[] {
  const ticks: MonthTick[] = [];
  weekStarts.forEach((weekStart, index) => {
    const start = new Date(`${weekStart}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    // A week contains the 1st either by starting on it or by crossing into the
    // next month partway through. Seven days from the 1st never reaches another
    // month, so the month at the end of the week is always the one that began.
    const startsMonth = start.getUTCDate() === 1;
    if (!startsMonth && end.getUTCMonth() === start.getUTCMonth()) return;
    ticks.push({
      index,
      label: end.toLocaleDateString(undefined, {
        month: 'short',
        timeZone: 'UTC',
      }),
    });
  });
  return ticks;
}
