<script lang="ts">
import type { Snippet } from 'svelte';

type Props = {
  title: string;
  optional?: boolean;
  children: Snippet;
};

let { title, optional = false, children }: Props = $props();
</script>

<fieldset
  class={`
    bg-muted/40
    flex
    w-full
    flex-col
    gap-3
    rounded-lg
    border
    ${optional ? 'border-dashed' : 'border-solid'}
    p-4
  `}
>
  <legend class="flex w-full items-center justify-between float-left w-full">
    <span class="text-muted-foreground text-xs font-semibold tracking-wider">{title}</span>
    {#if optional}
      <span class="text-muted-foreground text-xs">optional</span>
    {/if}
  </legend>
  <div>
    {@render children()}
  </div>
</fieldset>
