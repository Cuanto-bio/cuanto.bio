<script lang="ts">
import SurveyCard from '$lib/components/SurveyCard.svelte';

let { data } = $props();

const { protocols, taxonID, taxonName, startDate, stopDate, bbox } = $derived(
  data.filters,
);
const hasFilters = $derived(
  protocols.length > 0 || !!taxonID || !!startDate || !!stopDate || !!bbox,
);
</script>

<main>
  <h1 class="mb-4 text-2xl font-semibold">Surveys</h1>

  {#if hasFilters}
    <div class="mb-5 flex flex-wrap gap-2 text-sm">
      {#each protocols as protocol (protocol.atUri)}
        <span class="rounded-full border bg-secondary px-2.5 py-0.5">
          Protocol: {protocol.title} <span class="text-muted-foreground">(@{protocol.handle})</span>
        </span>
      {/each}
      {#if startDate || stopDate}
        <span class="rounded-full border bg-secondary px-2.5 py-0.5">
          {#if startDate && stopDate}
            {startDate} to {stopDate}
          {:else if startDate}
            From {startDate}
          {:else}
            Until {stopDate}
          {/if}
        </span>
      {/if}
      {#if taxonID}
        <span class="rounded-full border bg-secondary px-2.5 py-0.5">
          Taxon: <span class="text-muted-foreground">
            {#if taxonName}<em>{taxonName}</em>{' '}{/if}(<a
              href={taxonID}
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
            >{taxonID}</a>)
          </span>
        </span>
      {/if}
      {#if bbox}
        <span class="rounded-full border bg-secondary px-2.5 py-0.5">
          N {parseFloat(bbox.north).toFixed(4)},
          S {parseFloat(bbox.south).toFixed(4)},
          E {parseFloat(bbox.east).toFixed(4)},
          W {parseFloat(bbox.west).toFixed(4)}
        </span>
      {/if}
    </div>
  {/if}

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
