<script lang="ts">
// Thin wrapper around shadcn button that adds loading behavior for submit buttons
import LoaderCircle from '@lucide/svelte/icons/loader-circle';
import { getContext } from 'svelte';
import { SUBMITTING_CTX } from '$lib/components/Form.svelte';
import { Button, type ButtonProps } from '$lib/components/ui/button';

let { type = 'button', disabled, children, ...rest }: ButtonProps = $props();

const formCtx = getContext<{ value: boolean } | undefined>(SUBMITTING_CTX);
const loading = $derived(type === 'submit' && (formCtx?.value ?? false));
</script>

<Button {type} disabled={disabled || loading} {...rest}>
  {#if loading}
    <LoaderCircle class="animate-spin" />
  {/if}
  {@render children?.()}
</Button>
