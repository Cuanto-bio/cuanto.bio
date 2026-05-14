<script lang="ts">
import Taxon from '$lib/components/Taxon.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import * as Button from '$lib/components/ui/button';
import type { Occurrence, Target, TaxonScope } from '$lib/offline/db';

interface Props {
  occurrences: Occurrence[];
  targets: Target[];
  onSuccess: () => Promise<void>;
}

let { occurrences, targets, onSuccess }: Props = $props();

const targetUris = $derived(new Set(targets.map((t) => t.atUri)));

const orphans = $derived(
  occurrences.filter(
    (o) => o.record.surveyTargetID && !targetUris.has(o.record.surveyTargetID),
  ),
);

function rkey(atUri: string): string {
  return atUri.split('/').at(-1) ?? '';
}

function findMatchingTarget(taxonID: string): Target | undefined {
  return targets.find((t) =>
    t.record.scope.some(
      (s) =>
        s.$type?.endsWith('#taxonScope') &&
        (s as TaxonScope).taxonID === taxonID,
    ),
  );
}

function displayName(occ: Occurrence): string {
  if (occ.identification?.vernacularName)
    return occ.identification.vernacularName;
  if (occ.identification?.scientificName)
    return occ.identification.scientificName;
  if (occ.record.taxonID) {
    const match = findMatchingTarget(occ.record.taxonID);
    if (match) {
      const first = match.record.scope[0] as TaxonScope;
      return (
        first?.vernacularName ?? first?.scientificName ?? occ.record.taxonID
      );
    }
    return `Taxon: ${occ.record.taxonID}`;
  }
  return 'Unknown taxon';
}

let pendingAction = $state<
  Record<string, 'relink' | 'convert' | 'delete' | null>
>({});
let relinkTarget = $state<Record<string, string>>({});
let busy = $state<Record<string, boolean>>({});
let error = $state<Record<string, string>>({});

async function relinkToTarget(occ: Occurrence, targetUri: string) {
  const k = occ.atUri;
  busy[k] = true;
  error[k] = '';
  try {
    const res = await fetch(`/api/occurrences/${rkey(occ.atUri)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'relink', surveyTargetID: targetUri }),
    });
    if (!res.ok) throw new Error(await res.text());
    await onSuccess();
  } catch (e) {
    error[k] = String(e);
  } finally {
    busy[k] = false;
    pendingAction[k] = null;
  }
}

async function convertToIncidental(occ: Occurrence) {
  const k = occ.atUri;
  busy[k] = true;
  error[k] = '';
  try {
    const res = await fetch(`/api/occurrences/${rkey(occ.atUri)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'convert-to-incidental' }),
    });
    if (!res.ok) throw new Error(await res.text());
    await onSuccess();
  } catch (e) {
    error[k] = String(e);
  } finally {
    busy[k] = false;
    pendingAction[k] = null;
  }
}

async function deleteOccurrence(occ: Occurrence) {
  const k = occ.atUri;
  busy[k] = true;
  error[k] = '';
  try {
    const res = await fetch(`/api/occurrences/${rkey(occ.atUri)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(await res.text());
    await onSuccess();
  } catch (e) {
    error[k] = String(e);
  } finally {
    busy[k] = false;
    pendingAction[k] = null;
  }
}
</script>

{#if orphans.length > 0}
  <h2 class="mb-3 mt-6 text-lg font-semibold">
    Needs attention ({orphans.length})
  </h2>
  <p class="text-muted-foreground mb-3 text-sm">
    These occurrences reference survey targets that no longer exist, likely because the protocol
    was edited.
  </p>
  <ul class="flex flex-col gap-3">
    {#each orphans as occ (occ.atUri)}
      {@const taxonID = occ.record.taxonID}
      {@const matchingTarget = taxonID ? findMatchingTarget(taxonID) : undefined}
      {@const k = occ.atUri}
      <li class="rounded border px-4 py-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-medium">{displayName(occ)}</span>
          <span class="font-mono text-sm">{occ.record.organismQuantity ?? 0}</span>
        </div>

        {#if error[k]}
          <p class="text-destructive mb-2 text-xs">{error[k]}</p>
        {/if}

        <div class="flex flex-wrap gap-2">
          {#if matchingTarget}
            <!-- Auto-match: relink directly -->
            {@const first = matchingTarget.record.scope[0] as TaxonScope}
            <Button.Root
              size="sm"
              variant="outline"
              disabled={busy[k]}
              onclick={() => relinkToTarget(occ, matchingTarget.atUri)}
            >
              Relink to <Taxon taxon={first} />
            </Button.Root>
          {:else if targets.length > 0}
            <!-- Manual relink via select -->
            {#if pendingAction[k] === 'relink'}
              <select
                class="border-input rounded-md border px-2 py-1 text-sm"
                bind:value={relinkTarget[k]}
              >
                <option value="">Pick a target…</option>
                {#each targets as t (t.atUri)}
                  {@const s = t.record.scope[0] as TaxonScope}
                  <option value={t.atUri}>
                    {s?.vernacularName ?? s?.scientificName ?? t.atUri}
                  </option>
                {/each}
              </select>
              <Button.Root
                size="sm"
                disabled={!relinkTarget[k] || busy[k]}
                onclick={() => relinkToTarget(occ, relinkTarget[k])}
              >
                Confirm
              </Button.Root>
              <Button.Root
                size="sm"
                variant="ghost"
                onclick={() => { pendingAction[k] = null; }}
              >
                Cancel
              </Button.Root>
            {:else}
              <Button.Root
                size="sm"
                variant="outline"
                disabled={busy[k]}
                onclick={() => { pendingAction[k] = 'relink'; relinkTarget[k] = ''; }}
              >
                Link to target…
              </Button.Root>
            {/if}
          {/if}

          {#if taxonID}
            <Button.Root
              size="sm"
              variant="outline"
              disabled={busy[k]}
              onclick={() => convertToIncidental(occ)}
            >
              Convert to incidental
            </Button.Root>
          {/if}

          <!-- Delete with confirmation -->
          <AlertDialog.Root>
            <AlertDialog.Trigger>
              {#snippet child({ props })}
                <Button.Root size="sm" variant="destructive" disabled={busy[k]} {...props}>
                  Delete
                </Button.Root>
              {/snippet}
            </AlertDialog.Trigger>
            <AlertDialog.Content>
              <AlertDialog.Header>
                <AlertDialog.Title>Delete this occurrence?</AlertDialog.Title>
                <AlertDialog.Description>
                  This will permanently delete the occurrence of {displayName(occ)}
                  (quantity: {occ.record.organismQuantity ?? 0}). This cannot be undone.
                </AlertDialog.Description>
              </AlertDialog.Header>
              <AlertDialog.Footer>
                <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                <AlertDialog.Action onclick={() => deleteOccurrence(occ)}>Delete</AlertDialog.Action>
              </AlertDialog.Footer>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </div>
      </li>
    {/each}
  </ul>
{/if}
