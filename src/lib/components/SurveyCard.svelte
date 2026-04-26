<script lang="ts">
import * as Card from '$lib/components/ui/card';
import type { PendingSurvey, Survey } from '$lib/offline/db';
import Handle from './handle.svelte';

let { survey }: { survey: Survey | PendingSurvey } = $props();

const isSurvey = (s: Survey | PendingSurvey): s is Survey => 'record' in s;

const locationName = $derived(
  isSurvey(survey) ? survey.record.location.name : survey.locationName,
);
const eventDate = $derived(
  isSurvey(survey) ? (survey.record.eventDate ?? null) : survey.eventDate,
);
const eventDurationValue = $derived(
  isSurvey(survey)
    ? (survey.record.eventDurationValue ?? null)
    : survey.eventDurationValue,
);
const eventDurationUnit = $derived(
  isSurvey(survey)
    ? (survey.record.eventDurationUnit ?? null)
    : survey.eventDurationUnit,
);

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
    <Card.Description>{locationName}</Card.Description>
  </Card.Header>
  <Card.Content class="text-muted-foreground flex gap-4 text-sm">
    {#if isSurvey(survey)}
      <Handle handle={survey.handle} avatarUrl={survey.avatarUrl} />
    {/if}
    <span>{formatDate(eventDate)}</span>
    {#if eventDurationValue != null}
      <span>{formatDuration(eventDurationValue, eventDurationUnit)}</span>
    {/if}
    <span>
      {survey.occurrences.length}
      {survey.occurrences.length === 1 ? 'occurrence' : 'occurrences'}
    </span>
  </Card.Content>
</Card.Root>
