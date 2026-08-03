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
import SparkbarDialog from '$lib/components/SparkbarDialog.svelte';
import SparkbarInfo from '$lib/components/SparkbarInfo.svelte';
import SurveyCard from '$lib/components/SurveyCard.svelte';
import * as Alert from '$lib/components/ui/alert';
import ButtonGroup from '$lib/components/ui/button-group/button-group.svelte';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import * as Tabs from '$lib/components/ui/tabs';
import type { Main as LocationAddress } from '$lib/lexicons/community/lexicon/location/address.defs';
import type { Main as LocationBbox } from '$lib/lexicons/community/lexicon/location/bbox.defs';
import type { Main as LocationGeo } from '$lib/lexicons/community/lexicon/location/geo.defs';
import type {
  Protocol,
  Target,
  TaxonScope,
  VerbatimScope,
} from '$lib/offline/db';
import { LOCATION_COMBOBOX_THRESHOLD } from '$lib/places';
import { install } from '$lib/pwa/install.svelte';
import { sanitizeHtml } from '$lib/sanitize';
import type { ProtocolActivity } from '$lib/server/db/protocol-activity';
import type { FollowerPreview } from '$lib/server/db/protocol-follows';
import { seriesMax } from '$lib/sparkbar';
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
  // Undefined until the network fetch resolves on the offline-first /app
  // route, and forever when that route is serving a cached protocol with no
  // connection — the count is never cached or guessed, only ever this page
  // load's own live value. Same shape as `activity` below.
  followerCount?: number;
  // Survey counts and recent surveys for this protocol. Undefined until the
  // network fetch resolves on the offline-first /app route, and forever when
  // that route is serving a cached protocol with no connection. Those two
  // cases look alike here, so `activityPending` is what tells them apart.
  activity?: ProtocolActivity;
  activityPending?: boolean;
  // The most-recent few followers (excluding the viewer), for the
  // "Followed by …" line. Same undefined-while-pending shape as followerCount.
  followerPreview?: FollowerPreview[];
  isFollowing?: boolean;
  isOffline?: boolean;
  isOwner?: boolean;
  isSignedIn?: boolean;
  onAfterFollowChange?: (isFollowing: boolean, protocol: Protocol) => void;
}

let {
  protocol,
  followerCount: initialFollowerCount,
  activity,
  activityPending = false,
  followerPreview,
  isFollowing: initialIsFollowing,
  isOffline,
  isOwner = false,
  isSignedIn = false,
  onAfterFollowChange = () => {},
}: Props = $props();

// svelte-ignore state_referenced_locally -- intentional: local optimistic state
let isFollowing = $state(!!initialIsFollowing);
// svelte-ignore state_referenced_locally -- intentional: local optimistic state
let followerCount = $state(initialFollowerCount);
let showAllPlaces = $state(false);
let authIssue = $state<'expired' | 'permission' | null>(null);

// Picks up the real count once the parent route's streamed fetch resolves.
// Guarded on followerCount still being undefined so a follow/unfollow click
// that lands first (setting an optimistic number) never gets clobbered by a
// late-arriving fetch.
$effect(() => {
  if (followerCount === undefined && initialFollowerCount !== undefined) {
    followerCount = initialFollowerCount;
  }
});

// svelte-ignore state_referenced_locally -- intentional: derived once from the prop this component was mounted with
const returnTo = `/app/protocols/${protocol.handle}/${protocol.rkey}`;

const surveysLabel = $derived(
  activity ? `Surveys (${activity.surveyCount})` : 'Surveys',
);

// One ceiling for every sparkbar in the Targets tab, so bar heights compare
// across targets rather than each row scaling to its own peak.
const targetSparkbarMax = $derived(seriesMax(activity?.targetWeekly));

