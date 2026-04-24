<script lang="ts">
import ProtocolDetail from '$lib/components/ProtocolDetail.svelte';
import { syncOfflineData } from '$lib/offline/sync';

let { data } = $props();
</script>

<ProtocolDetail
  protocol={data.protocol}
  followerCount={data.followerCount}
  isFollowing={data.isFollowing}
  canFollow={!data.offline}
  offline={data.offline}
  onAfterFollowChange={() => syncOfflineData(fetch)}
/>
