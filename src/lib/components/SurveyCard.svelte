<script lang="ts">
import * as Card from '$lib/components/ui/card';

let { survey } = $props();

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  return new Date(iso).toLocaleString();
}

function formatDuration(value: number | null, unit: string | null): string {
  if (value == null) return '';
  return `${value} ${unit ?? 'minutes'}`;
}
</script>

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