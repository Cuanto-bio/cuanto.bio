<script lang="ts">
import type { WeeklyPoint } from '$lib/server/db/stats';
import {
  formatMean,
  markFor,
  projectY,
  type ScaleType,
  seriesSummary,
  weekStartMonthTicks,
  yTicks,
} from '$lib/sparkbar';

let {
  points,
  scale,
}: {
  points: WeeklyPoint[];
  scale: ScaleType;
} = $props();

const BAR_WIDTH = 20;
const GAP = 8;
const PLOT_HEIGHT = 200;
// Room for the widest tick label the axis can produce. Counts run to the
// thousands and means to two decimals, so budget for about five glyphs. Unlike
// the metrics below this one has to stay in user units: it feeds the viewBox
// width that the stretch factor is measured against, so deriving it from that
// factor would be circular.
const Y_AXIS_WIDTH = 46;

// Everything text-related is in rendered CSS pixels rather than user units. The
// svg is stretched to whatever width the dialog gives it, so a size fixed in
// user units grows with the chart: the same 11 that reads correctly on a phone
// renders at about 16px in a desktop dialog. Dividing by the stretch factor
// holds these at a constant on-screen size at any width.
const FONT_PX = 11;
const DAY_GAP_PX = 16;
const MONTH_GAP_PX = 32;
const X_AXIS_PX = 38;
// Space between the bars and the effort panel below them, enough for the
// panel's caption to sit in without crowding either plot.
const PANEL_GAP_PX = 36;
const PANEL_CAPTION_GAP_PX = 8;
const LINE_PX = 2;

// A second plot rather than a second y scale on the first one. Survey counts
// and mean counts are different measures, and overlaying them would mean
// choosing an arbitrary alignment between two scales, which invents a
// correlation the data does not contain. Stacked under a shared x axis the
// reader can still line up a week's bar with the effort behind it, but nothing
// implies the two curves crossing means anything.
const PANEL_HEIGHT = 24;

// Rendered width of the svg, from the wrapper it fills. 0 before the first
// measurement and during SSR, which the stretch factor treats as 1:1.
let renderedWidth = $state(0);

const plotWidth = $derived(
  points.length * BAR_WIDTH + Math.max(0, points.length - 1) * GAP,
);
const width = $derived(Y_AXIS_WIDTH + plotWidth);

const stretch = $derived(renderedWidth > 0 ? renderedWidth / width : 1);
const fontSize = $derived(FONT_PX / stretch);
const lineWidth = $derived(LINE_PX / stretch);
// Top of the effort panel, and where its caption sits just above it.
const panelTop = $derived(PLOT_HEIGHT + PANEL_GAP_PX / stretch);
const panelCaptionBaseline = $derived(
  panelTop - PANEL_CAPTION_GAP_PX / stretch,
);
const panelBottom = $derived(panelTop + PANEL_HEIGHT);
// The x axis is shared, so it sits below both plots rather than under the bars.
const dayBaseline = $derived(panelBottom + DAY_GAP_PX / stretch);
const monthBaseline = $derived(panelBottom + MONTH_GAP_PX / stretch);
const xAxisHeight = $derived(X_AXIS_PX / stretch);
// The topmost tick sits at y=0 and its label is centred on it, so half the text
// would fall outside the viewBox and be clipped. Reserve enough for that half.
const topPad = $derived(FONT_PX / 2 / stretch + 1);
const height = $derived(topPad + panelBottom + xAxisHeight);

// This series' own peak, not the table's shared ceiling. The table shares one
// max so rows can be compared at a glance; here the reader has drilled into a
// single row to read its quantities, so it gets the full height and an axis
// that is labelled for it. The axis is what makes that safe: the numbers say
// outright what the sparkbar could only imply by relative height.
const dataMax = $derived(
  points.reduce((m, p) => (p.mean !== null && p.mean > m ? p.mean : m), 0),
);
const axis = $derived(yTicks(dataMax));

const geometry = $derived({
  barWidth: BAR_WIDTH,
  chartHeight: PLOT_HEIGHT,
  // The nicened ceiling rather than the raw max, so the tallest bar ends at the
  // topmost gridline instead of overshooting it.
  max: axis.max,
  scale,
});

// How many surveys stood behind each week's mean. A week averaged from one
// survey is a far weaker claim than one averaged from eight, and the bars alone
// cannot show that: a tall bar from a single survey looks identical to a tall
// bar from many. Always linear and always its own peak, since the question is
// only ever "more or fewer than the neighbouring weeks".
const surveyMax = $derived(
  points.reduce((m, p) => Math.max(m, p.surveyCount), 0),
);

const panelGeometry = $derived({
  barWidth: BAR_WIDTH,
  chartHeight: PANEL_HEIGHT,
  max: surveyMax,
  scale: 'linear' as const,
});

function panelY(surveyCount: number): number {
  return panelTop + projectY(surveyCount, panelGeometry);
}

// One point per week, at the centre of the column its bar occupies, so a peak
// in effort sits directly above or below the week it belongs to.
const effortLine = $derived(
  points
    .map((p, i) => `${barX(i) + BAR_WIDTH / 2},${panelY(p.surveyCount)}`)
    .join(' '),
);

const ticks = $derived(weekStartMonthTicks(points.map((p) => p.weekStart)));

function barX(index: number): number {
  return Y_AXIS_WIDTH + index * (BAR_WIDTH + GAP);
}

