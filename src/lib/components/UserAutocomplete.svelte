<script lang="ts">
import Autocomplete from '$lib/components/Autocomplete.svelte';
import { useDebouncedSearch } from '$lib/composables/debouncedSearch.svelte';

export type UserResult = {
  did: string;
  handle: string;
};

interface Props {
  placeholder?: string;
  onSelectUser: (result: UserResult) => void;
  portalTarget?: HTMLElement;
}

let {
  placeholder = 'Search surveyors…',
  onSelectUser,
  portalTarget,
}: Props = $props();

const search = useDebouncedSearch<UserResult>({
  minLength: 1,
  clearResultsOnError: true,
  fetchResults: async (query) => {
    const resp = await fetch(`/api/users?q=${encodeURIComponent(query)}`);
    const data = await resp.json();
    return data.results ?? [];
  },
});

function handleSelect(result: UserResult) {
  onSelectUser(result);
  search.reset();
}
</script>

<Autocomplete
  {placeholder}
  autocomplete="off"
  bind:value={search.query}
  items={search.results}
  onselect={handleSelect}
  {portalTarget}
  loading={search.searching}
>
  {#snippet item(result)}
    <span class="line-clamp-1 text-start">@{result.handle}</span>
  {/snippet}
</Autocomplete>
