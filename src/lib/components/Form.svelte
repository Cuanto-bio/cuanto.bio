<script module>
export const SUBMITTING_CTX = 'form:submitting';
</script>

<script lang="ts">
import { setContext } from 'svelte';
import type { HTMLFormAttributes } from 'svelte/elements';
import { enhance } from '$app/forms';
import type { SubmitFunction } from '@sveltejs/kit';
import { clearDeadCredentialForActionResult } from '$lib/auth/clearDeadCredential';

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
  use:enhance={async ({ cancel, ...input }) => {
    // Wrap cancel so we can tell whether onEnhance aborted the submission.
    // SvelteKit skips the after-submit callback on cancel, so without this the
    // submitting flag (and any spinner) would stay stuck on.
    let cancelled = false;
    const wrappedCancel = () => {
      cancelled = true;
      cancel();
    };
    submitting = true;
    const userCallback = await onEnhance?.({ ...input, cancel: wrappedCancel });
    if (cancelled) {
      submitting = false;
      return;
    }
    return async (opts) => {
      if (typeof userCallback === 'function') {
        await userCallback(opts);
      } else {
        await opts.update();
      }
      // A form action reports a dead PDS session as fail(401, { sessionExpired
      // }); opts.update() renders the alert from `form`, but the stale
      // credential also has to go or the app keeps looking signed in (issue #65).
      clearDeadCredentialForActionResult(opts.result);
      submitting = false;
    };
  }}
>
  {@render children?.()}
</form>
