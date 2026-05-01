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

<main class="mx-auto max-w-2xl px-4 pb-8">
  <h1 class="mb-6 text-2xl font-semibold">@{data.handle}'s Surveys</h1>

  {#if data.surveys.length === 0}
    <p class="text-muted-foreground text-sm">No surveys yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.surveys as survey (survey.atUri)}
        <li>
          <a href="/surveys/{data.handle}/{survey.rkey}">
            <SurveyCard survey={survey} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
