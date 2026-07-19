<script lang="ts">
import LogOutIcon from '@lucide/svelte/icons/log-out';
import { Button } from '$lib/components/ui/button';
import { signOut } from '$lib/offline/auth';

let { data } = $props();
</script>

<main class="mx-auto max-w-sm px-4 py-12">
  <div class="flex flex-col items-center gap-3 pb-10">
    {#if data.avatarUrl}
      <img src={data.avatarUrl} alt="" class="h-20 w-20 rounded-full object-cover" />
    {:else}
      <div class="bg-primary text-primary-foreground flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold">
        {data.handle?.[0]?.toUpperCase() ?? '?'}
      </div>
    {/if}
    <p class="text-lg font-bold">@{data.handle}</p>
  </div>

  <Button onclick={signOut} variant="outline" class="w-full">
    <LogOutIcon />
    Sign out
  </Button>
</main>
