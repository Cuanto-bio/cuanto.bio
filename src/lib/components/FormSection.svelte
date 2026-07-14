<script lang="ts">
import type { Snippet } from 'svelte';

type Props = {
  title: string;
  optional?: boolean;
  children: Snippet;
};

let { title, optional = false, children }: Props = $props();
</script>

<!--
  On mobile the section bleeds to the screen edge with only top/bottom rules
  (-mx-4 cancels the page's px-4; w-full is dropped so the negative margins can
  widen it), matching the survey form's full-width lines. At sm+ it becomes a
  contained rounded box. -mx-4 assumes the enclosing page padding is px-4.
-->
<fieldset
  class={`
    bg-muted/40
    -mx-4
    flex
    flex-col
    gap-3
    rounded-none
    border-y
    sm:mx-0
    sm:rounded-lg
    sm:border
    ${optional ? 'border-dashed' : 'border-solid'}
    p-4
  `}
>
  <legend class="flex w-full items-center justify-between float-left">
    <span class="text-muted-foreground text-xs font-semibold tracking-wider">{title}</span>
    {#if optional}
      <span class="text-muted-foreground text-xs">optional</span>
    {/if}
  </legend>
  <div>
    {@render children()}
  </div>
</fieldset>
