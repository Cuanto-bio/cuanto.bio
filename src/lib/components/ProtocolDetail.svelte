<script lang="ts">
import MinusIcon from '@lucide/svelte/icons/minus';
import PlusIcon from '@lucide/svelte/icons/plus';
import { enhance } from '$app/forms';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import type { Protocol, TaxonScope, VerbatimScope } from '$lib/offline/db';
import * as Table from './ui/table';

interface Props {
  protocol: Protocol;
  followerCount: number;
  isFollowing?: boolean;
  canFollow?: boolean;
  offline?: boolean;
  onAfterFollowChange?: () => void;
}

let {
  protocol,
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
      {#if canFollow}
        {#if isFollowing}
          <form
            method="POST"
            action="?/unfollow"
            use:enhance={() => {
              const ogFollowerCount = followerCount;
              isFollowing = false;
              followerCount = Math.max(0, followerCount - 1);
              return ({ result }) => {
                if (result.type === 'success') {
                  isFollowing = false;
                  followerCount = Math.max(0, ogFollowerCount - 1);
                  onAfterFollowChange();
                } else{
                  isFollowing = true;
                  followerCount = ogFollowerCount;
                }
              };
            }}
          >
            <Button type="submit" variant="outline">
              <MinusIcon />
              Unfollow
            </Button>
          </form>
        {:else}
          <form
            method="POST"
            action="?/follow"
            use:enhance={() => {
              const ogFollowerCount = followerCount;
              isFollowing = true;
              followerCount += 1;
              return ({ result }) => {
                if (result.type === 'success') {
                  isFollowing = true;
                  followerCount = ogFollowerCount + 1;
                  onAfterFollowChange();
                } else {
                  isFollowing = false;
                  followerCount = ogFollowerCount;
                }
              };
            }}
          >
            <Button type="submit" variant="outline">
              <PlusIcon />
              Follow this protocol
            </Button>
          </form>
        {/if}
      {:else if offline}
        <span class="text-muted-foreground text-xs">(follow requires connection)</span>
      {/if}
      <span class="text-muted-foreground text-sm">
        {followerCount}
        {followerCount === 1 ? 'follower' : 'followers'}
      </span>
    </div>
    <Button href="/app/surveys/new/{protocol.atUri.split('/').at(-1)}">
      Start Survey
    </Button>
  </div>

  <div class="text-muted-foreground text-xs mb-1">PROTOCOL</div>
  <h1>{protocol.record.title}</h1>
  <p>{protocol.record.description}</p>

  <Table.Root class="my-2">
    <Table.Body>
      <Table.Row>
        <Table.Head>Author</Table.Head>
        <Table.Cell>@{protocol.handle}</Table.Cell>
      </Table.Row>
      <Table.Row>
        <Table.Head>Created</Table.Head>
        <Table.Cell>{formatDate(protocol.record.createdAt)}</Table.Cell>
      </Table.Row>
      <Table.Row>
        <Table.Head>Required Fields</Table.Head>
        <Table.Cell>
          {#if protocol.record.requiredFields && protocol.record.requiredFields.length > 0}
            <ul class="ml-4 mt-1 list-disc">
              {#each protocol.record.requiredFields as field}
                <li>{field}</li>
              {/each}
            </ul>
          {:else}
            No required fields
          {/if}
        </Table.Cell>
      </Table.Row>
    </Table.Body>
  </Table.Root>

  <h2 class="mb-3 text-lg font-semibold">Targets ({protocol.targets.length})</h2>

  {#if protocol.targets.length === 0}
    <p class="text-muted-foreground">No targets.</p>
  {:else}
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Type</Table.Head>
          <Table.Head>Target</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each protocol.targets as target (target.atUri)}
          <Table.Row>
            <Table.Cell>
              {#if target.record.scope.length === 1}
                {#if target.record.scope[0].$type?.endsWith('taxonScope')}
                  Taxonomic
                {:else if target.record.scope[0].$type?.endsWith('verbatimScope')}
                  Verbatim
                {/if}
              {:else}
                Multiple
              {/if}
            </Table.Cell>
            <Table.Cell>
              {#each target.record.scope as scope, idx}
                {#if idx > 0}
                  <p>AND</p>
                {/if}
                <div>
                  {#if scope.$type?.endsWith('taxonScope')}
                    {(scope as TaxonScope).taxonRank}
                    {#if ['genus', 'species', 'subspecies', 'variety', 'infraspecies'].includes((scope as TaxonScope).taxonRank)}
                      <i>{(scope as TaxonScope).scientificName}</i>
                    {:else}
                      {(scope as TaxonScope).scientificName}
                    {/if}
                  {:else if scope.$type?.endsWith('verbatimScope')}
                    {(scope as VerbatimScope).verbatimTargetScope}
                  {/if}
                </div>
              {/each}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/if}
</main>
