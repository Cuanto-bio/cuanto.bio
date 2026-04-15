<script lang="ts">
import * as Card from '$lib/components/ui/card';

let { data } = $props();

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  return new Date(iso).toLocaleString();
}

function targetLabel(scope: unknown[] | null): string {
  if (!scope) return 'Unknown target';
  const first = scope[0] as Record<string, string> | undefined;
  if (!first) return 'Unknown target';
  if (first.$type?.endsWith('#taxonScope'))
    return first.scientificName ?? 'Unknown';
  if (first.$type?.endsWith('#verbatimScope'))
    return first.verbatimTargetScope ?? 'Unknown';
  return 'Unknown target';
}
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <Card.Root class="mb-6">
    <Card.Header>
      <Card.Title>{data.survey.protocol_title}</Card.Title>
      <Card.Description>{data.survey.location_name}</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-2 text-sm">
      <div>
        <span class="text-muted-foreground font-medium">Date:</span>
        <span class="ml-2">{formatDate(data.survey.event_date)}</span>
      </div>
      {#if data.survey.event_duration_value != null}
        <div>
          <span class="text-muted-foreground font-medium">Duration:</span>
          <span class="ml-2">
            {data.survey.event_duration_value}
            {data.survey.event_duration_unit ?? 'min'}
          </span>
        </div>
      {/if}
      <div>
        <span class="text-muted-foreground font-medium">Protocol:</span>
        <a
          href="/protocols/{data.handle}/{data.survey.protocol_rkey}"
          class="text-primary ml-2 underline"
        >{data.survey.protocol_title}</a>
      </div>
    </Card.Content>
  </Card.Root>

  <h2 class="mb-3 text-lg font-semibold">
    Occurrences ({data.occurrences.length})
  </h2>

  {#if data.occurrences.length === 0}
    <p class="text-muted-foreground text-sm">No occurrences recorded.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.occurrences as occ (occ.at_uri)}
        <li class="flex items-center justify-between rounded border px-4 py-3">
          <span class="text-sm">{targetLabel(occ.scope)}</span>
          <span class="font-mono text-sm font-semibold">{occ.organism_quantity ?? '?'}</span>
        </li>
      {/each}
    </ul>
  {/if}
</main>
