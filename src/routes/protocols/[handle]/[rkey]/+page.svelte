<script lang="ts">
import ProtocolDetail from '$lib/components/ProtocolDetail.svelte';

let { data } = $props();
</script>

<ProtocolDetail
  protocol={data.protocol}
  followerCount={data.followerCount}
  lastSurveyByTargetUri={data.lastSurveyByTargetUri}
/>
