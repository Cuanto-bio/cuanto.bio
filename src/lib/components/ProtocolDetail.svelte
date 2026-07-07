<script lang="ts">
import ChartBarIcon from '@lucide/svelte/icons/chart-bar';
import ClipboardClockIcon from '@lucide/svelte/icons/clipboard-clock';
import ClipboardPlusIcon from '@lucide/svelte/icons/clipboard-plus';
import DownloadIcon from '@lucide/svelte/icons/download';
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import MinusIcon from '@lucide/svelte/icons/minus';
import PencilIcon from '@lucide/svelte/icons/pencil';
import PlusIcon from '@lucide/svelte/icons/plus';
import type { Component } from 'svelte';
import Button from '$lib/components/Button.svelte';
import Form from '$lib/components/Form.svelte';
import ButtonGroup from '$lib/components/ui/button-group/button-group.svelte';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import type { Main as LocationAddress } from '$lib/lexicons/community/lexicon/location/address.defs';
import type { Main as LocationBbox } from '$lib/lexicons/community/lexicon/location/bbox.defs';
import type { Main as LocationGeo } from '$lib/lexicons/community/lexicon/location/geo.defs';
import type { Protocol, TaxonScope, VerbatimScope } from '$lib/offline/db';
import { LOCATION_COMBOBOX_THRESHOLD } from '$lib/places';
import { install } from '$lib/pwa/install.svelte';
import { sanitizeHtml } from '$lib/sanitize';
import Handle from './handle.svelte';
import Taxon from './Taxon.svelte';
import * as Table from './ui/table';

interface ActionItem {
  href: string;
  label: string;
  title: string;
  icon: Component;
}

interface Props {
  protocol: Protocol;
  followerCount: number;
  isFollowing?: boolean;
  isOffline?: boolean;
  isOwner?: boolean;
  isSignedIn?: boolean;
  lastSurveyByTargetUri?: Record<
    string,
    { date: string; handle: string; rkey: string }
  >;
  onAfterFollowChange?: (isFollowing: boolean, protocol: Protocol) => void;
}