// The target cell stacks its scopes with AND between them; the chart dialog
// needs the same identity as a single line of text.
function targetTitle(target: Target): string {
  const parts = target.record.scope
    .map((scope) => {
      if (scope.$type?.endsWith('taxonScope')) {
        return (scope as TaxonScope).scientificName;
      }
      if (scope.$type?.endsWith('verbatimScope')) {
        return (scope as VerbatimScope).verbatimTargetScope;
      }
      return null;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' AND ') : 'Target';
}

// Only a target with exactly one taxonomic scope names a single taxon. One
// scope out of several describes a criterion, not the subject, so those keep
// the composed AND title instead.
function soleTaxonScope(target: Target): TaxonScope | undefined {
  if (target.record.scope.length !== 1) return undefined;
  const [scope] = target.record.scope;
  if (!scope?.$type?.endsWith('taxonScope')) return undefined;
  return scope as TaxonScope;
}

// Null (falls back to a plain follower count) until we have both a live count
// and at least one other follower to name. `followerPreview` already
// excludes the viewer, so it stays put across the viewer's own
// follow/unfollow; only the "+ N more" tail shifts, driven by backing the
// viewer out of followerCount. Text is assembled into styled parts here so
// no layout whitespace leaks between the bold handles and their separators.
const followedBy = $derived.by(() => {
  if (
    followerCount === undefined ||
    !followerPreview ||
    followerPreview.length === 0
  ) {
    return null;
  }
  const named = followerPreview.slice(0, 2);
  const otherCount = Math.max(
    followerPreview.length,
    followerCount - (isFollowing ? 1 : 0),
  );
  const extra = otherCount - named.length;
  const parts: { text: string; bold: boolean }[] = [
    { text: 'Followed by ', bold: false },
  ];
  named.forEach((follower, idx) => {
    if (idx > 0) parts.push({ text: ', ', bold: false });
    parts.push({ text: follower.handle, bold: true });
  });
  if (extra > 0) parts.push({ text: ` + ${extra} more`, bold: false });
  return { avatars: followerPreview.slice(0, 3), parts };
});

// Distinguishes a dead session from a live one that's simply missing a scope
// this action needs, since the two need different explanations: "sign in
// again" reads as untrue when the token still works fine for everything else.
function authIssueFromBody(body: {
  sessionExpired?: boolean;
  permissionRequired?: boolean;
}): 'expired' | 'permission' | null {
  if (body?.permissionRequired) return 'permission';
  if (body?.sessionExpired) return 'expired';
  return null;
}

// Follow/unfollow go through /api rather than a form action so that /app can be
// built statically — adapter-static rejects +page.server.ts. See
// docs/2026-07-20-capacitor-phase-1-static-spa.md.
//
// The optimistic update is applied before the request and rolled back on
// failure, matching what the enhanced form did. `protocol` is captured
// synchronously up front because it is a reactive prop: by the time the request
// resolves the user may have navigated to another protocol reusing this same
// component, and the cache write in onAfterFollowChange must refer to the one
// they actually clicked.
let followPending = $state(false);

async function setFollowing(next: boolean) {
  if (followPending) return;
  followPending = true;

  const ogFollowerCount = followerCount ?? 0;
  const clicked = next
    ? withLastSurveyAt(protocol, activity?.lastSurveyByTargetUri)
    : protocol;

  isFollowing = next;
  followerCount = next ? ogFollowerCount + 1 : Math.max(0, ogFollowerCount - 1);

  try {
    const res = await fetch(
      `/api/protocols/${clicked.handle}/${clicked.rkey}/follow`,
      { method: next ? 'POST' : 'DELETE' },
    );
    if (res.ok) {
      authIssue = null;
      onAfterFollowChange(next, clicked);
      // Nudge the user to install the PWA after they commit to a protocol
      // (suppressed if not applicable or already dismissed).
      if (next) install.maybeAutoPrompt();
    } else {
      isFollowing = !next;
      followerCount = ogFollowerCount;
      authIssue = authIssueFromBody(await res.json().catch(() => ({})));
    }
  } catch {
    // Network failure: roll back rather than leave the button lying.
    isFollowing = !next;
    followerCount = ogFollowerCount;
  } finally {
    followPending = false;
  }
}

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
        <!-- The primary call to action swaps with follow state: an unfollowed
             visitor is nudged to follow first, so Start Survey drops to an
             outline; once following, starting a survey becomes the CTA. -->
        <Button
          href="/app/surveys/new/{protocol.rkey}"
          title="Start a field survey now"
          variant={isFollowing ? 'default' : 'outline'}
          class={isFollowing ? 'border-1 border-primary' : ''}
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
  <Handle handle={protocol.handle} avatarUrl={protocol.avatarUrl} />
  {@html sanitizeHtml(protocol.record.description ?? '')}

  <div class="mt-2 flex flex-col items-start gap-3">
    {#if isOffline}
      <span class="text-muted-foreground text-xs">(follow requires connection)</span>
    {:else if isSignedIn}
      {#if isFollowing}
        <Button
          variant="outline"
          disabled={followPending}
          onclick={() => setFollowing(false)}
        >
          <MinusIcon />
          Unfollow
        </Button>
      {:else}
        <Button disabled={followPending} onclick={() => setFollowing(true)}>
          <PlusIcon />
          Follow this protocol
        </Button>
      {/if}
    {/if}
    {#if followedBy}
      <div class="flex items-center gap-2">
        <div class="flex -space-x-2">
          {#each followedBy.avatars as follower (follower.handle)}
            {#if follower.avatarUrl}
              <img
                src={follower.avatarUrl}
                alt=""
                class="ring-background size-8 rounded-full object-cover ring-2"
                aria-hidden="true"
              />
            {:else}
              <div
                class="ring-background bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full text-xs font-medium uppercase ring-2"
                aria-hidden="true"
              >
                {follower.handle.slice(0, 1)}
              </div>
            {/if}
          {/each}
        </div>
        <span class="text-muted-foreground text-sm"
          >{#each followedBy.parts as part}{#if part.bold}<span
                class="text-foreground font-medium">{part.text}</span
              >{:else}{part.text}{/if}{/each}</span
        >
      </div>
    {:else if followerCount !== undefined && !isFollowing}
      <!-- No one else to name (the preview excludes the viewer). Skip the plain
           count when the viewer is following, since here that means they are the
           lone follower and "1 follower" pointing at themselves reads as dead
           space; a genuine "0 followers" (not following) still shows. -->
      <span class="text-muted-foreground text-sm">
        {followerCount}
        {followerCount === 1 ? 'follower' : 'followers'}
      </span>
    {/if}
  </div>

  {#if authIssue === 'permission'}
    <Alert.Root class="border-yellow-500 bg-yellow-50 dark:bg-yellow-950 my-2">
      <Alert.Title>Additional permission needed</Alert.Title>
      <Alert.Description>
        Cuanto needs an additional permission to follow protocols. Sign in
        again to grant it.
        <a
          href={`/auth/signin?returnTo=${encodeURIComponent(returnTo)}`}
          class="underline font-medium ml-1"
        >
          Sign in
        </a>
      </Alert.Description>
    </Alert.Root>
  {:else if authIssue === 'expired'}
    <Alert.Root class="border-yellow-500 bg-yellow-50 dark:bg-yellow-950 my-2">
      <Alert.Title>Session expired</Alert.Title>
      <Alert.Description>
        Your session has expired. Sign in again to continue.
        <a
          href={`/auth/signin?returnTo=${encodeURIComponent(returnTo)}`}
          class="underline font-medium ml-1"
        >
          Sign in
        </a>
      </Alert.Description>
    </Alert.Root>
  {/if}

  <Tabs.Root value="surveys" class="mt-6">
    <Tabs.List variant="line">
      <Tabs.Trigger value="surveys">{surveysLabel}</Tabs.Trigger>
      <Tabs.Trigger value="targets">Targets ({protocol.targets.length})</Tabs.Trigger>
      <Tabs.Trigger value="details">Details</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="surveys" class="mt-4">
      {#if activityPending}
        <p class="text-muted-foreground text-sm">Loading surveys…</p>
      {:else if !activity}
        <p class="text-muted-foreground text-sm">
          {isOffline
            ? 'Surveys are unavailable offline.'
            : 'Surveys could not be loaded.'}
        </p>
      {:else if activity.recentSurveys.length === 0}
        <p class="text-muted-foreground text-sm">No surveys yet.</p>
      {:else}
        <div class="flex flex-col gap-5">
          <ul class="flex flex-col gap-3">
            {#each activity.recentSurveys as survey (survey.atUri)}
              <li>
                <a href="/surveys/{survey.handle}/{survey.rkey}">
                  <SurveyCard {survey} />
                </a>
              </li>
            {/each}
          </ul>
          {#if activity.surveyCount > activity.recentSurveys.length}
            <Button
              variant="ghost"
              class="w-full mb-5"
              href={`/surveys?protocols=${protocol.atUri}`}
            >
              View all surveys
            </Button>
          {/if}
        </div>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="targets" class="mt-4">
      {#if protocol.targets.length === 0}
        <p class="text-muted-foreground">No targets.</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Target</Table.Head>
              <Table.Head class="whitespace-nowrap">
                Trend
                <SparkbarInfo scope="target" />
              </Table.Head>
              <Table.Head class="text-right">Surveys</Table.Head>
              <Table.Head class="text-right">Count</Table.Head>
              <Table.Head>Last Survey</Table.Head>
              <Table.Head>Type</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each protocol.targets as target (target.atUri)}
              {@const lastSurvey = activity?.lastSurveyByTargetUri?.[target.atUri]}
              {@const stat = activity?.targetStats[target.atUri]}
              {@const weekly = activity?.targetWeekly?.[target.atUri]}
              <Table.Row>
                <!-- A target absent from targetWeekly was never in scope for a
                     survey in the window, which is not the same as a run of
                     zeros, so show nothing rather than a flat line. -->
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
                  {#if weekly}
                    <SparkbarDialog
                      points={weekly}
                      max={targetSparkbarMax}
                      title={targetTitle(target)}
                      taxon={soleTaxonScope(target)}
                      scope="target"
                    />
                  {:else}
                    <span class="text-muted-foreground">—</span>
                  {/if}
                </Table.Cell>
                <!-- A target absent from targetStats has simply never been
                     counted; only a missing `activity` means "not loaded". -->
                <Table.Cell class="text-right">
                  {activity ? (stat?.surveyCount ?? 0) : '—'}
                </Table.Cell>
                <Table.Cell class="text-right">
                  {activity ? (stat?.totalCount ?? 0) : '—'}
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
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="details" class="mt-4">
      <Table.Root>
        <Table.Body>
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
    </Tabs.Content>
  </Tabs.Root>
</main>
