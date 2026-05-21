<script lang="ts">
import type { TaxonProp } from '$lib/components/Taxon.svelte';
import Taxon from '$lib/components/Taxon.svelte';
import * as Card from '$lib/components/ui/card';
import { verbatimScope } from '$lib/lexicons/bio/lexicons/temp/v0-1/surveyTarget.defs';
import type {
  Occurrence,
  Protocol,
  Survey,
  TaxonScope,
  VerbatimScope,
} from '$lib/offline/db';

interface Props {
  protocol: Protocol;
  survey: Survey;
}

let { protocol, survey }: Props = $props();

let showAllTargets = $state(false);

const targetUris = $derived(new Set(protocol.targets.map((t) => t.atUri)));

const incidentalOccs = $derived(
  survey.occurrences.filter((o) => !o.record.surveyTargetID),
);

const orphanedOccs = $derived(
  survey.occurrences.filter(
    (o) => o.record.surveyTargetID && !targetUris.has(o.record.surveyTargetID),
  ),
);

const targetOccCount = $derived(
  survey.occurrences.length - incidentalOccs.length - orphanedOccs.length,
);

const visibleTargets = $derived(
  showAllTargets
    ? protocol.targets
    : protocol.targets.filter((t) =>
        survey.occurrences.some((o) => o.record.surveyTargetID === t.atUri),
      ),
);

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  return new Date(iso).toLocaleString();
}
</script>

{#snippet surveyTargetRow(opts: {
  verbatimTargetScope?: string,
  taxon?: TaxonProp,
  occurrence?: Occurrence
})}
  <li
    class="
      flex
      items-center
      justify-between
      border
      px-4
      py-3
      border-b-0
      last:border-b-1
      first:rounded-t
      last:rounded-b
    "
  >
    <span class="text-sm">
      {#if opts.taxon}
        <Taxon taxon={opts.taxon} />
      {:else if opts.verbatimTargetScope}
        {opts.verbatimTargetScope ?? 'Unknown'}
      {/if}
    </span>
    <span class="font-mono text-sm font-semibold">
      {opts.occurrence?.record.organismQuantity ?? 0}
    </span>
  </li>
{/snippet}

<main class="mx-auto max-w-2xl px-4 pb-8">
  <div class="text-muted-foreground text-xs mb-4">SURVEY</div>
  <Card.Root class="mb-6">
    <Card.Header>
      <Card.Title>{survey.protocolTitle}</Card.Title>
      <Card.Description>{survey.record.location.name}</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-2 text-sm">
      <div>
        <span class="text-muted-foreground font-medium">Date:</span>
        <span class="ml-2">{formatDate(survey.record.eventDate ?? null)}</span>
      </div>
      {#if survey.record.eventDurationValue != null}
        <div>
          <span class="text-muted-foreground font-medium">Duration:</span>
          <span class="ml-2">
            {survey.record.eventDurationValue}
            {survey.record.eventDurationUnit ?? 'min'}
          </span>
        </div>
      {/if}
      {#if survey.record.surveyorCount != null}
        <div>
          <span class="text-muted-foreground font-medium">Surveyors:</span>
          <span class="ml-2">{survey.record.surveyorCount}</span>
        </div>
      {/if}
      <div>
        <span class="text-muted-foreground font-medium">Protocol:</span>
        <a
          href="/app/protocols/{survey.protocolHandle}/{survey.protocolRkey}"
          class="text-primary ml-2 underline"
        >{survey.protocolTitle}</a>
      </div>
    </Card.Content>
  </Card.Root>

  <div class="mb-3 flex items-center justify-between">
    <h2 class="text-lg font-semibold">
      Targets ({targetOccCount} / {protocol.targets.length})
    </h2>
    <button
      class="text-muted-foreground text-xs underline"
      onclick={() => (showAllTargets = !showAllTargets)}
    >
      {showAllTargets ? 'Hide unrecorded' : 'Show all'}
    </button>
  </div>

  {#if visibleTargets.length === 0}
    <p class="text-muted-foreground text-sm">No occurrences recorded.</p>
  {:else}
    <ul class="flex flex-col gap-0">
      {#each visibleTargets as target (target.atUri)}
        {@const taxonScope = target.record.scope.find(s => s.$type.endsWith('#taxonScope')) as TaxonScope}
        {@const verbatimScope = target.record.scope.find(s => s.$type.endsWith('#verbatimScope')) as VerbatimScope}
        {@const occurrence = survey.occurrences.find(o => o.record.surveyTargetID === target.atUri)}
        {#if taxonScope}
          {@render surveyTargetRow({ occurrence, taxon: taxonScope })}
        {:else if verbatimScope}
          {@render surveyTargetRow({ occurrence, verbatimTargetScope: verbatimScope.verbatimTargetScope })}
        {/if}
      {/each}
    </ul>
  {/if}

  {#if incidentalOccs.length > 0}
    <h2 class="mb-3 mt-6 text-lg font-semibold">Incidentals ({incidentalOccs.length})</h2>
    <ul class="flex flex-col gap-3">
      {#each incidentalOccs as occurrence (occurrence.atUri)}
<!--         <li class="flex items-center justify-between rounded border px-4 py-3">
          <span class="text-sm">
            {#if occ.identification?.vernacularName}
              <span class="font-medium">{occ.identification.vernacularName}</span>
              <span class="text-muted-foreground ml-1 italic">({occ.identification.scientificName})</span>
            {:else if occ.identification?.scientificName}
              <span class="font-medium italic">{occ.identification.scientificName}</span>
            {:else}
              <span class="text-muted-foreground italic">Unknown taxon</span>
            {/if}
          </span>
          <span class="font-mono text-sm font-semibold">{occ.record.organismQuantity ?? 0}</span>
        </li> -->
        {@render surveyTargetRow({ occurrence, taxon: occurrence.identification })}
      {/each}
    </ul>
  {/if}
</main>
