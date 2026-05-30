<script lang="ts">
import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
import ExternalLink from '@lucide/svelte/icons/external-link';
import PencilIcon from '@lucide/svelte/icons/pencil';
import GeoMap from '$lib/components/GeoMap.svelte';
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
import Button from './Button.svelte';
import * as Table from './ui/table';

function parseAtUri(atUri: string): { did: string; rkey: string } {
  // atUri format: at://{did}/{collection}/{rkey}
  const [, , did, , rkey] = atUri.split('/');
  return { did, rkey };
}

interface Props {
  protocol: Protocol;
  survey: Survey;
  editable?: boolean;
}

let { protocol, survey, editable = false }: Props = $props();

function extractGeo(s: Survey): { lat: string | null; lon: string | null } {
  const entry = s.record.location?.locations?.find(
    (l) => (l as { $type?: string }).$type === 'community.lexicon.location.geo',
  ) as { latitude?: string; longitude?: string } | undefined;
  return {
    lat: entry?.latitude ? String(entry.latitude) || null : null,
    lon: entry?.longitude ? String(entry.longitude) || null : null,
  };
}

const geo = $derived(extractGeo(survey));

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

<main>
  <div class="mb-4 flex items-center justify-between text-xs">
    <span class="text-muted-foreground">SURVEY</span>
    {#if editable}
      <Button
        href="/app/surveys/{survey.handle}/{survey.rkey}/edit"
        variant="outline"
      >
        <PencilIcon />
        Edit
      </Button>
    {/if}
  </div>
  <Card.Root class="mb-6 p-0">
    <div class="flex flex-col md:flex-row">
      <div class="py-6 flex-1">
        <Card.Header>
          <Card.Title>{survey.protocolTitle}</Card.Title>
          <Card.Description>{survey.record.location.name}</Card.Description>
        </Card.Header>
        <Card.Content class="space-y-2 text-sm">
          <div class="table-compact">
            <Table.Root class="text-sm">
              <Table.Body>
                <Table.Row>
                  <Table.Head>Date</Table.Head>
                  <Table.Cell>{formatDate(survey.record.eventDate ?? null)}</Table.Cell>
                </Table.Row>
                {#if survey.record.eventDurationValue != null}
                  <Table.Row>
                    <Table.Head>Duration</Table.Head>
                    <Table.Cell>
                      {survey.record.eventDurationValue}
                      {survey.record.eventDurationUnit ?? 'min'}
                    </Table.Cell>
                  </Table.Row>
                {/if}
                {#if survey.record.surveyorCount != null}
                  <Table.Row>
                    <Table.Head>Surveyors</Table.Head>
                    <Table.Cell>{survey.record.surveyorCount}</Table.Cell>
                  </Table.Row>
                {/if}
                {#if geo.lat && geo.lon}
                  <Table.Row>
                    <Table.Head>Coordinates</Table.Head>
                    <Table.Cell>
                      <p>
                        <a
                          href="https://www.openstreetmap.org/?mlat={geo.lat}&mlon={geo.lon}"
                          class="flex items-center gap-2"
                        >
                          {geo.lat}, {geo.lon}
                          <ExternalLink class="size-4" />
                        </a>
                      </p>
                    </Table.Cell>
                  </Table.Row>
                {/if}
                <Table.Row>
                  <Table.Head class="ps-0">Protocol</Table.Head>
                  <Table.Cell>
                    <p>
                      <a
                        href="/app/protocols/{survey.protocolHandle}/{survey.protocolRkey}"
                      >{survey.protocolTitle}</a>
                    </p>
                  </Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table.Root>
          </div>
        </Card.Content>
      </div>
      <div class="min-w-1/3 h-[200px] md:h-auto">
        {#if geo.lat && geo.lon}
          <GeoMap latitude={geo.lat} longitude={geo.lon} class="rounded-t-none h-full" />
        {/if}
      </div>
    </div>
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
        {@render surveyTargetRow({ occurrence, taxon: occurrence.identification })}
      {/each}
    </ul>
  {/if}
</main>

<style>
  .table-compact {
    :global(th) {
      padding-inline-start: 0;
      line-height: calc(var(--tw-leading, var(--text-sm--line-height)) * 1.6);
      height: auto;
    }
    :global(tr) {
      border: 0;
    }
    :global(td) {
      padding: 0;
      line-height: calc(var(--tw-leading, var(--text-sm--line-height)) * 1.6);
    }
  }
</style>
