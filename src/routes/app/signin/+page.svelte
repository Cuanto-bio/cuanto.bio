<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { initNativeAuth, startNativeSignIn } from '$lib/auth/native';
import Button from '$lib/components/Button.svelte';
import { isNative } from '$lib/platform';

// Sign-in for the native shell. The web app uses the server-rendered form at
// /auth/signin; the native bundle contains only /app/*, so this route exists to
// give the app somewhere real to land and to start the system-browser handoff.
let status = $state<'idle' | 'opening' | 'failed'>('idle');
// Surfaced rather than swallowed: the first real failure here was a native
// plugin that had not been linked into the build, which no amount of
// user-facing advice would have fixed and which an opaque message actively hid.
let errorDetail = $state('');

onMount(() => {
  if (!isNative()) {
    // Reachable in a browser only by typing the URL. Send them to the real one.
    goto('/auth/signin', { replaceState: true });
    return;
  }
  // Registered before any sign-in attempt: on a cold launch iOS can deliver the
  // callback URL as soon as the app starts, and a listener added later misses it.
  initNativeAuth({
    onSignedIn: () => {
      goto('/app', { replaceState: true });
    },
    // Reported rather than swallowed. These failures all happen after the user
    // has already signed in successfully in the browser, so the alternative is
    // returning to a sign-in screen with no explanation.
    onError: (message) => {
      errorDetail = message;
      status = 'failed';
    },
  });
});

async function signIn() {
  status = 'opening';
  errorDetail = '';
  try {
    await startNativeSignIn();
    // Control passes to the system browser; the appUrlOpen listener takes over.
    status = 'idle';
  } catch (err) {
    errorDetail = String(err);
    status = 'failed';
  }
}
</script>

<main class="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center gap-6">
  <div class="flex flex-col gap-2">
    <h1 class="text-2xl font-semibold">Sign in to Cuanto</h1>
    <p class="text-muted-foreground text-sm">
      You'll sign in with your Atmosphere account in your browser, then come
      back here.
    </p>
  </div>

  <Button onclick={signIn} disabled={status === 'opening'}>
    {status === 'opening' ? 'Opening browser…' : 'Sign in'}
  </Button>

  {#if status === 'failed'}
    <div class="flex flex-col gap-1">
      <p class="text-destructive text-sm">Couldn't start sign-in.</p>
      <!--
        The underlying error, not a guess at it. Deliberately not phrased as
        "check your connection": the causes seen so far have been a missing
        native plugin and a misconfigured API origin, neither of which the user
        can act on, and both of which that advice would have obscured.
      -->
      <p class="text-muted-foreground font-mono text-xs break-all">
        {errorDetail}
      </p>
    </div>
  {/if}
</main>
