<script lang="ts">
import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
import ExternalLink from '@lucide/svelte/icons/external-link';
import ListChecksIcon from '@lucide/svelte/icons/list-checks';
import Button from '$lib/components/Button.svelte';
import { Badge } from '$lib/components/ui/badge';
import * as Card from '$lib/components/ui/card';
import { useOnline } from '$lib/composables/online.svelte';
import { linkifySegments } from '$lib/linkify';

let { data } = $props();

const online = useOnline();

const bskyProfileUrl = $derived(
  `https://bsky.app/profile/${data.profileHandle}`,
);

// Stats Explorer accepts surveyedBy alone (no protocols needed), so there is
// nothing sensible to link to only when the user hasn't surveyed at all.
const statsHref = $derived(
  data.surveyCount > 0
    ? `/stats?${new URLSearchParams({ surveyedBy: data.profileDid })}`
    : null,
);
</script>

<svelte:head>
  <title>@{data.profileHandle}</title>
</svelte:head>

{#snippet links()}
  <div class="flex gap-4 ">
    <Button
      href="/protocols/{data.profileHandle}"
      variant="outline"
    >
      <span class="flex items-center gap-2">
        <ListChecksIcon size={18} />
        Protocols
      </span>
      <Badge variant="secondary">{data.protocolCount}</Badge>
    </Button>
    <Button
      href="/surveys/{data.profileHandle}"
      variant="outline"
    >
      <span class="flex items-center gap-2">
        <ClipboardListIcon size={18} />
        Surveys
      </span>
      <Badge variant="secondary">{data.surveyCount}</Badge>
    </Button>
    {#if statsHref}
      <Button
        href={statsHref}
        variant="outline"
      >
        <span class="flex items-center gap-2">
          <ChartColumnIcon size={18} />
          Stats
        </span>
      </Button>
    {/if}
  </div>
{/snippet}

<main class="flex flex-col">
  <div class="text-muted-foreground text-xs mb-2">PROFILE</div>
  {#if data.bskyProfile}
    <div class="flex items-start gap-4">
      {#if data.bskyProfile.avatar}
        <img
          src={data.bskyProfile.avatar}
          alt=""
          class="h-16 w-16 shrink-0 rounded-full object-cover"
        />
      {:else}
        <div class="bg-primary text-primary-foreground flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold">
          {data.profileHandle[0]?.toUpperCase() ?? '?'}
        </div>
      {/if}
      <div class="flex flex-col gap-1">
        <h1 class="flex items-center gap-2 text-lg font-bold mb-0">
          {data.bskyProfile.displayName ?? `@${data.profileHandle}`}
          <Badge
            variant="secondary"
            class="font-normal"
            href={bskyProfileUrl}
          >
            Bluesky
            <ExternalLink />
          </Badge>
        </h1>
        {#if data.bskyProfile.displayName}
          <div class="text-muted-foreground text-sm">@{data.profileHandle}</div>
        {/if}
        {#if data.bskyProfile.description}
          <p class="mt-1 text-sm whitespace-pre-wrap">
            {#each linkifySegments(data.bskyProfile.description) as segment, i (i)}
              {#if segment.type === 'link'}
                <a href={segment.url} target="_blank" rel="noopener noreferrer">{segment.text}</a>
              {:else}
                {segment.value}
              {/if}
            {/each}
          </p>
        {/if}

        {@render links()}
      </div>
    </div>
  {:else}
    <h1 class="text-2xl font-semibold">@{data.profileHandle}</h1>
    {#if !online.value}
      <p class="text-muted-foreground text-sm">
        Bluesky profile details will be available when online.
      </p>
    {/if}
    {@render links()}
  {/if}
</main>
