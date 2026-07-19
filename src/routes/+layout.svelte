<script lang="ts">
import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
import { page } from '$app/state';
import { nav } from '$lib/navigation.svelte';
import './layout.css';
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import { Collapsible } from 'bits-ui';
import { toast } from 'svelte-sonner';
import favicon from '$lib/assets/favicon.svg';
import * as Alert from '$lib/components/alert';
import InstallFooter from '$lib/components/InstallFooter.svelte';
import InstallPromptDialog from '$lib/components/InstallPromptDialog.svelte';
import MobileHeader from '$lib/components/mobile-header.svelte';
import MobileNav from '$lib/components/mobile-nav.svelte';
import AppSidebar from '$lib/components/sidebar.svelte';
import { SidebarProvider, SidebarTrigger } from '$lib/components/ui/sidebar';
import { Toaster } from '$lib/components/ui/sonner';
import { useOnline } from '$lib/composables/online.svelte';
import { install } from '$lib/pwa/install.svelte';
import { SKIP_WAITING, watchForUpdates } from '$lib/pwa/swUpdate';

let { children } = $props();

const online = useOnline();

let scrollContainer = $state<HTMLDivElement>();

// Record every client-side navigation so the mobile header can show a
// contextual back link. `from` is null on the initial page load (no previous
// route within the app), so we skip it — the stack starts empty.
// The server-side guard lives in navigation.svelte.ts; afterNavigate only
// fires in the browser, but the browser import is kept there for clarity.
afterNavigate(({ from, to }) => {
  if (from) nav.navigate(from.url?.href, to?.url?.href ?? '');

  // .mobile-scroll (not the window) is the scrolling element on narrow/touch
  // viewports, and it lives in this layout, so it survives client-side
  // navigation instead of being recreated. SvelteKit's built-in scroll reset
  // only touches window.scrollY, so we have to reset this one ourselves.
  if (scrollContainer) scrollContainer.scrollTop = 0;
});

onMount(() => {
  // Detect installed state early (appinstalled event + getInstalledRelatedApps)
  // so we can suppress the prompt before any user interaction.
  install.init();

  if ('serviceWorker' in navigator) {
    // Register at an absolute path so the scope is always the origin root,
    // regardless of the base URL. Use type:'module' in dev because Vite serves
    // the SW as an ES module; use 'classic' in production for the compiled bundle.
    navigator.serviceWorker
      .register('/service-worker.js', {
        type: import.meta.env.DEV ? 'module' : 'classic',
      })
      .then((registration) => {
        // When an update has installed and is waiting to take over, prompt the
        // user rather than forcing a reload. Clicking activates the waiting SW
        // (SKIP_WAITING), which fires controllerchange below and reloads once.
        watchForUpdates(
          registration,
          (waiting) => {
            toast('A new version is available.', {
              action: {
                label: 'Reload',
                onClick: () => waiting.postMessage({ type: SKIP_WAITING }),
              },
              duration: Number.POSITIVE_INFINITY,
            });
          },
          () => !!navigator.serviceWorker.controller,
        );
      });

    // Reload once the controlling SW changes. Registered unconditionally: the
    // previous guard (`!controller`) only ran on first install, so updates never
    // reloaded and the page kept running JS chunks the new SW had already
    // evicted, silently breaking navigation (issue #4). `refreshing` guards
    // against any double reload.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
});
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>
<SidebarProvider>
  <AppSidebar did={page.data.did ?? undefined} handle={page.data.handle ?? undefined} avatarUrl={page.data.avatarUrl ?? undefined} />
  <!--
    min-w-0 is load-bearing: as a flex item this defaults to min-width:auto, so
    any wide descendant (a diagram, a table) stretches it past the viewport and
    the whole page scrolls sideways instead of the descendant's own
    overflow-x-auto kicking in.
  -->
  <main class="flex-1 min-w-0 mobile-main flex flex-col">
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
          <Alert.Root level="warning">
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
    <!--
      Scrolling is deliberately NOT set here: layout.css gives .mobile-scroll
      `overflow-y: auto` only on narrow/touch viewports. Applying it at every
      width would make this an overflow container that never actually scrolls on
      desktop, which silently breaks `position: sticky` for anything inside it.
    -->
    <div class="mobile-scroll flex-1 min-w-0" bind:this={scrollContainer}>
      <div class="mx-auto max-w-4xl min-w-0 px-4 pb-8 flex flex-col min-h-full">
        {@render children()}
        <InstallFooter />
      </div>
    </div>
    <MobileNav did={page.data.did ?? undefined} avatarUrl={page.data.avatarUrl ?? undefined} />
  </main>
</SidebarProvider>
<InstallPromptDialog />
<Toaster richColors />
