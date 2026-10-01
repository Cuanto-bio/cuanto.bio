<script lang="ts">
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import type { TargetGroupHeader } from '$lib/targets.svelte';

// Heading over a run of targets in the taxonomic sort (issue
// https://tangled.org/cuanto.bio/cuanto.bio/issues/81). A taxon heading can be
// tapped to show its full lineage underneath, since the heading itself only
// names the family (and maybe order).
const {
  header,
  class: className = '',
}: { header: TargetGroupHeader; class?: string } = $props();

let expanded = $state(false);
// Only worth expanding when the lineage says more than the heading does
const lineage = $derived(
  header.kind === 'taxon' && header.lineage.length > header.names.length
    ? header.lineage
    : null,
);
</script>

<div class={className}>
  <h3 class="text-muted-foreground text-xs font-semibold">
    {#if header.kind === 'taxon'}
      {#if lineage}
        <button
          type="button"
          class="hover:text-foreground flex items-center gap-1 text-left"
          aria-expanded={expanded}
          onclick={() => (expanded = !expanded)}
        >
          {header.names.join(' › ')}
          <ChevronRight
            aria-hidden="true"
            class="size-3.5 shrink-0 transition-transform {expanded ? 'rotate-90' : ''}"
          />
        </button>
      {:else}
        {header.names.join(' › ')}
      {/if}
    {:else if header.kind === 'unclassified'}
      No taxonomy
    {:else}
      Other
    {/if}
  </h3>
  {#if lineage && expanded}
    <p class="text-muted-foreground mt-1 text-xs leading-snug">{lineage.join(' › ')}</p>
  {/if}
</div>
