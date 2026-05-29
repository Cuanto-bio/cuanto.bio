<script lang="ts">
import { invalidateAll } from '$app/navigation';
import OrphanedOccurrences from '$lib/components/OrphanedOccurrences.svelte';
import SurveyDetail from '$lib/components/SurveyDetail.svelte';
import { type CachedSurvey, cacheSurvey } from '$lib/offline/db';

let { data } = $props();

async function refreshSurvey() {
  const res = await fetch(
    `/api/surveys/${data.survey.handle}/${data.survey.rkey}`,
  );
  if (res.ok) {
    const fresh = (await res.json()) as CachedSurvey;
    await cacheSurvey(fresh);
    await invalidateAll();
  }
}
</script>

<SurveyDetail
  survey={data.survey}
  protocol={data.protocol}
  editable={data.isOwner}
/>
{#if data.isOwner}
  <div>
    <OrphanedOccurrences
      occurrences={data.survey.occurrences}
      targets={data.protocol.targets}
      onSuccess={refreshSurvey}
    />
  </div>
{/if}
