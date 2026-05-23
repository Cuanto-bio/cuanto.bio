<script lang="ts">
import MoreVertical from '@lucide/svelte/icons/more-vertical';
import Button from '$lib/components/Button.svelte';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import { Input } from '$lib/components/ui/input';
import type { TargetFilter, TargetSort } from '$lib/targets.svelte';
import { cn } from '$lib/utils';

interface Props {
  filter: TargetFilter;
  class?: string;
}

let { filter, class: className }: Props = $props();
</script>

<div class={cn('flex items-center gap-2', className)}>
  <Input
    type="search"
    placeholder="Search targets…"
    bind:value={filter.filterQuery}
    class="flex-1"
  />
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button variant="outline" size="icon" aria-label="Sort and filter" {...props}>
          <MoreVertical class="size-4" />
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
      <DropdownMenu.Separator />
      <DropdownMenu.Label>Filter</DropdownMenu.Label>
      <DropdownMenu.CheckboxItem bind:checked={filter.onlyObserved}>
        Only observed
      </DropdownMenu.CheckboxItem>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
