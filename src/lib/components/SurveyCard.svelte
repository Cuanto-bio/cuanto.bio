<script lang="ts">
import * as Card from '$lib/components/ui/card';
import type { PendingSurvey, Survey } from '$lib/offline/db';
import Handle from './handle.svelte';

type Props = {
  survey: Survey | PendingSurvey;
  currentUser?: {
    handle: string;
    avatarUrl?: string | null;
  };
};
let { survey, currentUser }: Props = $props();

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
  const displayUnit = (unit ?? 'minutes') === 'minutes' ? 'mins' : unit;
  return `${value} ${displayUnit}`;
}
</script>

<Card.Root class="hover:bg-muted transition-colors">
  <Card.Header>
    {#if isSurvey(survey)}
      <Handle handle={survey.handle} avatarUrl={survey.avatarUrl} />
    {:else if currentUser}
      <Handle handle={currentUser.handle} avatarUrl={currentUser.avatarUrl} />
    {/if}
    <Card.Title>{survey.protocolTitle}</Card.Title>
  </Card.Header>
  <Card.Footer class="text-muted-foreground flex flex-row text-sm justify-between gap-2 items-end">
    <div>
      <Card.Description>{locationName}</Card.Description>
      {formatDate(eventDate)}
    </div>
    <div class="flex flex-row gap-2">
      {#if eventDurationValue != null}
        <div>{formatDuration(eventDurationValue, eventDurationUnit)}</div>
      {/if}
      <div>
        {survey.occurrences.length}
        found
      </div>
    </div>
  </Card.Footer>
</Card.Root>
