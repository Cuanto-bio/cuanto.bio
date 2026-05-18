<script lang="ts">
import ClipboardClockIcon from '@lucide/svelte/icons/clipboard-clock';
import ClipboardPlusIcon from '@lucide/svelte/icons/clipboard-plus';
import MinusIcon from '@lucide/svelte/icons/minus';
import PencilIcon from '@lucide/svelte/icons/pencil';
import PlusIcon from '@lucide/svelte/icons/plus';
import Button from '$lib/components/Button.svelte';
import Form from '$lib/components/Form.svelte';
import type { Main as LocationAddress } from '$lib/lexicons/community/lexicon/location/address.defs';
import type { Main as LocationBbox } from '$lib/lexicons/community/lexicon/location/bbox.defs';
import type { Main as LocationGeo } from '$lib/lexicons/community/lexicon/location/geo.defs';
import type { Protocol, TaxonScope, VerbatimScope } from '$lib/offline/db';
import { LOCATION_COMBOBOX_THRESHOLD } from '$lib/places';
import { sanitizeHtml } from '$lib/sanitize';
import Handle from './handle.svelte';
import Taxon from './Taxon.svelte';
import * as Table from './ui/table';

interface Props {
  protocol: Protocol;
  followerCount: number;
  isFollowing?: boolean;
  canFollow?: boolean;
  offline?: boolean;
  isOwner?: boolean;
  onAfterFollowChange?: () => void;
}

let {
  protocol,
  followerCount: initialFollowerCount,
  isFollowing: initialIsFollowing,
  canFollow,
  offline = false,
  isOwner = false,
  onAfterFollowChange = () => {},
}: Props = $props();

// svelte-ignore state_referenced_locally -- intentional: local optimistic state
let isFollowing = $state(!!initialIsFollowing);
// svelte-ignore state_referenced_locally -- intentional: local optimistic state
let followerCount = $state(initialFollowerCount);
let showAllPlaces = $state(false);

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}
</script>

<main class="mx-auto max-w-2xl px-4 pb-8">
  <div class="mb-6 flex items-center justify-between">
    <div class="flex items-center justify-between gap-2 w-full">
      {#if isOwner}
        <Button
          href="/protocols/{protocol.handle}/{protocol.rkey}/edit"
          variant="outline"
        >
          <PencilIcon />
          Edit
        </Button>
      {/if}
      <div class="flex gap-2">
        <Button
          href="/app/surveys/new/{protocol.atUri.split('/').at(-1)}?past=1"
          variant="outline"
          title="Enter past survey data"
        >
          <ClipboardPlusIcon />
          <span class="sm:hidden">Add</span>
          <span class="hidden sm:inline">Add Past Survey</span>
        </Button>
        <Button
          href="/app/surveys/new/{protocol.atUri.split('/').at(-1)}"
          title="Start a field survey now"
        >
          <ClipboardClockIcon />
          <span class="sm:hidden">Start</span>
          <span class="hidden sm:inline">Start Survey</span>
        </Button>
      </div>
    </div>
  </div>

  <div class="text-muted-foreground text-xs mb-1">PROTOCOL</div>
  <h1>{protocol.record.title}</h1>
  {@html sanitizeHtml(protocol.record.description ?? '')}

  <div class="flex items-center gap-3">
    {#if canFollow}
      {#if isFollowing}
        <Form
          method="POST"
          action="?/unfollow"
          onEnhance={() => {
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
        </Form>
      {:else}
        <Form
          method="POST"
          action="?/follow"
          onEnhance={() => {
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
        </Form>
      {/if}
    {:else if offline}
      <span class="text-muted-foreground text-xs">(follow requires connection)</span>
    {/if}
    <span class="text-muted-foreground text-sm">
      {followerCount}
      {followerCount === 1 ? 'follower' : 'followers'}
    </span>
  </div>

  <Table.Root class="my-2">
    <Table.Body>
      <Table.Row>
        <Table.Head>Author</Table.Head>
        <Table.Cell><Handle handle={protocol.handle} avatarUrl={protocol.avatarUrl} /></Table.Cell>
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
                    <Taxon taxon={scope as TaxonScope} />
                  {:else if scope.$type?.endsWith('verbatimScope')}
                    {@const verbatim = scope as VerbatimScope}
                    {verbatim.verbatimTargetScope}
                  {/if}
                </div>
              {/each}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/if}

  {#if protocol.record.locationOptions && protocol.record.locationOptions.length > 0}
    <h2 class="mb-3 mt-6 text-lg font-semibold">
      Place Options ({protocol.record.locationOptions.length})
    </h2>
    {@const visiblePlaces = showAllPlaces
      ? protocol.record.locationOptions
      : protocol.record.locationOptions.slice(0, LOCATION_COMBOBOX_THRESHOLD)}
    <ul class="ml-4 list-disc">
      {#each visiblePlaces as place}
        <li>
          <span class="font-medium">{place.name}</span>
          {#if place.locations}
            {#each place.locations as loc}
              {#if loc.$type === 'community.lexicon.location.geo'}
                <span class="text-muted-foreground ml-1 text-sm">
                  ({(loc as LocationGeo).latitude}, {(loc as LocationGeo).longitude})
                </span>
              {:else if loc.$type === 'community.lexicon.location.address'}
                <span class="text-muted-foreground ml-1 text-sm">
                  {[
                    (loc as LocationAddress).street,
                    (loc as LocationAddress).locality,
                    (loc as LocationAddress).region,
                    (loc as LocationAddress).postalCode,
                    (loc as LocationAddress).country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              {:else if loc.$type === 'community.lexicon.location.bbox'}
                <span class="text-muted-foreground ml-1 text-sm">
                  (N {(loc as LocationBbox).north}, S {(loc as LocationBbox).south},
                  E {(loc as LocationBbox).east}, W {(loc as LocationBbox).west})
                </span>
              {/if}
            {/each}
          {/if}
        </li>
      {/each}
    </ul>
    {#if protocol.record.locationOptions.length > LOCATION_COMBOBOX_THRESHOLD}
      <Button
        variant="ghost"
        size="sm"
        class="mt-2"
        onclick={() => (showAllPlaces = !showAllPlaces)}
      >
        {showAllPlaces
          ? 'Show less'
          : `${protocol.record.locationOptions.length - LOCATION_COMBOBOX_THRESHOLD} more…`}
      </Button>
    {/if}
  {/if}
</main>
