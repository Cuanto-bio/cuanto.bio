<script lang="ts">
import { onMount } from 'svelte';
import { page } from '$app/state';
import './layout.css';
import favicon from '$lib/assets/favicon.svg';
import AppSidebar from '$lib/components/sidebar.svelte';
import {
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '$lib/components/ui/sidebar';
import { useOnline } from '$lib/composables/online.svelte';

let { children } = $props();

const online = useOnline();

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
  <main class="flex-1">
    <SidebarTrigger />
    {#if !online.value}
      <div class="bg-muted text-muted-foreground px-4 py-1 text-center text-xs">
        You're offline
      </div>
    {/if}
    {@render children()}
  </main>
</SidebarProvider>
