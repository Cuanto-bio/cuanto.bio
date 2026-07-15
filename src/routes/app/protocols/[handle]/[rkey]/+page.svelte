<script lang="ts">
import { afterNavigate, replaceState } from '$app/navigation';
import { page } from '$app/state';
import ProtocolDetail from '$lib/components/ProtocolDetail.svelte';
import {
  addCachedFollowedProtocol,
  removeCachedFollowedProtocol,
} from '$lib/offline/db';
import { syncOfflineData } from '$lib/offline/sync';
import type { ProtocolActivity } from '$lib/server/db/protocol-activity';
import type { FollowerPreview } from '$lib/server/db/protocol-follows';

let { data } = $props();

// activity may be a resolved object (cold path) or a promise that streams in
// over the cached render (warm path). Normalize to reactive state so the tabs
// render a loading state first and fill in when the fetch resolves. Seed it
// from the cold path synchronously so the server render shows real counts
// rather than a loading state it will never clear (effects don't run on SSR).
// svelte-ignore state_referenced_locally -- intentional: the effect below takes over once the prop changes
let activity = $state<ProtocolActivity | undefined>(
  data.activity instanceof Promise ? undefined : data.activity,
);
// svelte-ignore state_referenced_locally -- intentional: see above
let activityPending = $state(data.activity instanceof Promise);

// followerCount follows the same resolved-value-or-promise shape as activity
// above: undefined while pending or offline (never a cached guess), filled in
// once this page load's own fetch resolves.
// svelte-ignore state_referenced_locally -- intentional: see activity above
let followerCount = $state<number | undefined>(
  data.followerCount instanceof Promise ? undefined : data.followerCount,
);

// followerPreview follows the same resolved-value-or-promise shape as
// followerCount above.
// svelte-ignore state_referenced_locally -- intentional: see activity above
let followerPreview = $state<FollowerPreview[] | undefined>(
  data.followerPreview instanceof Promise ? undefined : data.followerPreview,
);

// offline follows the same shape too: assumed online (false) until this
// page load's own fetch either succeeds or fails to reach the server, which
// is more reliable than navigator.onLine (see +page.ts).
// svelte-ignore state_referenced_locally -- intentional: see activity above
let offline = $state(data.offline instanceof Promise ? false : data.offline);

$effect(() => {
  const next = data.activity;
  if (!(next instanceof Promise)) {
    activity = next;
    activityPending = false;
    return;
  }
  // Drop the previous protocol's activity rather than leaving it on screen:
  // this route component gets reused when navigating to another protocol, and
  // `next` resolves asynchronously. The cleanup keeps a slow fetch for the
  // protocol we just left from overwriting the one we're on now.
  activity = undefined;
  activityPending = true;
  let current = true;
  next.then((value) => {
    if (!current) return;
    activity = value;
    activityPending = false;
  });
  return () => {
    current = false;
  };
});

$effect(() => {
  const next = data.followerCount;
  if (!(next instanceof Promise)) {
    followerCount = next;
    return;
  }
  followerCount = undefined;
  let current = true;
  next.then((value) => {
    if (!current) return;
    followerCount = value;
  });
  return () => {
    current = false;
  };
});

$effect(() => {
  const next = data.followerPreview;
  if (!(next instanceof Promise)) {
    followerPreview = next;
    return;
  }
  followerPreview = undefined;
  let current = true;
  next.then((value) => {
    if (!current) return;
    followerPreview = value;
  });
  return () => {
    current = false;
  };
});

$effect(() => {
  const next = data.offline;
  if (!(next instanceof Promise)) {
    offline = next;
    return;
  }
  offline = false;
  let current = true;
  next.then((value) => {
    if (!current) return;
    offline = value;
  });
  return () => {
    current = false;
  };
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
  {followerCount}
  {followerPreview}
  isFollowing={data.isFollowing}
  isOffline={offline}
  isOwner={data.isOwner}
  isSignedIn={!!data.did}
  {activity}
  {activityPending}
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
