<script lang="ts">
import BookmarkIcon from '@lucide/svelte/icons/bookmark';
import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import MonitorDownIcon from '@lucide/svelte/icons/monitor-down';
import SquareArrowUpIcon from '@lucide/svelte/icons/square-arrow-up';
import SquarePlusIcon from '@lucide/svelte/icons/square-plus';
import type { Component } from 'svelte';
import type { BrowserFamily } from '$lib/pwa/detect';

let {
  family,
  showBookmarkAlt = false,
}: { family: BrowserFamily; showBookmarkAlt?: boolean } = $props();

interface Step {
  icon?: Component;
  text: string;
  // Emphasized steps are the "buried" ones (scroll / More / View More) where
  // users most often get stuck.
  emphasis?: boolean;
}

const flows: Record<BrowserFamily, Step[]> = {
  webkit: [
    {
      icon: SquareArrowUpIcon,
      text: 'Tap the Share button next to the address bar',
    },
    {
      text: 'Tap View More or look through the options',
      emphasis: true,
    },
    { icon: SquarePlusIcon, text: 'Tap Add to Home Screen' },
    { text: 'Add' },
  ],
  chromium: [
    {
      icon: EllipsisVerticalIcon,
      text: 'Open the browser menu next to the address bar',
    },
    {
      icon: MonitorDownIcon,
      text: 'Tap Add to Home screen',
    },
    { text: 'Install' },
  ],
  firefox: [
    {
      icon: EllipsisVerticalIcon,
      text: 'Open the browser menu next to the address bar',
    },
    { icon: EllipsisIcon, text: 'Tap More to expand the menu', emphasis: true },
    { icon: MonitorDownIcon, text: 'Tap Add app to Home screen' },
    { text: 'Install' },
  ],
  other: [
    { icon: SquareArrowUpIcon, text: 'Find the Share button or browser menu' },
    {
      icon: MonitorDownIcon,
      text: 'Tap "Add to Home screen". It may be under a More, View More, or Add to menu',
      emphasis: true,
    },
    { text: 'Install' },
  ],
};

const steps = $derived(flows[family]);
</script>

<ol class="space-y-3">
  {#each steps as step, i (i)}
    <li class="flex items-start gap-3">
      <span
        class="bg-muted text-muted-foreground flex size-6 shrink-0 items-center
          justify-center rounded-full text-xs font-bold"
      >
        {i + 1}
      </span>
      <span class="flex items-start gap-1.5 text-sm">
        {#if step.icon}
          {@const Icon = step.icon}
          <Icon size={18} class="text-muted-foreground shrink-0 mt-0.5" />
        {/if}
        <span class={step.emphasis ? 'font-medium' : undefined}>{step.text}</span>
      </span>
    </li>
  {/each}
</ol>

{#if showBookmarkAlt}
  <div class="text-muted-foreground flex items-center gap-1.5 pt-3 ps-1 text-xs">
    <BookmarkIcon size={14} class="shrink-0" />
    Or bookmark this page. It'll still work offline.
  </div>
{/if}
