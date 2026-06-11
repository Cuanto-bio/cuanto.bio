<script lang="ts">
import ProtocolForm from '$lib/components/ProtocolForm.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<main>
  <ProtocolForm protocol={data.protocol} {form} />
</main>
