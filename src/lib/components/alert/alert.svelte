<script lang="ts">
import type { Snippet } from 'svelte';
import { Root as AlertRoot } from '$lib/components/ui/alert';

interface Props {
  level?: 'warning';
  class?: string;
  children: Snippet;
}

const { level = undefined, class: className = '', children } = $props();

const levelClasses: Record<string, string> = {
  warning: 'border-primary bg-primary/10 text-primary-foreground',
};

const classes = $derived(
  [level && levelClasses[level], className].filter(Boolean).join(' '),
);
</script>

<AlertRoot class={classes}>
  {@render children()}
</AlertRoot>
