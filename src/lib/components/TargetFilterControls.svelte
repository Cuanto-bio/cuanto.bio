<script lang="ts">
import ArrowDownUp from '@lucide/svelte/icons/arrow-down-up';
import ListChecks from '@lucide/svelte/icons/list-checks';
import X from '@lucide/svelte/icons/x';
import { flushSync } from 'svelte';
import { toast } from 'svelte-sonner';
import Button from '$lib/components/Button.svelte';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import * as InputGroup from '$lib/components/ui/input-group';
import type { TargetFilter, TargetSort } from '$lib/targets.svelte';
import { cn } from '$lib/utils';

interface Props {
  filter: TargetFilter;
  class?: string;
}

let { filter, class: className }: Props = $props();

let searchInput = $state<HTMLInputElement | null>(null);

function toggleOnlyCounted() {
  if (!filter.hasCounted) {
    toast.info('Count a target to only show counted');
    return;
  }
  filter.onlyCounted = !filter.onlyCounted;
  if (filter.onlyCounted) filter.filterQuery = '';
}

function onSearchFocus() {
  if (filter.onlyCounted) {
    filter.onlyCounted = false;
    // Render the re-expanded list before pinning. Dropping the filter is what
    // gives the scroll area the height the pin is about to scroll into; against
    // the still-rendered short list the scroll clamps partway and the bar is
    // left partway down the screen, which is the whole thing this avoids.
    // flushSync rather than tick so this stays inside the focus event.
    flushSync();
  }
  pinFilterBarToTop();
}

// When these controls sit in a sticky container inside the mobile scroll area
// (the survey form), pin that container to the top on focus. Otherwise the
// on-screen keyboard can leave only a sliver of room for results between the
// input and the keyboard, making it hard to tell the list is being filtered.
// No-op on desktop and where there is no sticky ancestor (the survey detail
// page), so focusing the field never makes the page jump.
//
// This has to run synchronously, inside the focus event. The app shell is a
// fixed 100dvh box, so on iOS the keyboard neither shrinks it nor slides over
// it: Safari pans the visual viewport down instead, far enough to clear the
// keyboard for wherever the input was when it took focus. Pinning after that
// decision (from rAF, say) then lifts the input back out of the panned band and
// off the top of the screen, and no later scroll can put it back, because a
// pan is not a scroll any element can undo. Pinning first means the input is
// already above the keyboard line, so Safari has no reason to pan at all.
function pinFilterBarToTop() {
  const bar = searchInput?.closest('.sticky');
  const scroller = searchInput?.closest('.mobile-scroll');
  // contains(): closest() walks past the scroller too, so a sticky ancestor
  // added above it later would otherwise give a negative delta and scroll the
  // form the wrong way on every focus.
  if (
    !bar ||
    !scroller?.contains(bar) ||
    getComputedStyle(scroller).overflowY !== 'auto'
  ) {
    return;
  }
  // Scroll only the .mobile-scroll box, by exactly the distance that lands the
  // bar at its top. Element.scrollIntoView() would walk every scrollable
  // ancestor, including the document.
  //
  // The jump is deliberate, and animating it has been tried twice. Safari drops
  // scrollBy({behavior:'smooth'}) on overflow containers outright, and a FLIP
  // transform standing in for a smooth scroll leaves the input *painted* low on
  // the screen for the length of the animation. Painted position is what Safari
  // reveals against, so either way the pan comes back. Landing in one frame is
  // the cost of not being panned off the top.
  scroller.scrollTop +=
    bar.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}
</script>

<div class={cn('flex items-center gap-2', className)}>
  <InputGroup.Root class="min-w-0 flex-1">
    <InputGroup.Input
      type="search"
      placeholder="Search targets…"
      bind:ref={searchInput}
      bind:value={filter.filterQuery}
      class="[&::-webkit-search-cancel-button]:hidden"
      onfocus={onSearchFocus}
    />
    {#if filter.filterQuery}
      <InputGroup.Addon align="inline-end">
        <InputGroup.Button
          size="icon-sm"
          aria-label="Clear search"
          onclick={() => {
            filter.filterQuery = '';
            searchInput?.focus();
          }}
        >
          <X class="size-4" />
        </InputGroup.Button>
      </InputGroup.Addon>
    {/if}
  </InputGroup.Root>
  <Button
    variant={filter.onlyCounted ? 'default' : 'outline'}
    size={filter.onlyCounted || filter.countedCount > 0 ? 'default' : 'icon'}
    aria-disabled={!filter.hasCounted}
    aria-label={filter.hasCounted ? 'Only counted' : 'Only counted, count a target first'}
    aria-pressed={filter.onlyCounted}
    class="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    onclick={toggleOnlyCounted}
  >
    <ListChecks class="size-4" />
    {#if filter.onlyCounted}
      {filter.countedCount} counted
      <X class="size-4" />
    {:else if filter.countedCount > 0}
      {filter.countedCount}
    {/if}
  </Button>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button variant="outline" size="icon" aria-label="Sort" {...props}>
          <ArrowDownUp class="size-4" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      <DropdownMenu.Label>Sort</DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        value={filter.targetSort}
        onValueChange={(v) => (filter.targetSort = v as TargetSort)}
      >
        <DropdownMenu.RadioItem value="default">Default</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="scientific">Scientific name</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="common">Common name</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
