<script lang="ts">
import ProtocolForm from '$lib/components/ProtocolForm.svelte';

let { data } = $props();
</script>

<main class="mx-auto max-w-2xl px-4 pb-8">
  <ProtocolForm protocol={data.protocol} />
</main>
