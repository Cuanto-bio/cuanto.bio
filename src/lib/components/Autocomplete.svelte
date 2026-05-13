<script lang="ts" generics="T">
import LoaderCircle from '@lucide/svelte/icons/loader-circle';
import type { Snippet } from 'svelte';
import type { HTMLInputAttributes } from 'svelte/elements';
import { Input } from '$lib/components/ui/input';

type Props = Omit<HTMLInputAttributes, 'value' | 'onselect'> & {
  value?: string;
  items: T[];
  onselect: (item: T) => void;
  item: Snippet<[T, boolean]>;
  portalTarget?: HTMLElement;
  loading?: boolean;
};

let {
  value = $bindable(''),
  items,
  onselect,
  item,
  portalTarget,
  loading = false,
  class: className,
  ...inputProps
}: Props = $props();

let activeIndex = $state(-1);
let showDropdown = $state(false);
let inputRef = $state<HTMLInputElement | null>(null);
let dropdownStyle = $state('');

$effect(() => {
  if (items.length > 0) {
    updateDropdownPosition();
    showDropdown = true;
    activeIndex = -1;
  } else {
    showDropdown = false;
  }
});

function portal(node: HTMLElement) {
  (portalTarget ?? document.body).appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}

function updateDropdownPosition() {
  if (!inputRef) return;
  const rect = inputRef.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeAbove = spaceBelow < 160 && rect.top > spaceBelow;
  if (portalTarget) {
    const targetRect = portalTarget.getBoundingClientRect();
    const left = `left: ${rect.left - targetRect.left + portalTarget.scrollLeft}px`;
    const width = `width: ${rect.width}px`;
    const position = placeAbove
      ? `bottom: ${targetRect.bottom - rect.top + 4}px`
      : `top: ${rect.bottom - targetRect.top + portalTarget.scrollTop + 4}px`;
    dropdownStyle = ['position: absolute', position, left, width].join('; ');
  } else {
    const position = placeAbove
      ? `bottom: ${window.innerHeight - rect.top + 4}px`
      : `top: ${rect.bottom + 4}px`;
    dropdownStyle = `position: fixed; ${position}; left: ${rect.left}px; width: ${rect.width}px;`;
  }
}

function select(suggestion: T) {
  onselect(suggestion);
  showDropdown = false;
  activeIndex = -1;
}

function handleKeydown(e: KeyboardEvent) {
  if (!showDropdown) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, -1);
  } else if (e.key === 'Enter' && activeIndex >= 0) {
    e.preventDefault();
    select(items[activeIndex]);
  } else if (e.key === 'Escape') {
    showDropdown = false;
    activeIndex = -1;
  }
}

function handleBlur() {
  // Delay so mousedown on a suggestion fires before the dropdown hides
  setTimeout(() => {
    showDropdown = false;
    activeIndex = -1;
  }, 150);
}
</script>

<div class="relative">
  <Input
    bind:ref={inputRef}
    bind:value
    class="{loading ? 'pr-8' : ''} {className ?? ''}"
    {...(inputProps as any)}
    onkeydown={handleKeydown}
    onblur={handleBlur}
  />
  {#if loading}
    <LoaderCircle
      class="text-muted-foreground absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin"
      aria-hidden="true"
    />
  {/if}
</div>

{#if showDropdown}
  <ul
    use:portal
    class="z-50 rounded-md border border-border bg-card shadow-md"
    style={dropdownStyle}
  >
    {#each items as suggestion, i}
      <li>
        <button
          type="button"
          class="flex w-full justify-start items-center gap-2 px-3 py-2 text-sm hover:bg-accent {i === activeIndex ? 'bg-accent' : ''}"
          onmousedown={() => select(suggestion)}
        >
          {@render item(suggestion, i === activeIndex)}
        </button>
      </li>
    {/each}
  </ul>
{/if}
