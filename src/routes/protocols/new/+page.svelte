<script lang="ts">
import ProtocolForm from '$lib/components/ProtocolForm.svelte';
import type { ActionData } from './$types';

let { form }: { form: ActionData } = $props();
</script>

<main>
  <ProtocolForm {form} />
</main>
