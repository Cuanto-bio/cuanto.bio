<script lang="ts">
import InfoIcon from '@lucide/svelte/icons/info';
import * as Dialog from '$lib/components/ui/dialog';
import { ScrollArea } from '$lib/components/ui/scroll-area';
import type { WeeklyPoint } from '$lib/server/db/stats';
import Sparkbar from './Sparkbar.svelte';

let {
  scope,
}: {
  // Targets and taxa differ in what counts toward the denominator, which is
  // the one part of the explanation that is not shared.
  scope: 'target' | 'taxon';
} = $props();

// The swatches are real Sparkbars rather than hand-drawn copies, so the key
// cannot drift from what the table actually renders.
function swatch(means: (number | null)[]): WeeklyPoint[] {
  return means.map((mean, i) => ({
    weekStart: `2026-07-${String(6 + i * 7).padStart(2, '0')}`,
    mean,
    surveyCount: mean === null ? 0 : 1,
    totalCount: mean ?? 0,
  }));
}

// Deliberately descending, ending on a deliberately short bar: it shows that
// height carries magnitude, and it puts a short *filled* bar directly above
// the short *outlined* one in the next row, so the contrast the reader has to
// learn is fill and not size.
const COUNTED = swatch([1, 0.25, 0.04]);
const NONE_FOUND = swatch([0, 0, 0]);
const NOT_SURVEYED = swatch([null, null, null]);
</script>

<Dialog.Root>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <button
        type="button"
        class="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
        aria-label="About the 10-week trend chart"
        {...props}
      >
        <InfoIcon class="size-3.5" />
      </button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <Dialog.Header>
      <Dialog.Title>Reading the 10-week trend</Dialog.Title>
      <Dialog.Description>
        One bar per week for the last 10 weeks, oldest on the left.
      </Dialog.Description>
    </Dialog.Header>

    <ScrollArea class="-mx-6 min-h-0">
      <div class="flex flex-col gap-3 px-6 text-sm">
        <div class="flex items-center gap-3">
          <Sparkbar points={COUNTED} max={1} axis={false} class="h-10 w-auto shrink-0 bg-muted p-2" />
          <p>
            <span class="font-medium">Counted.</span>
            Height is the sum of that week's counts divided by
            {scope === 'target'
              ? "the number of surveys that sought this target"
              : "that number of surveys"}.
          </p>
        </div>

        <div class="flex items-center gap-3">
          <Sparkbar points={NONE_FOUND} max={1} axis={false} class="h-10 w-auto shrink-0 bg-muted p-2" />
          <p>
            <span class="font-medium">Looked for but not found.</span>
            Surveys were conducted looking for this but none reported it.
          </p>
        </div>

        <div class="flex items-center gap-3">
          <Sparkbar points={NOT_SURVEYED} max={1} axis={false} class="h-10 w-auto shrink-0 bg-muted p-2" />
          <p>
            <span class="font-medium">
              {scope === 'target' ? 'Not sought' : 'Not surveyed'}.
            </span>
            No relevant surveys were conducted.
          </p>
        </div>

        <div class="flex flex-col gap-2 border-t pt-3 text-muted-foreground">
          <p>
            Each week is averaged on its own, so a week with more surveying does
            not automatically look like a bigger week. Nothing is averaged across
            the whole date range.
          </p>
          <p>
            {#if scope === 'target'}
              A survey counts toward a week only if it sought this target, meaning
              the surveyor had adopted it and it was neither added later nor
              already retired. Surveys that sought it and found none are included,
              as zeros.
            {:else}
              Absence is recorded per target, not per taxon, so there is no "was
              this taxon sought". Every survey in the week counts toward that
              week's average, but only under protocols relevant to the taxon:
              ones that target it, or that it has been recorded under. Selecting
              an unrelated protocol will not drag the average down.
            {/if}
          </p>
          <p>
            All rows share one square-root scale, so heights are comparable
            between rows: a bar twice as tall is about four times the value.
            Hover a bar for exact numbers.
          </p>
          <p>
            A month name marks the week that month began, so the weeks before the
            first one carry no label.
          </p>
        </div>
      </div>
    </ScrollArea>
  </Dialog.Content>
</Dialog.Root>
