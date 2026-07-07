<script lang="ts">
import ArrowDownUpIcon from '@lucide/svelte/icons/arrow-down-up';
import XIcon from '@lucide/svelte/icons/x';
import Button from '$lib/components/Button.svelte';
import ProtocolCard from '$lib/components/ProtocolCard.svelte';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import * as InputGroup from '$lib/components/ui/input-group';
import type { Protocol } from '$lib/offline/db';
import { normalizeForSearch } from '$lib/targets.svelte';

let { data } = $props();

type FollowingSort = 'lastSurvey' | 'followed';

let query = $state('');
let sort = $state<FollowingSort>('lastSurvey');
let searchInput = $state<HTMLInputElement | null>(null);

function followedAtTime(p: Protocol) {
  return p.followedAt ? new Date(p.followedAt).getTime() : 0;
}

function lastSurveyTime(p: Protocol) {
  return p.lastSurveyAt ? new Date(p.lastSurveyAt).getTime() : -1;
}

const filtered = $derived.by(() => {
  const q = normalizeForSearch(query);
  const matches = q
    ? data.follows.filter((p: Protocol) =>
        normalizeForSearch(p.record.title).includes(q),
      )
    : data.follows;
  return [...matches].sort((a, b) => {
    if (sort === 'followed') return followedAtTime(b) - followedAtTime(a);
    const bySurvey = lastSurveyTime(b) - lastSurveyTime(a);
    return bySurvey !== 0 ? bySurvey : followedAtTime(b) - followedAtTime(a);
  });
});
</script>

<main>
  <h1 class="mb-6 text-2xl font-semibold">Followed Protocols</h1>

  {#if data.follows.length === 0}
    <p class="text-muted-foreground text-sm">You haven't followed any protocols yet.</p>
  {:else}
    <div class="mb-4 flex items-center gap-2">
      <InputGroup.Root class="min-w-0 flex-1">
        <InputGroup.Input
          type="search"
          placeholder="Search followed protocols…"
          bind:ref={searchInput}
          bind:value={query}
          class="[&::-webkit-search-cancel-button]:hidden"
        />
        {#if query}
          <InputGroup.Addon align="inline-end">
            <InputGroup.Button
              size="icon-sm"
              aria-label="Clear search"
              onclick={() => {
                query = '';
                searchInput?.focus();
              }}
            >
              <XIcon class="size-4" />
            </InputGroup.Button>
          </InputGroup.Addon>
        {/if}
      </InputGroup.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button variant="outline" size="icon" aria-label="Sort" {...props}>
              <ArrowDownUpIcon class="size-4" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Label>Sort</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={sort}
            onValueChange={(v) => (sort = v as FollowingSort)}
          >
            <DropdownMenu.RadioItem value="lastSurvey">Last survey</DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="followed">Follow date</DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>

    {#if filtered.length === 0}
      <p class="text-muted-foreground text-sm">No followed protocols match "{query}".</p>
    {:else}
      <ul class="flex flex-col gap-3">
        {#each filtered as protocol (protocol.atUri)}
          <li>
            <a href="/app/protocols/{protocol.handle}/{protocol.rkey}">
              <ProtocolCard protocol={protocol} />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</main>
