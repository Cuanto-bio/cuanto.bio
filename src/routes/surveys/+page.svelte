<script lang="ts">
import SurveyCard from '$lib/components/SurveyCard.svelte';

let { data } = $props();
</script>

<main>
  <h1 class="mb-6 text-2xl font-semibold">Surveys</h1>

  {#if data.surveys.length === 0}
    <p class="text-muted-foreground text-sm">No surveys yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.surveys as survey (survey.atUri)}
        <li>
          <a href="/surveys/{survey.handle}/{survey.rkey}">
            <SurveyCard
              survey={survey}
              currentUser={data.handle
                ? { avatarUrl: data.avatarUrl, handle: data.handle! }
                : undefined
              }
            />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
