<script lang="ts">
import DownloadIcon from '@lucide/svelte/icons/download';
import { install } from '$lib/pwa/install.svelte';

const debug = false;
</script>

{#if debug}
  <div
    class="text-muted-foreground mt-8 border-t pt-3 font-mono text-[0.7rem]
      leading-5"
  >
    <div class="font-bold">install footer debug</div>
    <div>shouldOffer: {install.shouldOffer} (footer shows when true)</div>
    <div>· isTouch (pointer:coarse): {install.isTouch}</div>
    <div>· isStandalone: {install.isStandalone}</div>
    <div>· installed (related apps / appinstalled): {install.installed}</div>
    <div>isIOS: {install.isIOS}</div>
    <div>browserFamily: {install.browserFamily}</div>
  </div>
{/if}

<!--
  Persistent, non-dismissible entry point to re-open the install prompt. Renders
  only on touch devices that aren't already running the installed PWA. Kept
  subtle (muted, small) so it sits unobtrusively at the end of page content.
-->
{#if install.shouldOffer}
  <div class="mt-8 flex justify-center border-t pt-8">
    <button
      type="button"
      onclick={() => install.open(false)}
      class="text-muted-foreground hover:text-foreground flex items-center gap-1.5
        text-xs transition-colors"
    >
      <DownloadIcon size={14} />
      Install Cuanto as an app
    </button>
  </div>
{/if}
