<script lang="ts">
import Taxon from '$lib/components/Taxon.svelte';
import * as Card from '$lib/components/ui/card';
import type {
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

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  return new Date(iso).toLocaleString();
}
</script>

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

  <h2 class="mb-3 text-lg font-semibold">
    Occurrences ({targetOccCount} / {protocol.targets.length})
  </h2>

  {#if targetOccCount === 0}
    <p class="text-muted-foreground text-sm">No occurrences recorded.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each protocol.targets as target (target.atUri)}
        {@const first = target.record.scope[0]}
        <li class="flex items-center justify-between rounded border px-4 py-3">
          <span class="text-sm">
            {#if first?.$type?.endsWith('#taxonScope')}
              <Taxon taxon={first as TaxonScope} />
            {:else if first?.$type?.endsWith('#verbatimScope')}
              {(first as VerbatimScope).verbatimTargetScope ?? 'Unknown'}
            {/if}
          </span>
          <span class="font-mono text-sm font-semibold">{survey.occurrences.find(o => o.record.surveyTargetID === target.atUri)?.record.organismQuantity ?? 0}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if incidentalOccs.length > 0}
    <h2 class="mb-3 mt-6 text-lg font-semibold">Incidentals ({incidentalOccs.length})</h2>
    <ul class="flex flex-col gap-3">
      {#each incidentalOccs as occ (occ.atUri)}
        <li class="flex items-center justify-between rounded border px-4 py-3">
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
        </li>
      {/each}
    </ul>
  {/if}
</main>
