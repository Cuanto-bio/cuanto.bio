<script lang="ts">
import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
import ExternalLink from '@lucide/svelte/icons/external-link';
import TargetFilterControls from '$lib/components/TargetFilterControls.svelte';
import type { TaxonProp } from '$lib/components/Taxon.svelte';
import Taxon from '$lib/components/Taxon.svelte';
import * as Card from '$lib/components/ui/card';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import type {
  Occurrence,
  Protocol,
  Survey,
  TaxonScope,
  VerbatimScope,
} from '$lib/offline/db';
import { createTargetFilter } from '$lib/targets.svelte';

function parseAtUri(atUri: string): { did: string; rkey: string } {
  // atUri format: at://{did}/{collection}/{rkey}
  const [, , did, , rkey] = atUri.split('/');
  return { did, rkey };
}

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

const targetFilter = createTargetFilter(
  () => protocol.targets,
  (t) => survey.occurrences.some((o) => o.record.surveyTargetID === t.atUri),
  { initialOnlyObserved: true },
);

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  return new Date(iso).toLocaleString();
}

const externalLinkProps =
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true)
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};
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
      gap-2
    "
  >
    <span class="text-sm">
      {#if opts.taxon}
        <Taxon taxon={opts.taxon} />
      {:else if opts.verbatimTargetScope}
        {opts.verbatimTargetScope ?? 'Unknown'}
      {/if}
    </span>
    <div class="flex items-center gap-4">
      <span class="font-mono text-sm font-semibold">
        {opts.occurrence?.record.organismQuantity ?? 0}
      </span>
      {#if opts.occurrence}
        {@const occurrence = opts.occurrence}
        {@const { did, rkey } = parseAtUri(occurrence.atUri)}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <button
                class="text-muted-foreground hover:text-foreground p-1"
                aria-label="View occurrence"
                {...props}
              >
                <EllipsisVertical class="size-4" />
              </button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Label>View occurrence</DropdownMenu.Label>
            <DropdownMenu.Item>
              {#snippet child({ props })}
                <a
                  href="https://observ.ing/observation/{did}/{rkey}"
                  {...externalLinkProps}
                  {...props}
                >
                  <ExternalLink class="size-4" />
                  observ.ing
                </a>
              {/snippet}
            </DropdownMenu.Item>
            <DropdownMenu.Item>
              {#snippet child({ props })}
                <a
                  href="https://pds.ls/{occurrence.atUri}"
                  {...externalLinkProps}
                  {...props}
                >
                  <ExternalLink class="size-4" />
                  pds.ls
                </a>
              {/snippet}
            </DropdownMenu.Item>
            {#if occurrence.record.taxonID}
              {@const taxonID = occurrence.record.taxonID}
              {@const taxonLabel = taxonID.includes('inaturalist.org') ? 'iNaturalist' : taxonID}
              <DropdownMenu.Separator />
              <DropdownMenu.Label>View taxon</DropdownMenu.Label>
              <DropdownMenu.Item>
                {#snippet child({ props })}
                  <a href={taxonID} {...externalLinkProps} {...props}>
                    <ExternalLink class="size-4" />
                    {taxonLabel}
                  </a>
                {/snippet}
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
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

  <h2 class="mb-3 text-lg font-semibold">
    Targets ({targetOccCount} / {protocol.targets.length})
  </h2>
  <TargetFilterControls filter={targetFilter} class="mb-3" />

  {#if targetFilter.filtered.length === 0}
    <p class="text-muted-foreground text-sm">
      {#if targetFilter.filterQuery.trim()}
        No targets match "{targetFilter.filterQuery.trim()}".
      {:else if targetFilter.onlyObserved}
        No occurrences recorded.
        <button
          class="underline"
          onclick={() => (targetFilter.onlyObserved = false)}
        >Show all targets</button>
      {:else}
        No occurrences recorded.
      {/if}
    </p>
  {:else}
    <ul class="flex flex-col gap-0">
      {#each targetFilter.filtered as target (target.atUri)}
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
