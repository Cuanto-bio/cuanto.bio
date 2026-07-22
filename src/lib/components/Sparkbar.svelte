<script lang="ts">
import type { WeeklyPoint } from '$lib/server/db/stats';
import { formatMean, markFor, monthTicks, seriesSummary } from '$lib/sparkbar';
import { cn } from '$lib/utils';

let {
  points,
  max,
  axis = true,
  class: className,
}: {
  points: WeeklyPoint[];
  // The largest weekly mean across every row in the table, so heights are
  // comparable between rows. Callers get it from seriesMax in $lib/sparkbar.
  max: number;
  // Off for the legend swatches, whose weeks are fabricated: a month name there
  // would date an example rather than describe any real survey.
  axis?: boolean;
  class?: string;
} = $props();

const BAR_WIDTH = 6;
const GAP = 2;
// Height of the bars alone. The month axis is stacked below it, so the drawn
// height and the plotting floor are no longer the same number.
const CHART_HEIGHT = 24;
// The three-state mark vocabulary is resolved in $lib/sparkbar so this chart
// and the drill-in dialog cannot disagree about what a week looks like. Bar
// width sets the floor band there: 6 gives the 3px band this chart has always
// drawn, and the matching 1.5px no-data dot.
const GEOMETRY = $derived({
  barWidth: BAR_WIDTH,
  chartHeight: CHART_HEIGHT,
  max,
  scale: 'sqrt' as const,
});
const TICK_HEIGHT = 2;
const FONT_SIZE = 9;
// Approximate metrics for a 9px sans face. They only need to be close: they
// exist so the box is budgeted from the label's real ink rather than from its
// baseline, which would leave the descender of a capital J -- every month
// abbreviation the axis can draw starts with one in some locale -- hanging
// outside the viewBox and into the row below.
const CAP_HEIGHT = 7;
const DESCENDER = 2;
const LABEL_BASELINE = CHART_HEIGHT + TICK_HEIGHT + 1 + CAP_HEIGHT;
const AXIS_HEIGHT = LABEL_BASELINE + DESCENDER - CHART_HEIGHT;

const width = $derived(
  points.length * BAR_WIDTH + Math.max(0, points.length - 1) * GAP,
);

// The axis strip is reserved whenever it is switched on, whether or not this
// particular series happens to cross a month boundary, so every row in a table
// is the same height.
const HEIGHT = $derived(axis ? CHART_HEIGHT + AXIS_HEIGHT : CHART_HEIGHT);

const ticks = $derived(axis ? monthTicks(points.map((p) => p.weekStart)) : []);

function barX(index: number): number {
  return index * (BAR_WIDTH + GAP);
}

function formatWeek(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function pointLabel(point: WeeklyPoint): string {
  const week = `Week of ${formatWeek(point.weekStart)}`;
  if (point.mean === null) return `${week}: not surveyed`;
  const surveys =
    point.surveyCount === 1 ? '1 survey' : `${point.surveyCount} surveys`;
  return `${week}: ${formatMean(point.mean)} per survey (${point.totalCount} across ${surveys})`;
}

// Screen readers get the summary rather than 10 individual bars.
const summary = $derived(seriesSummary(points));
</script>

{#if points.length > 0}
  <svg
    class={cn('overflow-visible text-foreground/80', className)}
    width={width}
    height={HEIGHT}
    viewBox="0 0 {width} {HEIGHT}"
    role="img"
    aria-label={summary}
  >
    {#each points as point, i (point.weekStart)}
      {@const x = barX(i)}
      {@const mark = markFor(point, x, GEOMETRY)}
      {#if mark.kind === 'zero'}
        <!-- Inset by half the stroke width so the 1px outline lands on whole
             pixels instead of straddling two. -->
        <rect
          class="fill-none stroke-current"
          x={mark.x + 0.5}
          y={mark.y + 0.5}
          width={mark.width - 1}
          height={mark.height - 1}
          stroke-width="1"
          rx="1"
        />
      {:else if mark.kind === 'none'}
        <!-- Every week gets a mark of some kind, so an unsurveyed week reads as
             an empty slot rather than as a gap in the chart. Gray rather than
             the current text color because absence of data is not a
             measurement. -->
        <circle
          class="fill-muted-foreground/50"
          cx={mark.cx}
          cy={mark.cy}
          r={mark.r}
        />
      {:else}
        <rect
          class="fill-current"
          x={mark.x}
          y={mark.y}
          width={mark.width}
          height={mark.height}
          rx="1.5"
        />
      {/if}
      <!-- Drawn last, so it sits above the mark and receives the hover. A
           browser resolves an SVG tooltip from the topmost element under the
           pointer, so a hit area painted underneath would be shadowed by the
           very bar the reader is aiming at, and only the sliver beside a bar
           would show anything. fill="transparent" still takes pointer events
           (fill="none" would not) while leaving the chart unchanged. -->
      <rect
        x={x - GAP / 2}
        y="0"
        width={BAR_WIDTH + GAP}
        height={CHART_HEIGHT}
        fill="transparent"
      >
        <title>{pointLabel(point)}</title>
      </rect>
    {/each}
    <!-- Month axis. Only the week in which a month began gets a label, so the
         weeks before the first boundary stay bare rather than borrowing a month
         name that did not start there. -->
    {#each ticks as tick (tick.index)}
      {@const x = barX(tick.index)}
      <!-- A 3-letter label is wider than the 6px week it belongs to, so it
           needs a tick to say which week that is. -->
      <rect
        class="fill-muted-foreground/40"
        x={x + BAR_WIDTH / 2 - 0.5}
        y={CHART_HEIGHT}
        width="1"
        height={TICK_HEIGHT}
      />
      <!-- Centered on its week. A label at either end overhangs the chart,
           which is harmless: the column is wider than the bars. -->
      <text
        class="fill-muted-foreground"
        x={x + BAR_WIDTH / 2}
        y={LABEL_BASELINE}
        font-size={FONT_SIZE}
        text-anchor="middle"
      >
        {tick.label}
      </text>
    {/each}
  </svg>
{/if}
