<script lang="ts">
import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
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

async function signOut() {
  const { clearIdbUser } = await import('$lib/offline/db');
  await clearIdbUser();
  window.location.href = '/auth/signout';
}
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
                <a href='/protocols' {...props}>All Protocols</a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href='/surveys' {...props}>All Surveys</a>
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
                  <a href="/app/surveys" {...props}>Completed Surveys</a>
                {/snippet}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton>
                {#snippet child({ props })}
                  <a href="/app/surveys/pending" {...props}>Pending Surveys</a>
                {/snippet}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton>
                {#snippet child({ props })}
                  <a href="/app/protocols/following" {...props}>Followed Protocols</a>
                {/snippet}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    {/if}
  </SidebarContent>

  <SidebarFooter>
    <div class="text-muted-foreground border-t space-y-0.5 px-2 pt-2 font-mono text-xs">
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
      <p class="text-muted-foreground px-2 text-xs font-bold"><Handle {handle} {avatarUrl} /></p>
      <SidebarMenu>
        {#if online.value}
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <button onclick={signOut} {...props}>Sign out</button>
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
              <a href="/auth/signin" {...props}>Sign in</a>
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
