<script lang="ts">
import { afterNavigate, replaceState } from '$app/navigation';
import { page } from '$app/state';
import ProtocolDetail from '$lib/components/ProtocolDetail.svelte';
import { syncOfflineData } from '$lib/offline/sync';

let { data } = $props();

type LastSurveyByTargetUri = Record<
  string,
  { date: string; handle: string; rkey: string }
>;

// lastSurveyByTargetUri may be a resolved object (cold path) or a promise that
// streams in over the cached render (warm path). Normalize to reactive state so
// the column renders "—" first and fills in when the fetch resolves.
let lastSurveyByTargetUri = $state<LastSurveyByTargetUri | undefined>(
  undefined,
);
$effect(() => {
  Promise.resolve(data.lastSurveyByTargetUri).then((v) => {
    lastSurveyByTargetUri = v;
  });
});

// This page serves cached content first, but if we landed here after
// updating the protocol, we use a param to indicate the page should fetch
// fresh content ASAP. This just removes that param from the URL.
// afterNavigate ensures the router is initialized before calling replaceState.
afterNavigate(() => {
  if (page.url.searchParams.has('updated')) {
    const clean = new URL(page.url);
    clean.searchParams.delete('updated');
    replaceState(clean, page.state);
  }
});
</script>

<ProtocolDetail
  protocol={data.protocol}
  followerCount={data.followerCount}
  isFollowing={data.isFollowing}
  isOffline={data.offline}
  isOwner={data.isOwner}
  isSignedIn={!!data.did}
  {lastSurveyByTargetUri}
  onAfterFollowChange={() => syncOfflineData(fetch)}
/>
