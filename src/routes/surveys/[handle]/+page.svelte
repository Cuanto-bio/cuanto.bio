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
  <h1 class="mb-6 text-2xl font-semibold">@{data.handle}'s Surveys</h1>

  {#if data.surveys.length === 0}
    <p class="text-muted-foreground text-sm">No surveys yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.surveys as survey (survey.at_uri)}
        <li>
          <a href="/surveys/{data.handle}/{survey.rkey}">
            <Card.Root class="hover:bg-muted transition-colors">
              <Card.Header>
                <Card.Title>{survey.protocol_title}</Card.Title>
                <Card.Description>{survey.location_name}</Card.Description>
              </Card.Header>
              <Card.Content class="text-muted-foreground flex gap-4 text-sm">
                <span>{formatDate(survey.event_date)}</span>
                {#if survey.event_duration_value != null}
                  <span>{formatDuration(survey.event_duration_value, survey.event_duration_unit)}</span>
                {/if}
                <span>
                  {survey.occurrence_count}
                  {survey.occurrence_count === 1 ? 'occurrence' : 'occurrences'}
                </span>
              </Card.Content>
            </Card.Root>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
