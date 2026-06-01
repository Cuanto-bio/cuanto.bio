<script lang="ts">
import * as Dialog from '$lib/components/ui/dialog';
import { install } from '$lib/pwa/install.svelte';
import InstallInstructions from './InstallInstructions.svelte';
</script>

<Dialog.Root
  open={install.dialogOpen}
  onOpenChange={(open) => {
    if (!open) install.closeDialog();
  }}
>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Use Cuanto offline in the field</Dialog.Title>
      <Dialog.Description>
        Add Cuanto to your home screen and open it like an app, even without an Internet connection.
      </Dialog.Description>
    </Dialog.Header>
    <InstallInstructions
      family={install.browserFamily}
      showBookmarkAlt={!install.isIOS}
    />
  </Dialog.Content>
</Dialog.Root>
