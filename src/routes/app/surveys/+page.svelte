<script lang="ts">
import * as Card from '$lib/components/ui/card';

let { data } = $props();

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  return new Date(iso).toLocaleString();
}

function formatDuration(value: number | null, unit: string | null): string {
  if (value == null) return '';
  return `${value} ${unit ?? 'min'}`;
}
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <h1 class="mb-6 text-2xl font-semibold">Your Surveys</h1>

  {#if data.surveys.length === 0}
    <p class="text-muted-foreground text-sm">No surveys yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.surveys as survey (survey.atUri)}
        <li>
          <a href="/app/surveys/{survey.handle}/{survey.rkey}">
            <Card.Root class="hover:bg-muted transition-colors">
              <Card.Header>
                <Card.Title>{survey.protocolTitle}</Card.Title>
                <Card.Description>{survey.locationName}</Card.Description>
              </Card.Header>
              <Card.Content class="text-muted-foreground flex gap-4 text-sm">
                <span>{formatDate(survey.eventDate)}</span>
                {#if survey.eventDurationValue != null}
                  <span>{formatDuration(survey.eventDurationValue, survey.eventDurationUnit)}</span>
                {/if}
                <span>
                  {survey.occurrences.length}
                  {survey.occurrences.length === 1 ? 'occurrence' : 'occurrences'}
                </span>
              </Card.Content>
            </Card.Root>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
