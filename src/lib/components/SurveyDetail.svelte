<script lang="ts">
import * as Card from '$lib/components/ui/card';
import type { Protocol, Survey } from '$lib/offline/db';

interface Props {
  protocol: Protocol;
  survey: Survey;
}

let { protocol, survey }: Props = $props();

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
  <div class="text-muted-foreground text-xs mb-4">SURVEY</div>
  <Card.Root class="mb-6">
    <Card.Header>
      <Card.Title>{survey.protocolTitle}</Card.Title>
      <Card.Description>{survey.locationName}</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-2 text-sm">
      <div>
        <span class="text-muted-foreground font-medium">Date:</span>
        <span class="ml-2">{formatDate(survey.eventDate)}</span>
      </div>
      {#if survey.eventDurationValue != null}
        <div>
          <span class="text-muted-foreground font-medium">Duration:</span>
          <span class="ml-2">
            {survey.eventDurationValue}
            {survey.eventDurationUnit ?? 'min'}
          </span>
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
    Occurrences ({survey.occurrences.length} / {protocol.targets.length})
  </h2>

  {#if survey.occurrences.length === 0}
    <p class="text-muted-foreground text-sm">No occurrences recorded.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each protocol.targets as target (target.atUri)}
        <li class="flex items-center justify-between rounded border px-4 py-3">
          <span class="text-sm">{targetLabel(target.scope)}</span>
          <span class="font-mono text-sm font-semibold">{survey.occurrences.find(o => o.surveyTargetUri === target.atUri)?.organismQuantity ?? 0}</span>
        </li>
      {/each}
    </ul>
  {/if}
</main>
