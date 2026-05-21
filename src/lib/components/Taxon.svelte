<script lang="ts">
export interface TaxonProp {
  scientificName: string;
  vernacularName?: string;
  taxonRank?: string;
  kingdom?: string;
}
const { taxon }: { taxon: TaxonProp } = $props();
</script>

{#if ['genus', 'species', 'subspecies', 'variety', 'infraspecies'].includes(taxon.taxonRank ?? '')}
  {#if taxon.vernacularName}
    {taxon.vernacularName} (<i>{taxon.scientificName}</i>)
  {:else}
    <i>{taxon.scientificName}</i>
  {/if}
{:else}
  {#if taxon.vernacularName}
    {taxon.vernacularName} ({taxon.taxonRank ?? '??'} {taxon.scientificName})
  {:else}
    {taxon.taxonRank} {taxon.scientificName}
  {/if}
{/if}

