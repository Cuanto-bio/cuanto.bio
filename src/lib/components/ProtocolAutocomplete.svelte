<script lang="ts">
import Autocomplete from '$lib/components/Autocomplete.svelte';

export type ProtocolResult = {
  atUri: string;
  handle: string;
  title: string;
};

interface Props {
  placeholder?: string;
  onSelectProtocol: (result: ProtocolResult) => void;
  portalTarget?: HTMLElement;
}

let {
  placeholder = 'Search protocols…',
  onSelectProtocol,
  portalTarget,
}: Props = $props();

let query = $state('');
let results = $state<ProtocolResult[]>([]);
let searching = $state(false);

$effect(() => {
  if (query.trim().length < 1) {
    results = [];
    return;
  }
  const q = query.trim();
  const timer = setTimeout(async () => {
    searching = true;
    try {
      const resp = await fetch(`/api/protocols?q=${encodeURIComponent(q)}`);
      const data = await resp.json();
      results = data.results ?? [];
    } catch {
      results = [];
    } finally {
      searching = false;
    }
  }, 300);
  return () => clearTimeout(timer);
});

function handleSelect(result: ProtocolResult) {
  onSelectProtocol(result);
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
    <span class="line-clamp-1 text-start">
      {result.title}
      <span class="text-muted-foreground text-xs">@{result.handle}</span>
    </span>
  {/snippet}
</Autocomplete>
