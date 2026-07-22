<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';
import { onMount, untrack } from 'svelte';
import LocationPicker from '$lib/components/LocationPicker.svelte';
import ProtocolAutocomplete, {
  type ProtocolResult,
} from '$lib/components/ProtocolAutocomplete.svelte';
import SparkbarDialog from '$lib/components/SparkbarDialog.svelte';
import SparkbarInfo from '$lib/components/SparkbarInfo.svelte';
import Taxon from '$lib/components/Taxon.svelte';
import * as Card from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as Table from '$lib/components/ui/table';
import * as Tabs from '$lib/components/ui/tabs';
import type { Bbox } from '$lib/map/locationGeometry';
import type { StatsResult } from '$lib/server/db/stats';
import { seriesMax } from '$lib/sparkbar';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();

let selectedProtocols = $state<ProtocolResult[]>(
  untrack(() => data.initialProtocols),
);
let startDate = $state(untrack(() => data.initialStart));
let endDate = $state(untrack(() => data.initialEnd));
let bbox = $state<Bbox | null>(untrack(() => data.initialBbox));
let loading = $state(false);
let errorMsg = $state<string | null>(null);
let stats = $state<StatsResult | null>(null);
let mounted = $state(false);

function addProtocol(result: ProtocolResult) {
  if (selectedProtocols.some((p) => p.atUri === result.atUri)) return;
  selectedProtocols = [...selectedProtocols, result];
}

function removeProtocol(atUri: string) {
  selectedProtocols = selectedProtocols.filter((p) => p.atUri !== atUri);
}

async function loadStats() {
  loading = true;
  errorMsg = null;
  stats = null;

  const params = new URLSearchParams();
  params.set('protocols', selectedProtocols.map((p) => p.atUri).join(','));
  if (startDate) params.set('start', `${startDate}T00:00:00Z`);
  if (endDate) params.set('end', `${endDate}T23:59:59.999Z`);
  if (bbox) {
    params.set('bboxNorth', bbox.north);
    params.set('bboxSouth', bbox.south);
    params.set('bboxEast', bbox.east);
    params.set('bboxWest', bbox.west);
  }

  const resp = await fetch(`/api/stats?${params}`);
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    errorMsg = body.error ?? 'Something went wrong. Please try again.';
    loading = false;
    return;
  }

  stats = (await resp.json()) as StatsResult;
  loading = false;
}

$effect(() => {
  if (!mounted) return;
  const params = new URLSearchParams();
  if (selectedProtocols.length > 0) {
    params.set('protocols', selectedProtocols.map((p) => p.atUri).join(','));
  }
  if (startDate) params.set('start', startDate);
  if (endDate) params.set('stop', endDate);
  if (bbox) {
    params.set('bboxNorth', bbox.north);
    params.set('bboxSouth', bbox.south);
    params.set('bboxEast', bbox.east);
    params.set('bboxWest', bbox.west);
  }
  const qs = params.toString();
  history.replaceState(history.state, '', qs ? `?${qs}` : location.pathname);
});

$effect(() => {
  if (selectedProtocols.length === 0) {
    stats = null;
    errorMsg = null;
    return;
  }
  loadStats();
});

onMount(() => {
  mounted = true;
});

// One ceiling per series type so bar heights compare across rows. Taxa share a
// single max across both the Species and Taxa tabs, so a taxon does not change
// height when you switch between them.
const taxonSparkbarMax = $derived(seriesMax(stats?.taxonWeekly));
const targetSparkbarMax = $derived(seriesMax(stats?.targetWeekly));

function surveysUrl(extraParams: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    protocols: selectedProtocols.map((pr) => pr.atUri).join(','),
    ...extraParams,
  });
  if (startDate) p.set('start', startDate);
  if (endDate) p.set('stop', endDate);
  if (bbox) {
    p.set('bboxNorth', bbox.north);
    p.set('bboxSouth', bbox.south);
    p.set('bboxEast', bbox.east);
    p.set('bboxWest', bbox.west);
  }
  return `/surveys?${p}`;
}
</script>

