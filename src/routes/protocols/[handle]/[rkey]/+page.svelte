<script lang="ts">
import ProtocolDetail from '$lib/components/ProtocolDetail.svelte';

let { data } = $props();
</script>

<ProtocolDetail
  protocol={data.protocol}
  targets={data.targets}
  followerCount={data.followerCount}
/>
