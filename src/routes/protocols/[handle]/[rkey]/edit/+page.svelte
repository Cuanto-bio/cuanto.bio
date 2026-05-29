<script lang="ts">
import ProtocolForm from '$lib/components/ProtocolForm.svelte';

let { data } = $props();
</script>

<main>
  <ProtocolForm protocol={data.protocol} />
</main>
