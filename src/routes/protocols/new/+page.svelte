<script lang="ts">
import Autocomplete from '$lib/components/Autocomplete.svelte';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { Textarea } from '$lib/components/ui/textarea';
import { useOnline } from '$lib/composables/online.svelte';

const onlineState = useOnline();

type TaxonTarget = {
  kind: 'taxon';
  scientificName: string;
  taxonRank: string;
  taxonID: string;
  kingdom?: string;
  commonName?: string;
};

type VerbatimTarget = {
  kind: 'verbatim';
  verbatimTargetScope: string;
};

type Target = TaxonTarget | VerbatimTarget;

type InatResult = {
  inatId: number;
  scientificName: string;
  taxonRank: string;
  commonName: string | null;
  kingdom: string | null;
  taxonID: string;
};

let targets = $state<Target[]>([]);
let taxonQuery = $state('');
let taxonResults = $state<InatResult[]>([]);
let searching = $state(false);

$effect(() => {
  if (taxonQuery.trim().length < 2) {
    taxonResults = [];
    return;
  }
  const query = taxonQuery.trim();
  const timer = setTimeout(async () => {
    searching = true;
    try {
      const resp = await fetch(`/api/taxa?q=${encodeURIComponent(query)}`);
      const data = await resp.json();
      taxonResults = data.results ?? [];
    } finally {
      searching = false;
    }
  }, 300);
  return () => clearTimeout(timer);
});

function toScope(target: Target): unknown {
  if (target.kind === 'taxon') {
    return {
      $type: 'bio.lexicons.temp.surveyTarget#taxonScope',
      scientificName: target.scientificName,
      taxonRank: target.taxonRank,
      taxonID: target.taxonID,
      ...(target.kingdom ? { kingdom: target.kingdom } : {}),
    };
  }
  return {
    $type: 'bio.lexicons.temp.surveyTarget#verbatimScope',
    verbatimTargetScope: target.verbatimTargetScope,
  };
}

function targetsJson(): string {
  return JSON.stringify(targets.map((t) => ({ scope: [toScope(t)] })));
}

function addTaxon(result: InatResult) {
  targets = [
    ...targets,
    {
      kind: 'taxon',
      scientificName: result.scientificName,
      taxonRank: result.taxonRank,
      taxonID: result.taxonID,
      ...(result.kingdom ? { kingdom: result.kingdom } : {}),
      ...(result.commonName ? { commonName: result.commonName } : {}),
    },
  ];
  taxonQuery = '';
  taxonResults = [];
}

function addVerbatim() {
  targets = [...targets, { kind: 'verbatim', verbatimTargetScope: '' }];
}

function removeTarget(i: number) {
  targets = targets.filter((_, idx) => idx !== i);
}

function labelFor(target: Target): string {
  if (target.kind === 'taxon') {
    return target.commonName
      ? `${target.scientificName} (${target.commonName})`
      : target.scientificName;
  }
  return target.verbatimTargetScope || '(empty)';
}
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <Card.Root>
    <Card.Header>
      <Card.Title>New Protocol</Card.Title>
      <Card.Description>Define what surveyors should look for.</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if !onlineState.value}
        <p class="text-muted-foreground text-sm">
          Creating a protocol requires an internet connection. Please reconnect and try again.
        </p>
      {:else}
      <form method="POST" class="flex flex-col gap-6">
        <div class="flex flex-col gap-2">
          <Label for="title">Title</Label>
          <Input id="title" name="title" required placeholder="e.g. Urban Pollinator Survey" />
        </div>

        <div class="flex flex-col gap-2">
          <Label for="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            required
            placeholder="Describe what participants should do and observe."
            rows={4}
          />
        </div>

        <div class="flex flex-col gap-2">
          <Label>Required fields</Label>
          <div class="flex flex-col gap-1">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="requiredFields" value="eventDate" />
              Event date
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="requiredFields" value="eventDuration" />
              Event duration
            </label>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <Label>Survey targets</Label>

          {#if targets.length > 0}
            <ul class="flex flex-col gap-1">
              {#each targets as target, i (i)}
                <li class="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  {#if target.kind === 'verbatim'}
                    <input
                      class="flex-1 bg-transparent outline-none"
                      placeholder="Describe what to look for…"
                      bind:value={target.verbatimTargetScope}
                    />
                  {:else}
                    <span class="flex-1">{labelFor(target)}</span>
                  {/if}
                  <button
                    type="button"
                    onclick={() => removeTarget(i)}
                    class="text-muted-foreground hover:text-foreground ml-2"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <Autocomplete
            placeholder="Search taxa (e.g. Quercus)"
            autocomplete="off"
            bind:value={taxonQuery}
            items={taxonResults}
            onselect={addTaxon}
          >
            {#snippet item(result)}
              <span class="font-medium">{result.scientificName}</span>
              <span class="text-muted-foreground text-xs">{result.taxonRank}</span>
              {#if result.commonName}
                <span class="text-muted-foreground">— {result.commonName}</span>
              {/if}
            {/snippet}
          </Autocomplete>
          {#if searching && taxonResults.length === 0}
            <p class="text-muted-foreground mt-1 text-xs">Searching…</p>
          {/if}

          <Button type="button" variant="outline" onclick={addVerbatim} class="w-fit">
            + Add verbatim target
          </Button>
        </div>

        <input type="hidden" name="targets" value={targetsJson()} />

        <Button type="submit">Create protocol</Button>
      </form>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
