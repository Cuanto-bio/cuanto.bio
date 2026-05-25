<script lang="ts">
import { goto } from '$app/navigation';
import Button from '$lib/components/Button.svelte';
import SurveyForm from '$lib/components/SurveyForm.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import { Checkbox } from '$lib/components/ui/checkbox';
import { Label } from '$lib/components/ui/label';
import { deleteCachedSurvey } from '$lib/offline/db';

let { data } = $props();

let deleteDialogOpen = $state(false);
let cascadeDelete = $state(true);
let deleting = $state(false);
let deleteError = $state<string | null>(null);

async function handleDelete() {
  deleting = true;
  deleteError = null;
  const params = new URLSearchParams({
    deleteOccurrences: String(cascadeDelete),
  });
  const res = await fetch(
    `/api/surveys/${data.survey.handle}/${data.survey.rkey}?${params}`,
    { method: 'DELETE' },
  );
  if (res.ok || res.status === 204) {
    await deleteCachedSurvey(data.survey.atUri);
    await goto('/app/surveys');
    return;
  }
  const body = await res.json().catch(() => ({}));
  deleteError = body.message ?? `Error ${res.status}`;
  deleting = false;
}
</script>

<SurveyForm protocol={data.protocol} survey={data.survey} />

<div class="mx-auto max-w-2xl px-4 pb-8 flex justify-center">
  <Button
    type="button"
    variant="destructive"
    onclick={() => (deleteDialogOpen = true)}
  >
    Delete survey
  </Button>
</div>

<AlertDialog.Root bind:open={deleteDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete survey?</AlertDialog.Title>
      <AlertDialog.Description>
        This cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <div>
      <div class="flex items-center gap-2 py-2">
        <Checkbox id="cascade" bind:checked={cascadeDelete} />
        <Label for="cascade" class="cursor-pointer">
          Also delete all occurrences
        </Label>
      </div>
      <p class="text-sm">The survey's occurrences record what you observed during the survey. Unselect this if you want to preserve them for use elsewhere in the Atmosphere.</p>
      {#if deleteError}
        <p class="text-destructive text-sm">{deleteError}</p>
      {/if}
    </div>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={handleDelete}
        disabled={deleting}
        variant="destructive"
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
