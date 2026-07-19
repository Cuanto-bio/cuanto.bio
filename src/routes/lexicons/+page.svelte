<script lang="ts">
import CodeIcon from '@lucide/svelte/icons/code';
import type { Layout } from './+page.server';
import type { PageServerData } from './$types';
import { authors, type EntityMeta, relationships, surveyors } from './graph';

const title = 'Cuanto Lexicons';

let { data }: { data: PageServerData } = $props();

// Both diagram layouts (dagre) are computed in +page.server.ts; here we only
// style the coordinates they return.
const compact = $derived(data.layouts.compact);
const wide = $derived(data.layouts.wide);

type LexInfo = NonNullable<PageServerData['lexicons'][string]>;

// Cuanto's own lexicons live in this repo; the file path mirrors the NSID.
const tangledUrl = (nsid: string) =>
  `https://tangled.org/cuanto.bio/cuanto.bio/blob/main/lexicons/${nsid.split('.').join('/')}.json`;
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<main>
  <h1>{title}</h1>

  <p>
    Cuanto is built on the <a href="https://atproto.com/">AT Protocol</a> (aka atproto), a decentralized data storage and publishing protocol. In atproto, different kinds of data are defined by <a href="https://atproto.com/guides/lexicon">lexicons</a>, and data that conform to a lexicon are stored in collections on their author's Personal Data Server (PDS). Cuanto defines a few of its own lexicons and reuses a few others. This page describes what they are and how they relate to each other. These lexicons are modeled after the <a href="https://dwc.tdwg.org/cm/">Darwin Core Conceptual Model (DwC-CM)</a> and designed to be exportable into a <a href="https://gbif.github.io/dwc-dp/qrg/">Darwin Core Data Package (DwC-DP)</a>, which are both data standards for storing and exchanging biodiversity data.
  </p>

  <!-- Diagram -->
  <section class="mb-12 justify-center">
    <figure>
      <!--
        Two renderings of the same graph, swapped at the sm breakpoint: the
        compact one is laid out to fit a phone, the wide one keeps the roomier
        spacing and fuller edge labels that a big screen has space for. Only one
        is displayed at a time, so the hidden one costs markup but never paints.
      -->
      <div class="diagram sm:hidden" style="--diagram-w:{compact.width}px">
        {@render diagram(compact, 'compact')}
      </div>
      <div class="diagram hidden sm:block" style="--diagram-w:{wide.width}px">
        {@render diagram(wide, 'wide')}
      </div>
      <figcaption class="mt-4 text-sm">
        Each arrow points from the record that holds the reference to the one it references (two
        records that reference each other get one arrow each); the Relationships table below names the
        field for each. Dashed boxes are shared <span class="font-mono">lexicons.bio</span> records.
      </figcaption>
    </figure>
  </section>

  <!-- Entity descriptions, grouped by role -->
  <section class="mb-12">
    <h2>Lexicons for protocol authors</h2>
    <p>These records belong to people who author the protocols on Cuanto. SurveyProtocol is more akin to a DwC Protocol than a DwC Survey Protocol, the latter being more of a join model. The Cuanto ProtocolTarget has no analog in Darwin Core, but since protocol authors and surveyors can be different people on Cuanto, we needed a separate lexicon to specify what protocol authors want people to look for. The scope concept also derives from a previous DwC-related Humboldt Extension spec, but should be compatible with the current DwC-CM.</p>
    <div class="grid gap-4 sm:grid-cols-2">
      {#each authors as e (e.nsid)}
        {@render entityCard(e)}
      {/each}
    </div>
  </section>

  <section class="mb-12">
    <h2>Lexicons for surveyors</h2>
    <p>
      These records belong to people who add surveys on Cuanto. Note that SurveyTarget duplicates a ProtocolTarget but belongs to the surveyor, so if the protocol author deletes or adds ProtocolTargets, the surveyor's copies remain in the surveyor's PDS and the Occurrences that reference them don't break. SurveyTarget is a closer analog to a DwC-CM Survey Target, except that there is only one record per user per ProtocolTarget, as opposed to one per Survey in DwC-CM, which would result in a lot of duplication (which does have to happen when exporting to DwC-DP).
    </p>

    <p>
      Note that non-detections are inferred from SurveyTargets. A species counts as not detected
      for a Survey if a SurveyTarget for it exists in the surveyor's PDS, was created before the
      Survey, and was not retired before the Survey took place. A SurveyTarget is retired when its
      corresponding ProtocolTarget is deleted by the protocol author.
    </p>

    <p>Occurrence and Identification are both reused from <a href="https://lexicons.bio">lexicons.bio</a>. The actual count lives in <code>organismQuantity</code> in the Occurrence.</p>
    <div class="grid gap-4 sm:grid-cols-2">
      {#each surveyors as e (e.nsid)}
        {@render entityCard(e)}
      {/each}
    </div>
  </section>

  <!-- Relationships -->
  <section>
    <h2>Relationships</h2>
    <p>
      The field on the referring record that carries each link.
    </p>
    <!--
      Five columns cannot fit a phone without horizontal scrolling, and Meaning
      is the first thing to scroll out of reach, so narrow screens get the same
      rows stacked as cards instead.
    -->
    <div class="flex flex-col gap-3 sm:hidden">
      {#each relationships as r (r.field)}
        <div class="bg-card rounded-lg border p-3">
          <div class="flex flex-wrap items-baseline gap-1.5 font-mono text-xs">
            <span>{r.from}</span>
            <span class="text-muted-foreground">&rarr;</span>
            <span>{r.to}</span>
          </div>
          <dl class="text-muted-foreground mt-2 flex flex-col gap-1 font-mono text-xs">
            <div class="flex justify-between gap-3">
              <dt>field</dt>
              <dd class="text-right break-all">{r.field}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt>cardinality</dt>
              <dd class="text-right tabular-nums">{r.card}</dd>
            </div>
          </dl>
          <p class="mt-2 text-sm">{r.note}</p>
        </div>
      {/each}
      <p class="text-muted-foreground text-sm">
        References marked <em>strongRef</em> pin an exact record version (CID + URI); the rest are
        plain AT-URIs.
      </p>
    </div>

    <div class="hidden overflow-x-auto rounded-lg border sm:block">
      <table class="w-full min-w-xl text-sm">
        <caption class="caption-bottom text-left px-3 py-4 text-muted-foreground">
          References marked
          <em>strongRef</em> pin an exact record version (CID + URI); the rest are plain AT-URIs.
        </caption>
        <thead>
          <tr class="border-border text-muted-foreground border-b text-left text-xs">
            <th class="px-3 py-2 font-medium">From</th>
            <th class="px-3 py-2 font-medium">To</th>
            <th class="px-3 py-2 font-medium">Reference field</th>
            <th class="px-3 py-2 font-medium whitespace-nowrap">Cardinality</th>
            <th class="px-3 py-2 font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {#each relationships as r (r.field)}
            <tr class="border-border/60 border-b last:border-b-0">
              <td class="px-3 py-2 font-mono text-xs">{r.from}</td>
              <td class="px-3 py-2 font-mono text-xs">
                {r.to}
              </td>
              <td class="text-muted-foreground px-3 py-2 font-mono text-xs">{r.field}</td>
              <td class="text-muted-foreground px-3 py-2 font-mono text-xs whitespace-nowrap tabular-nums"
                >{r.card}</td
              >
              <td class="px-3 py-2">{r.note}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</main>

<!--
  One SVG with a viewBox rather than absolutely positioned divs: the whole
  diagram then scales to whatever width it is given, so a narrow screen shrinks
  it instead of scrolling it, and text stays vector-crisp. `variant` only
  namespaces the arrowhead marker, since both renderings share this markup and
  duplicate element ids would collide.
-->
{#snippet diagram(layout: Layout, variant: string)}
  <svg
    viewBox="0 0 {layout.width} {layout.height}"
    width={layout.width}
    height={layout.height}
    role="img"
    aria-label="Diagram of how the Cuanto lexicon records reference each other. The
    Relationships table below lists every reference in text form."
  >
    <defs>
      <marker
        id="lex-arrow-{variant}"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
      </marker>
    </defs>

    <rect class="lane-author" width={layout.width} height={layout.dividerY} />
    <line class="lane-divider" x1="0" y1={layout.dividerY} x2={layout.width} y2={layout.dividerY} />
    <text class="lane-label" x="12" y="18">PROTOCOL AUTHORS</text>
    <text class="lane-label" x="12" y={layout.dividerY + 18}>SURVEYORS</text>

    <g class="edge-lines">
      {#each layout.edges as e (e.key)}
        <path
          d={e.d}
          marker-start={e.markerStart ? `url(#lex-arrow-${variant})` : undefined}
          marker-end={e.markerEnd ? `url(#lex-arrow-${variant})` : undefined}
        />
      {/each}
    </g>
    <g class="edge-labels">
      {#each layout.edges as e (`${e.key}~label`)}
        {#if e.label}
          <text x={e.labelX} y={e.labelY}>{e.label}</text>
        {/if}
      {/each}
    </g>

    {#each layout.nodes as n (n.name)}
      <g
        class="node"
        class:node-author={n.role === 'author'}
        class:node-shared={n.shared}
        transform="translate({n.x},{n.y})"
      >
        <rect width={n.w} height="56" rx="8" />
        <text class="nn" x={n.w / 2} y="22">{n.name}</text>
        <text class="nid" x={n.w / 2} y="38">{n.shared ? 'lexicons.bio' : 'cuanto'}</text>
      </g>
    {/each}
  </svg>
{/snippet}

{#snippet entityCard(e: EntityMeta)}
  {@const info = data.lexicons[e.nsid]}
  <!-- min-w-0: as a grid item this defaults to min-width:auto, so a long
       unbreakable field name would widen the track past the viewport. -->
  <div class="bg-card min-w-0 rounded-lg border p-4">
    <div class="flex items-baseline justify-between gap-2">
      <span class="font-semibold">{e.name}</span>
      {#if e.shared}
        <a href={`https://lexicons.bio/#/${e.name.split('.').pop()?.toLowerCase()}`} class="tag"
          >
            <CodeIcon size={12} />
            source
          </a
        >
      {:else}
        <a href={tangledUrl(e.nsid)} class="tag">
          <CodeIcon size={12} />
          source
        </a>
      {/if}
    </div>
    <div class="text-muted-foreground mt-0.5 font-mono text-xs break-all">{e.nsid}</div>
    <p class="text-muted-foreground mt-2 mb-3 text-sm">{info?.purpose ?? ''}</p>
    {@render fieldList(info?.fields ?? [])}
    {#each info?.subdefs ?? [] as sd (sd.name)}
      <div class="border-border/60 mt-3 border-t pt-3">
        <div class="font-mono text-xs font-semibold">#{sd.name}</div>
        <p class="text-muted-foreground mt-0.5 mb-2 text-xs">{sd.purpose}</p>
        {@render fieldList(sd.fields)}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet fieldList(fields: LexInfo['fields'])}
  <dl class="divide-border/60 divide-y font-mono text-xs">
    {#each fields as f (f.name)}
      <div class="flex justify-between gap-3 py-1">
        <!-- Field names are single camelCase tokens with no break opportunity,
             so they need an explicit one to wrap instead of overflowing. -->
        <dt class="min-w-0 [overflow-wrap:anywhere]">
          {f.name}{#if !f.required}<span class="text-muted-foreground/60">?</span>{/if}
        </dt>
        <dd class="text-muted-foreground shrink-0 text-right">{f.type}</dd>
      </div>
    {/each}
  </dl>
{/snippet}

<style>
  /*
    The wrapper carries the frame so the lane band's corners get clipped by the
    border radius; the SVG inside scales down to fit narrow screens. --diagram-w
    is the layout's natural width, set inline from the server-computed layout,
    and holds the diagram at 1:1 rather than blowing it up. Multiplying it here
    renders the diagram larger (text included) at any breakpoint, since the SVG
    scales freely.
  */
  .diagram {
    max-width: var(--diagram-w);
    margin-inline: auto;
    overflow: hidden;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .diagram svg {
    display: block;
    width: 100%;
    height: auto;
  }

  .lane-author {
    fill: var(--secondary);
  }

  .lane-divider {
    stroke: var(--border);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }

  .lane-label {
    fill: var(--muted-foreground);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  .edge-lines path {
    fill: none;
    stroke: var(--muted-foreground);
    stroke-width: 1.4;
    opacity: 0.85;
  }

  .edge-labels text {
    fill: var(--muted-foreground);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    text-anchor: middle;
    dominant-baseline: middle;
    paint-order: stroke;
    stroke: var(--card);
    stroke-width: 3px;
  }

  .node {
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.06));
  }

  .node rect {
    fill: var(--card);
    stroke: var(--border);
    stroke-width: 1;
  }

  .node text {
    text-anchor: middle;
  }

  .node .nn {
    fill: var(--card-foreground);
    font-size: 13px;
    font-weight: 600;
  }

  .node .nid {
    fill: var(--muted-foreground);
    font-family: ui-monospace, monospace;
    font-size: 10px;
  }

  .node-author rect {
    stroke: var(--primary);
  }

  .node-shared rect {
    stroke-dasharray: 4 3;
  }

  .tag {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5em;
    padding: 0 0.35rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: var(--muted-foreground);
    white-space: nowrap;
  }
</style>
