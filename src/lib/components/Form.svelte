<script module>
export const SUBMITTING_CTX = 'form:submitting';
</script>

<script lang="ts">
import { setContext } from 'svelte';
import type { HTMLFormAttributes } from 'svelte/elements';
import { enhance } from '$app/forms';
import type { SubmitFunction } from '@sveltejs/kit';

let { children, onEnhance, ...rest }: HTMLFormAttributes & { onEnhance?: SubmitFunction } =
  $props();

let submitting = $state(false);
setContext(SUBMITTING_CTX, {
  get value() {
    return submitting;
  },
});
</script>

<form
  {...rest}
  use:enhance={async (input) => {
    submitting = true;
    const userCallback = await onEnhance?.(input);
    return async (opts) => {
      if (typeof userCallback === 'function') {
        await userCallback(opts);
      } else {
        await opts.update();
      }
      submitting = false;
    };
  }}
>
  {@render children?.()}
</form>
