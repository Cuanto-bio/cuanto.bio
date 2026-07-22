<script lang="ts">
import * as Dialog from '$lib/components/ui/dialog';
import { ScrollArea } from '$lib/components/ui/scroll-area';
import * as ToggleGroup from '$lib/components/ui/toggle-group';
import type { WeeklyPoint } from '$lib/server/db/stats';
import { type ScaleType, seriesSummary } from '$lib/sparkbar';
import Sparkbar from './Sparkbar.svelte';
import Taxon, { type TaxonProp } from './Taxon.svelte';
import WeeklyChart from './WeeklyChart.svelte';

let {
  points,
  max,
  title,
  taxon,
  scope,
}: {
  points: WeeklyPoint[];
  // The table's shared ceiling, for the trigger sparkbar only. The chart inside
  // scales to this series alone; see WeeklyChart.
  max: number;
  // Plain-text identity of the row, for the trigger's accessible name, which
  // cannot carry markup. Optional when `taxon` is given: the scientific name is
  // already the plain-text form of it, so callers need not repeat themselves.
  title?: string;
  // Set when the row names exactly one taxon, so the heading gets the same
  // italics and vernacular-name treatment the rest of the app uses. A target
  // with several scopes has no single taxon to render, so it falls back to the
  // composed title.
  taxon?: TaxonProp;
  scope: 'target' | 'taxon';
} = $props();

// One source for the row's identity: a caller that passes a taxon does not also
// have to spell out the text form, and the two can no longer disagree.
const label = $derived(title ?? taxon?.scientificName ?? 'this row');

// ToggleGroup in single mode lets the active item be clicked off, which would
// leave no scale selected. Holding the raw value separately and deriving the
// scale means that deselection falls back to the default rather than blanking
// the chart.
let selected = $state('sqrt');
const scale = $derived<ScaleType>(selected === 'linear' ? 'linear' : 'sqrt');

// Wrapping the sparkbar in a button makes the button's accessible name the only
// thing announced, which would drop the svg's own summary of the row. Keeping
// the name short (it is what gets read when tabbing a long table) and carrying
// the numbers as the description restores them without making every row a
// paragraph.
const describedById = $props.id();
</script>

<Dialog.Root>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <button
        type="button"
        class="rounded-sm p-1 hover:bg-muted focus-visible:outline-2
               focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Show a larger trend chart for {label}"
        aria-describedby={describedById}
        {...props}
      >
        <Sparkbar {points} {max} />
      </button>
    {/snippet}
  </Dialog.Trigger>
  <span id={describedById} class="sr-only">{seriesSummary(points)}</span>
  <!-- The chart plus its explanation runs taller than a short viewport, so the
       body scrolls under a pinned header rather than overflowing the screen. -->
  <Dialog.Content
    class="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-lg"
  >
    <Dialog.Header>
      <Dialog.Title>
        {#if taxon}
          <Taxon {taxon} />
        {:else}
          {label}
        {/if}
      </Dialog.Title>
      <Dialog.Description>
        Mean count per survey, one bar per week for the last {points.length} weeks.
      </Dialog.Description>
    </Dialog.Header>

    <ScrollArea class="-mx-6 min-h-0">
      <div class="flex flex-col gap-4 px-6">
        <WeeklyChart {points} {scale} />

        <div class="flex flex-col gap-2 border-t pt-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-medium">Height scale</span>
            <ToggleGroup.Root
              type="single"
              variant="outline"
              size="sm"
              bind:value={selected}
            >
              <ToggleGroup.Item value="sqrt">Square root</ToggleGroup.Item>
              <ToggleGroup.Item value="linear">Linear</ToggleGroup.Item>
            </ToggleGroup.Root>
          </div>
          <p class="text-sm text-muted-foreground">
            {#if scale === 'sqrt'}
              Heights are compressed so small weeks stay visible next to large
              ones: a bar twice as tall is about four times the value. This is
              the scale the table uses.
            {:else}
              Heights are in true proportion, so a bar twice as tall is twice
              the value. Weeks with very small counts may nearly disappear.
            {/if}
          </p>
          <p class="text-sm text-muted-foreground">
            Unlike the table, this chart scales to this
            {scope === 'target' ? 'target' : 'taxon'}'s own peak, so heights
            here are not comparable with other rows. Read the numbers on the
            left instead.
          </p>
          <p class="text-sm text-muted-foreground">
            The lower panel counts the surveys behind each week's average: a
            tall bar drawn from one survey says much less than the same bar
            drawn from eight. It has its own scale, so its height means nothing
            next to the bars above.
          </p>
        </div>
      </div>
    </ScrollArea>
  </Dialog.Content>
</Dialog.Root>
