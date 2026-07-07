<script lang="ts">
import { untrack } from 'svelte';
import Autocomplete from '$lib/components/Autocomplete.svelte';
import { useDebouncedSearch } from '$lib/composables/debouncedSearch.svelte';
import { recheckConnectivity, useOnline } from '$lib/composables/online.svelte';
import Taxon from './Taxon.svelte';

export type TaxonResult = {
  inatId: number;
  scientificName: string;
  taxonRank: string;
  commonName: string | null;
  kingdom: string | null;
  taxonID: string;
};

interface Props {
  placeholder?: string;
  onSelectTaxon: (result: TaxonResult) => void;
  onQueryChange?: (query: string) => void;
  portalTarget?: HTMLElement;
  initialValue?: string;
  ref?: HTMLInputElement | null;
}

let {
  placeholder,
  onSelectTaxon,
  onQueryChange,
  portalTarget,
  initialValue,
  ref = $bindable(null),
}: Props = $props();

const online = useOnline();

const search = useDebouncedSearch<TaxonResult>({
  initialQuery: untrack(() => initialValue ?? ''),
  online,
  onError: recheckConnectivity,
  fetchResults: async (query) => {
    const resp = await fetch(`/api/taxa?q=${encodeURIComponent(query)}`);
    const data = await resp.json();
    return data.results ?? [];
  },
});

$effect(() => {
  onQueryChange?.(search.query);
});

function handleSelect(result: TaxonResult) {
  onSelectTaxon(result);
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
    <div class="line-clamp-1 text-start">
      <Taxon
        taxon={{
          scientificName: result.scientificName,
          vernacularName: result.commonName!,
          taxonRank: result.taxonRank
        }}
      />
    </div>
  {/snippet}
</Autocomplete>
