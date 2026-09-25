<script lang="ts">
import LogOutIcon from '@lucide/svelte/icons/log-out';
import { Button } from '$lib/components/ui/button';
import { Label } from '$lib/components/ui/label';
import * as Select from '$lib/components/ui/select';
import { licenseLabel, REMARK_LICENSES } from '$lib/licenses';
import { signOut } from '$lib/offline/auth';

let { data } = $props();

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let license = $state(data.defaultRemarkLicense);
let saveError = $state(false);

async function setLicense(next: string) {
  const previous = license;
  license = next;
  saveError = false;
  try {
    const res = await fetch('/api/me/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultRemarkLicense: next }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // Put the control back where it was so it never shows a choice the server
    // did not accept.
    license = previous;
    saveError = true;
  }
}
</script>

<main class="mx-auto max-w-sm px-4 py-12">
  <div class="flex flex-col items-center gap-3 pb-10">
    {#if data.avatarUrl}
      <img src={data.avatarUrl} alt="" class="h-20 w-20 rounded-full object-cover" />
    {:else}
      <div class="bg-primary text-primary-foreground flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold">
        {data.handle?.[0]?.toUpperCase() ?? '?'}
      </div>
    {/if}
    <p class="text-lg font-bold">@{data.handle}</p>
    {#if data.handle}
      <a href="/profile/{data.handle}" class="text-primary text-sm hover:underline">
        View public profile
      </a>
    {/if}
  </div>

  {#if license}
    <div class="flex flex-col gap-2 pb-10">
      <Label for="default-remark-license">Default license for your remarks</Label>
      <Select.Root
        type="single"
        bind:value={() => license as string, setLicense}
      >
        <Select.Trigger id="default-remark-license" class="w-full">
          {licenseLabel(license)}
        </Select.Trigger>
        <Select.Content>
          {#each REMARK_LICENSES as option (option.value)}
            <Select.Item value={option.value} label={option.label}>
              <span class="flex flex-col items-start">
                <span>{option.fullLabel}</span>
                <span class="text-muted-foreground text-xs">{option.description}</span>
              </span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      <p class="text-muted-foreground text-sm">
        Remarks (like the ones you might include on a survey) are published as
        their own records, separate from the data they describe. This sets
        the default license for the ones you write from now on; you can pick
        a different one on each remark.
      </p>
      {#if saveError}
        <p class="text-destructive text-sm" role="alert">
          Could not save that. Check your connection and try again.
        </p>
      {/if}
    </div>
  {/if}

  <Button onclick={signOut} variant="outline" class="w-full">
    <LogOutIcon />
    Sign out
  </Button>
</main>
