<script lang="ts">
import { Slider } from '$lib/components/ui/slider';
import type { GpsTrackPoint } from '$lib/gpx';
import { movementBuckets, type TimeRange, trimTrack } from '$lib/trackTrim';
import { cn } from '$lib/utils';

type Props = {
  // The whole, untrimmed track.
  points: GpsTrackPoint[];
  // Its full time span (see trackTimeRange).
  span: TimeRange;
  // The time range to keep.
  range: TimeRange;
  onchange: (range: TimeRange) => void;
  class?: string;
};

let { points, span, range, onchange, class: className }: Props = $props();

const BUCKETS = 48;

// How far the surveyor moved over time. Forgetting to stop recording usually
// shows up here as a flat tail (sitting still) or a spike (driving home).
const buckets = $derived(movementBuckets(points, span, BUCKETS));
// Square root keeps a walk visible next to a drive, which would otherwise
// flatten every walking bar to nothing.
const maxScaled = $derived(
  Math.sqrt(Math.max(0, ...buckets.map((b) => b ?? 0))),
);

const kept = $derived(trimTrack(points, range));
const keptMinutes = $derived(
  kept.length > 1
    ? Math.round((kept[kept.length - 1].timestamp - kept[0].timestamp) / 60_000)
    : 0,
);

// Only name the day when the track crosses midnight; otherwise times suffice.
const multiDay = $derived(
  new Date(span.start).toDateString() !== new Date(span.end).toDateString(),
);

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    hour: 'numeric',
    minute: '2-digit',
    ...(multiDay ? { month: 'short', day: 'numeric' } : {}),
  });
}

function bucketInRange(i: number): boolean {
  const width = (span.end - span.start) / BUCKETS;
  const bucketStart = span.start + i * width;
  return bucketStart + width > range.start && bucketStart < range.end;
}

function onValueChange(v: number[]) {
  onchange({ start: v[0], end: v[1] });
}
</script>

<div class={cn('flex flex-col gap-1', className)} data-testid="track-trim">
  <!-- Movement profile, aligned with the slider below it. -->
  <svg
    class="h-10 w-full"
    viewBox="0 0 {BUCKETS} 10"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <line x1="0" y1="10" x2={BUCKETS} y2="10" class="stroke-border" stroke-width="0.3" />
    {#each buckets as meters, i}
      {#if meters != null && maxScaled > 0}
        {@const h = Math.max(0.4, (Math.sqrt(meters) / maxScaled) * 10)}
        <rect
          x={i + 0.1}
          y={10 - h}
          width="0.8"
          height={h}
          class={bucketInRange(i) ? 'fill-highlight' : 'fill-muted-foreground/30'}
        />
      {/if}
    {/each}
  </svg>
  <Slider
    type="multiple"
    min={span.start}
    max={span.end}
    step={1000}
    value={[range.start, range.end]}
    {onValueChange}
    thumbPositioning="exact"
    class="[&_[data-slot=slider-range]]:bg-highlight"
    thumbProps={(i) => ({
      'aria-label': i === 0 ? 'Track start' : 'Track end',
      'aria-valuetext': formatTime(i === 0 ? range.start : range.end),
    })}
  />
  <div class="text-muted-foreground flex justify-between text-xs" aria-hidden="true">
    <span>{formatTime(span.start)}</span>
    <span>{formatTime(span.end)}</span>
  </div>
  <p class="text-sm" aria-live="polite" data-testid="track-trim-summary">
    {#if kept.length === 0}
      <span class="text-destructive">No track points in this range</span>
    {:else}
      <span class="font-medium tabular-nums">
        {formatTime(kept[0].timestamp)} – {formatTime(kept[kept.length - 1].timestamp)}
      </span>
      <span class="text-muted-foreground">
        · {keptMinutes} min · {kept.length} of {points.length} points
      </span>
    {/if}
  </p>
</div>
