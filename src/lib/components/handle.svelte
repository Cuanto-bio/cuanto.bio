<script lang="ts">
interface Props {
  handle: string;
  avatarUrl?: string | null;
  // Several callers (ProtocolCard, SurveyCard's per-item usages, the
  // sidebar's own account link) already nest this component inside their
  // own <a>, where a self-link would produce invalid nested anchors. So
  // linking is opt-in, not the default.
  link?: boolean;
}
let { handle, avatarUrl, link = false }: Props = $props();
</script>

{#snippet content()}
  {#if avatarUrl}
    <img src={avatarUrl} alt="" class="h-5 w-5 rounded-full object-cover" aria-hidden="true" />
  {/if}
  <span>@{handle}</span>
{/snippet}

{#if link}
  <a href="/profile/{handle}" class="inline-flex items-center gap-1 hover:underline">
    {@render content()}
  </a>
{:else}
  <span class="inline-flex items-center gap-1">
    {@render content()}
  </span>
{/if}