let {
  protocol,
  followerCount: initialFollowerCount,
  isFollowing: initialIsFollowing,
  isOffline,
  isOwner = false,
  isSignedIn = false,
  lastSurveyByTargetUri,
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

function formatSurveyDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

// Folds this protocol's per-target last-survey dates (already loaded for the
// "Last Survey" column) into a single protocol-level lastSurveyAt, so a
// caller that snapshots `protocol` for offline caching doesn't have to make a
// second server round trip just to get it.
function withLastSurveyAt(
  p: Protocol,
  lastSurveyMap?: Record<string, { date: string }>,
): Protocol {
  const dates = Object.values(lastSurveyMap ?? {}).map((v) => v.date);
  if (dates.length === 0) return p;
  return { ...p, lastSurveyAt: dates.reduce((max, d) => (d > max ? d : max)) };
}

// Edit/Export collapse into a kebab menu on narrow screens. Stats is kept out
// of this list since it's the only action ever shown to signed-out visitors
// on the public (SSR, no-JS-friendly) protocol page.
const collapsibleActions = $derived.by(() => {
  const actions: (ActionItem | null)[] = [
    isSignedIn && isOwner
      ? {
          href: `/protocols/${protocol.handle}/${protocol.rkey}/edit`,
          label: 'Edit',
          title: 'Edit this protocol',
          icon: PencilIcon,
        }
      : null,
    isSignedIn
      ? {
          href: `/api/protocols/${protocol.handle}/${protocol.rkey}/export`,
          label: 'Export',
          title: 'Export as DarwinCore Data Package',
          icon: DownloadIcon,
        }
      : null,
  ];
  return actions.filter((action): action is ActionItem => action !== null);
});
</script>

<main>
  <div class="mb-6 flex items-center justify-between gap-2">
    {#if isSignedIn}
      <ButtonGroup>
        <Button
          href="/app/surveys/new/{protocol.rkey}?past=1"
          variant="outline"
          title="Enter past survey data"
        >
          <ClipboardPlusIcon />
          <span class="sm:hidden">Add</span>
          <span class="hidden sm:inline">Add Past Survey</span>
        </Button>
        <Button
          href="/app/surveys/new/{protocol.rkey}"
          title="Start a field survey now"
          class="border-1 border-primary"
        >
          <ClipboardClockIcon />
          <span class="sm:hidden">Start</span>
          <span class="hidden sm:inline">Start Survey</span>
        </Button>
      </ButtonGroup>
    {/if}
    <div class="flex items-center gap-2 ml-auto">
      <Button
        href="/stats?protocols={encodeURIComponent(protocol.atUri)}"
        variant="outline"
        title="View stats for this protocol"
      >
        <ChartBarIcon />
        Stats
      </Button>
      {#if collapsibleActions.length > 0}
        <div class="hidden items-center gap-2 sm:flex">
          {#each collapsibleActions as action (action.href)}
            {@const Icon = action.icon}
            <Button href={action.href} variant="outline" title={action.title}>
              <Icon />
              {action.label}
            </Button>
          {/each}
        </div>
        <div class="sm:hidden">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button variant="outline" size="icon" aria-label="More actions" {...props}>
                  <EllipsisVerticalIcon />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              {#each collapsibleActions as action (action.href)}
                {@const Icon = action.icon}
                <DropdownMenu.Item>
                  {#snippet child({ props })}
                    <a href={action.href} title={action.title} {...props}>
                      <Icon class="size-4" />
                      {action.label}
                    </a>
                  {/snippet}
                </DropdownMenu.Item>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      {/if}
    </div>
  </div>

  <div class="text-muted-foreground text-xs mb-1">PROTOCOL</div>
  <h1>{protocol.record.title}</h1>
  {@html sanitizeHtml(protocol.record.description ?? '')}

  <div class="flex items-center gap-3">
    {#if isOffline}
      <span class="text-muted-foreground text-xs">(follow requires connection)</span>
    {:else if isSignedIn}
      {#if isFollowing}
        <Form
          method="POST"
          action="?/unfollow"
          onEnhance={() => {
            const ogFollowerCount = followerCount;
            // Captured now, synchronously, before any await: `protocol` is a
            // reactive prop that can point at a different protocol by the
            // time this form's POST resolves, if the user has since
            // navigated to another protocol detail page reusing this same
            // route component.
            const unfollowedProtocol = protocol;
            isFollowing = false;
            followerCount = Math.max(0, followerCount - 1);
            return ({ result }) => {
              if (result.type === 'success') {
                isFollowing = false;
                followerCount = Math.max(0, ogFollowerCount - 1);
                onAfterFollowChange(false, unfollowedProtocol);
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
            // Captured now, synchronously, before any await: `protocol` is a
            // reactive prop that can point at a different protocol by the
            // time this form's POST resolves, if the user has since
            // navigated to another protocol detail page reusing this same
            // route component. lastSurveyByTargetUri is folded in here too,
            // for the same reason, so the cache write below has the best
            // available sort key instead of always looking "never surveyed".
            const followedProtocol = withLastSurveyAt(protocol, lastSurveyByTargetUri);
            isFollowing = true;
            followerCount += 1;
            return ({ result }) => {
              if (result.type === 'success') {
                isFollowing = true;
                followerCount = ogFollowerCount + 1;
                onAfterFollowChange(true, followedProtocol);
                // Nudge the user to install the PWA after they commit to a
                // protocol (suppressed if not applicable or already dismissed).
                install.maybeAutoPrompt();
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
          <Table.Head>Last Survey</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each protocol.targets as target (target.atUri)}
          {@const lastSurvey = lastSurveyByTargetUri?.[target.atUri]}
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
                <div class="text-wrap">
                  {#if scope.$type?.endsWith('taxonScope')}
                    <Taxon taxon={scope as TaxonScope} />
                  {:else if scope.$type?.endsWith('verbatimScope')}
                    {@const verbatim = scope as VerbatimScope}
                    {verbatim.verbatimTargetScope}
                  {/if}
                </div>
              {/each}
            </Table.Cell>
            <Table.Cell>
              {#if lastSurvey}
                <a
                  class="underline"
                  href="/surveys/{lastSurvey.handle}/{lastSurvey.rkey}"
                >
                  {formatSurveyDate(lastSurvey.date)}
                </a>
              {:else}
                —
              {/if}
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