{#snippet taxonTable(taxa: StatsResult['taxa'], emptyMessage: string)}
{#if taxa.length > 0}
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>Scientific Name</Table.Head>
        <Table.Head class="whitespace-nowrap">
          Trend
          <SparkbarInfo scope="taxon" />
        </Table.Head>
        <Table.Head class="text-right">Surveys</Table.Head>
        <Table.Head class="text-right">Count</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each taxa as taxon (taxon.taxonId)}
        {@const weekly = stats?.taxonWeekly?.[taxon.taxonId]}
        <Table.Row>
          <Table.Cell>
            <a
              href={taxon.taxonId}
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
            >
              <Taxon taxon={{
                scientificName: taxon.scientificName ?? taxon.taxonId,
                taxonRank: taxon.taxonRank ?? undefined,
              }} />
            </a>
          </Table.Cell>
          <Table.Cell>
            {#if weekly}
              <SparkbarDialog
                points={weekly}
                max={taxonSparkbarMax}
                taxon={{
                  scientificName: taxon.scientificName ?? taxon.taxonId,
                  taxonRank: taxon.taxonRank ?? undefined,
                }}
                scope="taxon"
              />
            {:else}
              <span class="text-muted-foreground">—</span>
            {/if}
          </Table.Cell>
          <Table.Cell class="text-right">
            <p><a href={surveysUrl({ taxonID: taxon.taxonId })}>
              {taxon.surveyCount}
            </a></p>
          </Table.Cell>
          <Table.Cell class="text-right">{taxon.totalCount}</Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
{:else}
  <p class="text-sm text-muted-foreground">{emptyMessage}</p>
{/if}
{/snippet}

{#snippet statCard(stat: number, label: string, opts?: {
  url?: string,
  class?: string,
})}
<Card.Root class={opts?.class}>
  {#if opts?.url}
    <a href={opts.url}>
      <Card.Content class="">
        <p class="text-2xl font-bold">
          {stat}
        </p>
        <p class="text-sm text-muted-foreground">{label}</p>
      </Card.Content>
    </a>
  {:else}
    <Card.Content class="">
      <p class="text-2xl font-bold">
        {stat}
      </p>
      <p class="text-sm text-muted-foreground">{label}</p>
    </Card.Content>
  {/if}
</Card.Root>
{/snippet}

<svelte:head>
  <title>Stats Explorer</title>
</svelte:head>

<main class="flex flex-col gap-6">
  <h1 class="text-2xl font-semibold">Stats Explorer</h1>

  <Card.Root>
    <Card.Content class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label>Protocols</Label>
        <ProtocolAutocomplete onSelectProtocol={addProtocol} />
        {#if selectedProtocols.length > 0}
          <ul class="flex flex-wrap gap-1.5 mt-1">
            {#each selectedProtocols as protocol (protocol.atUri)}
              <li class="flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-0.5 text-sm">
                <span>{protocol.title}</span>
                <span class="text-muted-foreground text-xs">@{protocol.handle}</span>
                <button
                  type="button"
                  class="ml-0.5 rounded-full hover:bg-muted p-0.5"
                  onclick={() => removeProtocol(protocol.atUri)}
                  aria-label="Remove {protocol.title}"
                >
                  <XIcon class="size-3" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
          <Label for="start-date">Start</Label>
          <Input
            id="start-date"
            type="date"
            value={startDate}
            oninput={(e) => (startDate = (e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="end-date">End</Label>
          <Input
            id="end-date"
            type="date"
            value={endDate}
            oninput={(e) => (endDate = (e.currentTarget as HTMLInputElement).value)}
          />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label>Bounding box (optional)</Label>
        <LocationPicker
          mode="bbox"
          bbox={bbox}
          showModeSelector={false}
          onchange={(p) => (bbox = p.bbox)}
        />
      </div>

    </Card.Content>
  </Card.Root>

  {#if selectedProtocols.length === 0}
    <p class="text-sm text-muted-foreground">Select a protocol to load stats.</p>
  {:else if loading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if errorMsg}
    <p class="text-sm text-destructive">{errorMsg}</p>
  {:else if stats}
    {@const speciesTaxa = stats.taxa.filter((t) => t.taxonRank === 'species')}
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {@render statCard(stats.surveyCount, "Surveys", {url: surveysUrl()})}
      {@render statCard(speciesTaxa.length, "Species")}
      {@render statCard(stats.taxa.length, "Taxa counted")}
      {@render statCard(stats.distinctTargetCount, "Targets counted")}
      {@render statCard(stats.totalIndividuals, "Individuals", {class: "col-span-2 sm:col-span-1"})}
    </div>

    <Tabs.Root value="species">
      <Tabs.List variant="line">
        <Tabs.Trigger value="species">Species ({speciesTaxa.length})</Tabs.Trigger>
        <Tabs.Trigger value="taxa">Taxa ({stats.taxa.length})</Tabs.Trigger>
        <Tabs.Trigger value="targets">Targets ({stats.targets.length})</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="species" class="mt-4">
        {@render taxonTable(speciesTaxa, 'No species data for the selected filters.')}
      </Tabs.Content>

      <Tabs.Content value="taxa" class="mt-4">
        {@render taxonTable(stats.taxa, 'No taxon data for the selected filters.')}
      </Tabs.Content>

      <Tabs.Content value="targets" class="mt-4">
        {#if stats.targets.length > 0}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Target</Table.Head>
                <Table.Head class="whitespace-nowrap">
                  Trend
                  <SparkbarInfo scope="target" />
                </Table.Head>
                <Table.Head class="text-right">Surveys</Table.Head>
                <Table.Head class="text-right">Count</Table.Head>
                <Table.Head>Type</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each stats.targets as target (target.protocolTargetUri)}
                {@const weekly = stats.targetWeekly?.[target.protocolTargetUri]}
                <Table.Row>
                  <Table.Cell>
                    {#if target.scopeType === 'taxon' && target.label}
                      <em>{target.label}</em>
                    {:else}
                      {target.label ?? target.protocolTargetUri.split('/').at(-1)}
                    {/if}
                  </Table.Cell>
                  <Table.Cell>
                    {#if weekly}
                      <SparkbarDialog
                        points={weekly}
                        max={targetSparkbarMax}
                        title={target.label ??
                          target.protocolTargetUri.split('/').at(-1) ??
                          'Target'}
                        taxon={target.scopeType === 'taxon' &&
                        target.scopeCount === 1 &&
                        target.label
                          ? {
                              scientificName: target.label,
                              taxonRank: target.taxonRank ?? undefined,
                            }
                          : undefined}
                        scope="target"
                      />
                    {:else}
                      <span class="text-muted-foreground">—</span>
                    {/if}
                  </Table.Cell>
                  <Table.Cell class="text-right">{target.surveyCount}</Table.Cell>
                  <Table.Cell class="text-right">{target.totalCount}</Table.Cell>
                  <Table.Cell class="text-muted-foreground capitalize">
                    {target.scopeType}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {:else}
          <p class="text-sm text-muted-foreground">No target data for the selected filters.</p>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</main>
