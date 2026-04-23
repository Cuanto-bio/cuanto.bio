<script lang="ts">
import SurveyDetail from '$lib/components/SurveyDetail.svelte';

let { data } = $props();
</script>

<SurveyDetail survey={data.survey} protocol={data.protocol} />
