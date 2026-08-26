<script lang="ts">
import SurveyCard from '$lib/components/SurveyCard.svelte';

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

<main>
  <h1 class="mb-6 text-2xl font-semibold">@{data.ownerHandle}'s Surveys</h1>

  {#if data.surveys.length === 0}
    <p class="text-muted-foreground text-sm">No surveys yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.surveys as survey (survey.atUri)}
        <li>
          <a href="/surveys/{data.ownerHandle}/{survey.rkey}">
            <SurveyCard
              survey={survey}
              currentUser={data.ownerHandle
                ? { avatarUrl: data.avatarUrl, handle: data.ownerHandle! }
                : undefined
              }
            />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
