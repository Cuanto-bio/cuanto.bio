<script lang="ts">
import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
import { page } from '$app/state';
import { nav } from '$lib/navigation.svelte';
import './layout.css';
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import { Collapsible } from 'bits-ui';
import favicon from '$lib/assets/favicon.svg';
import MobileHeader from '$lib/components/mobile-header.svelte';
import MobileNav from '$lib/components/mobile-nav.svelte';
import AppSidebar from '$lib/components/sidebar.svelte';
import * as Alert from '$lib/components/ui/alert';
import { SidebarProvider, SidebarTrigger } from '$lib/components/ui/sidebar';
import { useOnline } from '$lib/composables/online.svelte';

let { children } = $props();

const online = useOnline();

// Record every client-side navigation so the mobile header can show a
// contextual back link. `from` is null on the initial page load (no previous
// route within the app), so we skip it — the stack starts empty.
// The server-side guard lives in navigation.svelte.ts; afterNavigate only
// fires in the browser, but the browser import is kept there for clarity.
afterNavigate(({ from, to }) => {
  if (from) nav.navigate(from.url?.href, to?.url?.href ?? '');
});

onMount(() => {
  if ('serviceWorker' in navigator) {
    // Register at an absolute path so the scope is always the origin root,
    // regardless of the base URL. Use type:'module' in dev because Vite serves
    // the SW as an ES module; use 'classic' in production for the compiled bundle.
    navigator.serviceWorker.register('/service-worker.js', {
      type: import.meta.env.DEV ? 'module' : 'classic',
    });
  }

  // If the SW is active but not yet controlling this page (e.g. first
  // activation with clients.claim()), reload once so the next navigation
  // goes through the SW and the page becomes properly controlled.
  // TODO: replace this with a notice to the user that there's an update they
  // can activate
  if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        window.location.reload();
      },
      { once: true },
    );
  }
});
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>
<SidebarProvider>
  <AppSidebar did={page.data.did ?? undefined} handle={page.data.handle ?? undefined} avatarUrl={page.data.avatarUrl ?? undefined} />
  <main class="flex-1 mobile-main">
    <div class="sidebar-trigger-wrapper"><SidebarTrigger /></div>
    <MobileHeader />
    {#if !online.value}
      <div class="bg-muted text-muted-foreground px-4 py-1 text-center text-xs">
        You're offline
      </div>
    {/if}
    <div class="p-4">
      <Collapsible.Root>
        <Collapsible.Trigger class="flex w-full">
          <Alert.Root class="border-primary bg-primary/10 text-primary-foreground">
            <Alert.Title class="flex flex-row w-full justify-between">
              <span>🚧 Under Construction</span>
              <ChevronDownIcon class="-mb-1" />
            </Alert.Title>
            <Collapsible.Content>
              <Alert.Description>
                Cuanto.bio is under active development. You're welcome to test it out, but functionality may change, data may disappear, etc. Use at your own risk.
              </Alert.Description>
            </Collapsible.Content>
          </Alert.Root>
        </Collapsible.Trigger>
      </Collapsible.Root>
    </div>
    <div class="mobile-scroll">
      {@render children()}
    </div>
    <MobileNav did={page.data.did ?? undefined} avatarUrl={page.data.avatarUrl ?? undefined} />
  </main>
</SidebarProvider>
