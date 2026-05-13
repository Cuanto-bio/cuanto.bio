<script lang="ts">
import { untrack } from 'svelte';
import Autocomplete from '$lib/components/Autocomplete.svelte';
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
  portalTarget?: HTMLElement;
  initialValue?: string;
}

let { placeholder, onSelectTaxon, portalTarget, initialValue }: Props =
  $props();

let query = $state(untrack(() => initialValue ?? ''));
let results = $state<TaxonResult[]>([]);
let searching = $state(false);

$effect(() => {
  if (query.trim().length < 2) {
    results = [];
    return;
  }
  const q = query.trim();
  const timer = setTimeout(async () => {
    searching = true;
    try {
      const resp = await fetch(`/api/taxa?q=${encodeURIComponent(q)}`);
      const data = await resp.json();
      results = data.results ?? [];
    } finally {
      searching = false;
    }
  }, 300);
  return () => clearTimeout(timer);
});

function handleSelect(result: TaxonResult) {
  onSelectTaxon(result);
  query = '';
  results = [];
}
</script>

<Autocomplete
  {placeholder}
  autocomplete="off"
  bind:value={query}
  items={results}
  onselect={handleSelect}
  {portalTarget}
  loading={searching}
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
