<script lang="ts">
import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
import type { ComponentProps } from 'svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { cn } from '$lib/utils.js';
import { useSidebar } from './context.svelte.js';

let {
  ref = $bindable(null),
  class: className,
  onclick,
  ...restProps
}: ComponentProps<typeof Button> & {
  onclick?: (e: MouseEvent) => void;
} = $props();

const sidebar = useSidebar();
</script>

<Button
	bind:ref
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size={sidebar.isMobile ? "icon-lg" : "icon-sm"}
	class={cn("cn-sidebar-trigger", className, "p-6")}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<PanelLeftIcon class={sidebar.isMobile ? "size-6" : "size-4"} />
	<span class="sr-only">Toggle Sidebar</span>
</Button>
