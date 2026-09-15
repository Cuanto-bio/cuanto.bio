<script lang="ts">
import Form from '$lib/components/Form.svelte';
import ProtocolForm from '$lib/components/ProtocolForm.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import * as Button from '$lib/components/ui/button';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();

// The danger zone stays collapsed behind its own click rather than showing
// by default, so glancing at the edit page doesn't put a destructive-styled
// button in front of someone who came here to change a title.
let showDangerZone = $state(false);
</script>

<main>
  <ProtocolForm protocol={data.protocol} {form} />

  <section class="mx-auto mt-10 max-w-2xl border-t pt-6">
    {#if showDangerZone}
      <h2 class="text-lg font-semibold">Danger zone</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Deleting this protocol removes it and its targets from your data.
        Existing surveys keep their data and stats stay viewable, but nobody
        will be able to start a new survey following it afterward.
        {#if data.surveyCount}
          {data.surveyCount}
          {data.surveyCount === 1 ? 'survey already references' : 'surveys already reference'}
          it.
        {/if}
      </p>
      <AlertDialog.Root>
        <AlertDialog.Trigger>
          {#snippet child({ props })}
            <Button.Root variant="destructive" class="mt-3" {...props}>Delete protocol</Button.Root>
          {/snippet}
        </AlertDialog.Trigger>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Delete this protocol?</AlertDialog.Title>
            <AlertDialog.Description>
              This permanently deletes the protocol and its targets from your
              data. Existing surveys keep their data and stats stay viewable,
              but nobody will be able to start a new survey following it
              afterward.
              {#if data.surveyCount}
                {data.surveyCount}
                {data.surveyCount === 1
                  ? 'survey already references'
                  : 'surveys already reference'}
                it.
              {/if}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <Form method="POST" action="?/delete">
              <AlertDialog.Action type="submit" variant="destructive">Delete</AlertDialog.Action>
            </Form>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    {:else}
      <div class="flex justify-center">
        <Button.Root variant="outline" onclick={() => (showDangerZone = true)}>
          Delete protocol
        </Button.Root>
      </div>
    {/if}
  </section>
</main>
