<script lang="ts">
import { afterNavigate, replaceState } from '$app/navigation';
import { page } from '$app/state';
import ProtocolDetail from '$lib/components/ProtocolDetail.svelte';
import {
  addCachedFollowedProtocol,
  removeCachedFollowedProtocol,
} from '$lib/offline/db';
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
  onAfterFollowChange={async (isFollowing, protocol) => {
    // Update the followed-protocols cache directly (and wait for it to land)
    // before kicking off syncOfflineData's network round trip: that fetch can
    // still be in flight if the user taps "Following" in the bottom nav right
    // after following, leaving the list stale until the next full load.
    // `protocol` is what ProtocolDetail captured at click time, not
    // data.protocol here, since this callback only runs after the follow/
    // unfollow POST resolves — by then the user could have navigated to a
    // different protocol that reuses this same route component, making
    // data.protocol point at the wrong one.
    if (isFollowing) {
      await addCachedFollowedProtocol({
        ...protocol,
        followedAt: new Date().toISOString(),
      });
    } else {
      await removeCachedFollowedProtocol(protocol.atUri);
    }
    syncOfflineData(fetch);
  }}
/>
