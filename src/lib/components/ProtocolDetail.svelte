<script lang="ts">
import { enhance } from '$app/forms';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';

interface Protocol {
  at_uri: string;
  title: string;
  description: string;
  required_fields: string[];
  created_at?: string;
}

interface Target {
  at_uri: string;
  scope: unknown[];
}

interface Props {
  protocol: Protocol;
  targets: Target[];
  followerCount: number;
  isFollowing?: boolean;
  canFollow?: boolean;
  offline?: boolean;
  onAfterFollowChange?: () => void;
}

let {
  protocol,
  targets,
  followerCount: initialFollowerCount,
  isFollowing: initialIsFollowing,
  canFollow,
  offline = false,
  onAfterFollowChange = () => {},
}: Props = $props();

// svelte-ignore state_referenced_locally -- intentional: local optimistic state
let isFollowing = $state(!!initialIsFollowing);
// svelte-ignore state_referenced_locally -- intentional: local optimistic state
let followerCount = $state(initialFollowerCount);

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <div class="mb-6 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-muted-foreground text-sm">
        {followerCount}
        {followerCount === 1 ? 'follower' : 'followers'}
      </span>
      {#if canFollow}
        {#if isFollowing}
          <form
            method="POST"
            action="?/unfollow"
            use:enhance={() => {
              return ({ result }) => {
                if (result.type === 'success') {
                  isFollowing = false;
                  followerCount = Math.max(0, followerCount - 1);
                  onAfterFollowChange();
                }
              };
            }}
          >
            <Button type="submit" variant="outline">Unfollow</Button>
          </form>
        {:else}
          <form
            method="POST"
            action="?/follow"
            use:enhance={() => {
              return ({ result }) => {
                if (result.type === 'success') {
                  isFollowing = true;
                  followerCount += 1;
                  onAfterFollowChange();
                }
              };
            }}
          >
            <Button type="submit">Follow this protocol</Button>
          </form>
        {/if}
      {:else if offline}
        <span class="text-muted-foreground text-xs">(follow requires connection)</span>
      {/if}
    </div>
    <Button href="/app/surveys/new/{protocol.at_uri.split('/').at(-1)}">
      Start Survey
    </Button>
  </div>

  <Card.Root class="mb-6">
    <Card.Header>
      <Card.Title>{protocol.title}</Card.Title>
      <Card.Description>{protocol.description}</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-2 text-sm">
      <div>
        <span class="text-muted-foreground font-medium">AT URI:</span>
        <span class="ml-2 font-mono">{protocol.at_uri}</span>
      </div>
      {#if protocol.created_at}
        <div>
          <span class="text-muted-foreground font-medium">Created:</span>
          <span class="ml-2">{formatDate(protocol.created_at)}</span>
        </div>
      {/if}
      {#if protocol.required_fields.length > 0}
        <div>
          <span class="text-muted-foreground font-medium">Required fields:</span>
          <ul class="ml-4 mt-1 list-disc">
            {#each protocol.required_fields as field}
              <li>{field}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <h2 class="mb-3 text-lg font-semibold">Targets ({targets.length})</h2>

  {#if targets.length === 0}
    <p class="text-muted-foreground text-sm">No targets.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each targets as target (target.at_uri)}
        <li>
          <Card.Root>
            <Card.Content class="space-y-2 pt-4 text-sm">
              <div>
                <span class="text-muted-foreground font-medium">AT URI:</span>
                <span class="ml-2 font-mono">{target.at_uri}</span>
              </div>
              <div>
                <span class="text-muted-foreground font-medium">Scope:</span>
                <pre
                  class="bg-muted mt-1 overflow-auto rounded p-2 text-xs"
                >{JSON.stringify(target.scope, null, 2)}</pre>
              </div>
            </Card.Content>
          </Card.Root>
        </li>
      {/each}
    </ul>
  {/if}
</main>
