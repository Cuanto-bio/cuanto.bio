<script lang="ts">
import ArrowDownUp from '@lucide/svelte/icons/arrow-down-up';
import ListChecks from '@lucide/svelte/icons/list-checks';
import X from '@lucide/svelte/icons/x';
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
  if (filter.onlyCounted) filter.onlyCounted = false;
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