function formatWeek(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function dayLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString(undefined, {
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

// The shared series sentence, then the two things only this chart adds: which
// scale the heights use, and the effort panel below them.
const summary = $derived.by(() => {
  const base = seriesSummary(points);
  if (points.length === 0) return base;
  const counts = points.map((p) => p.surveyCount);
  const scaleNote =
    scale === 'sqrt'
      ? 'Heights use a square-root scale'
      : 'Heights are in true proportion';
  return (
    `${base}. ${scaleNote}. Surveys / week range from ` +
    `${Math.min(...counts)} to ${Math.max(...counts)}`
  );
});
</script>


{#if points.length > 0}
  <!-- The wrapper is what the svg is measured against; the svg itself fills it.
       Scaling to the dialog's width rather than sitting at a fixed size keeps
       the chart whole on a phone. -->
  <div bind:clientWidth={renderedWidth}>
    <!-- Full-strength foreground rather than the sparkbar's 80%: at this size
         the gridlines would otherwise show through the bars and make them look
         translucent. -->
    <svg
      class="h-auto w-full text-foreground"
      viewBox="0 0 {width} {height}"
      role="img"
      aria-label={summary}
    >
      <!-- Everything is plotted with the top of the bar area at y=0 and shifted
           down as a whole, so the geometry stays free of the padding term. -->
      <g transform="translate(0, {topPad})">
        <!-- Gridlines first, so every mark paints over them. -->
        {#each axis.values as value (value)}
          {@const y = projectY(value, geometry)}
          <!-- No rule at zero: the bars all start there, so it carries no
               information the marks do not already give, and it competes with
               the zero outline that sits on it. The 0 label still anchors the
               axis. -->
          {#if value > 0}
            <line
              class="stroke-border"
              x1={Y_AXIS_WIDTH}
              y1={y}
              x2={width}
              y2={y}
              stroke-width="1"
            />
          {/if}
          <!-- d3 hands back already-clean tick values, so nothing to format. -->
          <text
            class="fill-muted-foreground"
            x={Y_AXIS_WIDTH - 8}
            y={y}
            font-size={fontSize}
            text-anchor="end"
            dominant-baseline="middle"
          >
            {value}
          </text>
        {/each}

        <!-- Bars. -->
        {#each points as point, i (point.weekStart)}
          {@const mark = markFor(point, barX(i), geometry)}
          {#if mark.kind === 'zero'}
            <!-- Inset by half the stroke width so the outline lands on whole
                 pixels instead of straddling two. -->
            <rect
              class="fill-none stroke-current"
              x={mark.x + 0.75}
              y={mark.y + 0.75}
              width={mark.width - 1.5}
              height={mark.height - 1.5}
              stroke-width="1.5"
              rx="2"
            />
          {:else if mark.kind === 'none'}
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
              rx="2"
            />
          {/if}
        {/each}

        <!-- Effort panel. Its own plot under a shared x axis rather than a
             second y scale over the bars: see PANEL_HEIGHT. One series, so it
             is named directly instead of carrying a legend. -->
        <text
          class="fill-muted-foreground"
          x={Y_AXIS_WIDTH}
          y={panelCaptionBaseline}
          font-size={fontSize}
        >
          Surveys / week
        </text>
        <!-- Baseline, so a week with no surveys reads as sitting on zero rather
             than as the line simply stopping. -->
        <line
          class="stroke-border"
          x1={Y_AXIS_WIDTH}
          y1={panelBottom}
          x2={width}
          y2={panelBottom}
          stroke-width="1"
        />
        {#if surveyMax > 0}
          <text
            class="fill-muted-foreground"
            x={Y_AXIS_WIDTH - 8}
            y={panelY(surveyMax)}
            font-size={fontSize}
            text-anchor="end"
            dominant-baseline="middle"
          >
            {surveyMax}
          </text>
        {/if}
        <polyline
          class="fill-none stroke-muted-foreground"
          points={effortLine}
          stroke-width={lineWidth}
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        {#each points as point, i (point.weekStart)}
          <circle
            class="fill-muted-foreground"
            cx={barX(i) + BAR_WIDTH / 2}
            cy={panelY(point.surveyCount)}
            r={lineWidth * 1.5}
          />
        {/each}

        <!-- X axis, shared by both plots. The day is the week's Monday; the
             month name below only marks where a month began, so the days are
             what tie a column to a date. -->
        {#each points as point, i (point.weekStart)}
          <text
            class="fill-muted-foreground"
            x={barX(i) + BAR_WIDTH / 2}
            y={dayBaseline}
            font-size={fontSize}
            text-anchor="middle"
          >
            {dayLabel(point.weekStart)}
          </text>
        {/each}
        <!-- Sits directly under the week's start day and names that day's
             month, so the two compose into a readable date rather than
             contradicting. -->
        {#each ticks as tick (tick.index)}
          <text
            class="fill-muted-foreground font-medium"
            x={barX(tick.index) + BAR_WIDTH / 2}
            y={monthBaseline}
            font-size={fontSize}
          text-anchor="middle"
          >
            {tick.label}
          </text>
        {/each}

        <!-- Hit areas last of all, so they sit above every mark in both plots
             and take the hover. A browser resolves an SVG tooltip from the
             topmost element under the pointer and will not fall back to a
             sibling, so anything painted after these would swallow the tooltip
             for the very mark the reader is aiming at. -->
        {#each points as point, i (point.weekStart)}
          <rect
            x={barX(i) - GAP / 2}
            y="0"
            width={BAR_WIDTH + GAP}
            height={panelBottom}
            fill="transparent"
          >
            <title>{pointLabel(point)}</title>
          </rect>
        {/each}
      </g>
    </svg>
  </div>
{/if}
