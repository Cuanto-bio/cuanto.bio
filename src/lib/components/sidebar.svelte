<script lang="ts">
import BookmarkIcon from '@lucide/svelte/icons/bookmark';
import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
import CodeIcon from '@lucide/svelte/icons/code';
import InfoIcon from '@lucide/svelte/icons/info';
import ListChecksIcon from '@lucide/svelte/icons/list-checks';
import LogInIcon from '@lucide/svelte/icons/log-in';
import LogOutIcon from '@lucide/svelte/icons/log-out';
import MessageSquarePlusIcon from '@lucide/svelte/icons/message-square-plus';
import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
import { signInPath } from '$lib/auth/signin';
import Handle from '$lib/components/handle.svelte';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '$lib/components/ui/sidebar';
import Wordmark from '$lib/components/wordmark.svelte';
import { useOnline } from '$lib/composables/online.svelte';
import { signOut } from '$lib/offline/auth';

const sidebar = useSidebar();
afterNavigate(() => sidebar.setOpenMobile(false));

let {
  did,
  handle,
  avatarUrl,
}: { did?: string; handle?: string; avatarUrl?: string } = $props();

const online = useOnline();

type SwInfo = {
  controlled: boolean;
  state: string;
  shellCached: boolean;
  shellAssetCount: number;
  appDataCount: number;
};
let serviceWorkerInfo = $state<SwInfo | null>(null);

async function refreshServiceWorkerInfo() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const worker = reg?.active ?? reg?.installing ?? reg?.waiting ?? null;
  const cacheNames = await caches.keys();

  // The SW stores assets in a versioned shell-* cache.
  const shellName = cacheNames.find((n) => n.startsWith('shell-')) ?? '';
  let shellCached = false;
  let shellAssetCount = 0;
  if (shellName) {
    const shellCache = await caches.open(shellName);
    const keys = await shellCache.keys();
    shellAssetCount = keys.length;
    shellCached = !!(await shellCache.match('/app/'));
  }

  let appDataCount = 0;
  const publicCacheName = cacheNames.find((n) => n === 'public-pages') ?? '';
  if (publicCacheName) {
    const dataCache = await caches.open(publicCacheName);
    appDataCount = (await dataCache.keys()).length;
  }

  serviceWorkerInfo = {
    controlled: !!navigator.serviceWorker.controller,
    state: worker?.state ?? 'none',
    shellCached,
    shellAssetCount,
    appDataCount,
  };
}

onMount(() => {
  refreshServiceWorkerInfo();
  navigator.serviceWorker?.addEventListener(
    'controllerchange',
    refreshServiceWorkerInfo,
  );
});
</script>

<Sidebar>
  <SidebarHeader>
    <a href="/" class="wordmark home-link"><Wordmark /></a>
  </SidebarHeader>
  <SidebarContent>
    <SidebarGroup>
      <SidebarGroupLabel>Everyone</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href='/surveys' {...props}>
                  <ClipboardListIcon size={24} />
                  Surveys
                </a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href='/protocols' {...props}>
                  <ListChecksIcon size={24} />
                  Protocols
                </a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href='/stats' {...props}>
                  <ChartColumnIcon size={24} />
                  Stats
                </a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    {#if did}
      <SidebarGroup>
        <SidebarGroupLabel>You</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                {#snippet child({ props })}
                  <a href="/app/surveys" {...props}>
                    <ClipboardListIcon />
                    Your Surveys
                  </a>
                {/snippet}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton>
                {#snippet child({ props })}
                  <a href="/app/protocols/following" {...props}>
                    <BookmarkIcon />
                    Followed Protocols
                  </a>
                {/snippet}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    {/if}
    <SidebarGroup>
      <SidebarGroupLabel>Errata</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href="/about" {...props}>
                  <InfoIcon size={24} />
                  About
                </a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href="https://userinput.app/#/s/did:plc:dd7efi6wormdpmcyscnkjc6n/3mquh7nnpd22t" {...props}>
                  <MessageSquarePlusIcon size={24} />
                  Feedback
                </a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href="https://tangled.org/cuanto.bio/cuanto.bio" {...props}>
                  <CodeIcon size={24} />
                  Code
                </a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  </SidebarContent>

  <SidebarFooter>
    <div class="text-muted-foreground border-t space-y-0.5 px-2 pt-2 font-mono text-xs hidden">
      <div>net: {online.value ? 'online' : 'offline'}</div>
      {#if serviceWorkerInfo}
        <div>sw: {serviceWorkerInfo.state}{serviceWorkerInfo.controlled ? ' ✓' : ' (no ctrl)'}</div>
        <div>shell: {serviceWorkerInfo.shellCached ? '✓' : '✗'} ({serviceWorkerInfo.shellAssetCount} assets)</div>
        <div>data cache: {serviceWorkerInfo.appDataCount}</div>
      {:else}
        <div>sw: checking…</div>
      {/if}
      <button onclick={refreshServiceWorkerInfo} class="underline">refresh</button>
    </div>
    {#if handle}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>
            <a href="/app/account" class="flex gap-1.5 items-center">
              <img src={avatarUrl} alt="" class="h-4 w-4 rounded-full object-cover" aria-hidden="true" />
              <Handle {handle} />
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {#if online.value}
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <button onclick={signOut} {...props}>
                  <LogOutIcon />
                  Sign out
                </button>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
        {/if}
      </SidebarMenu>
    {:else if online.value}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>
            {#snippet child({ props })}
              <a href={signInPath()} {...props}>
                <LogInIcon />
                Sign in
              </a>
            {/snippet}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    {/if}
  </SidebarFooter>
</Sidebar>

<style>
  .home-link {
    display: block;
    font-size: 1.05rem;
    letter-spacing: -0.01em;
    text-decoration: none;
    transition: opacity 0.15s ease;
  }

  .home-link:hover {
    opacity: 0.75;
  }
</style>
