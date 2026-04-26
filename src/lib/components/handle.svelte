<script lang="ts">
interface Props {
  handle: string;
  avatarUrl?: string | null;
}
let { handle, avatarUrl }: Props = $props();
</script>

<span class="inline-flex items-center gap-1">
  {#if avatarUrl}
    <img src={avatarUrl} alt="" class="h-5 w-5 rounded-full object-cover" aria-hidden="true" />
  {/if}
  <span>@{handle}</span>
</span>
