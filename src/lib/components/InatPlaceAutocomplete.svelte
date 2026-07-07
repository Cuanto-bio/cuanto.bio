<script lang="ts">
import Autocomplete from '$lib/components/Autocomplete.svelte';
import { useDebouncedSearch } from '$lib/composables/debouncedSearch.svelte';
import { recheckConnectivity, useOnline } from '$lib/composables/online.svelte';
import type { InatPlace } from '$lib/places';

interface Props {
  placeholder?: string;
  onSelectPlace: (result: InatPlace) => void;
  portalTarget?: HTMLElement;
  ref?: HTMLInputElement | null;
}

let {
  placeholder,
  onSelectPlace,
  portalTarget,
  ref = $bindable(null),
}: Props = $props();

const online = useOnline();

const search = useDebouncedSearch<InatPlace>({
  online,
  onError: recheckConnectivity,
  fetchResults: async (query) => {
    const resp = await fetch(`/api/inat-places?q=${encodeURIComponent(query)}`);
    const data = await resp.json();
    return data.results ?? [];
  },
});

function handleSelect(result: InatPlace) {
  onSelectPlace(result);
  search.reset();
}
</script>

<Autocomplete
  {placeholder}
  autocomplete="off"
  bind:value={search.query}
  bind:ref
  items={search.results}
  onselect={handleSelect}
  {portalTarget}
  loading={search.searching}
>
  {#snippet item(result)}
    <div class="line-clamp-1 text-start">{result.displayName}</div>
  {/snippet}
</Autocomplete>
