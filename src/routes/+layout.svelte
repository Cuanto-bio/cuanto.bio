<script lang="ts">
import './layout.css';
import favicon from '$lib/assets/favicon.svg';
import AppSidebar from '$lib/components/sidebar.svelte';
import { SidebarProvider, SidebarTrigger } from '$lib/components/ui/sidebar';

let { data, children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<SidebarProvider>
  <AppSidebar did={data.did ?? undefined} handle={data.handle ?? undefined} />
  <main class="flex-1">
    <SidebarTrigger />
    {@render children()}
  </main>
</SidebarProvider>
