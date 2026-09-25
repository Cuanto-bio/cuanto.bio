<script lang="ts">
import { type UserTextSegment, userTextSegments } from '$lib/userText';

// Free text a user typed, with **bold**, *italic* and bare-URL links. See
// $lib/userText for what is (deliberately not much) supported.
interface Props {
  text: string;
  class?: string;
}

let { text, class: className }: Props = $props();

const segments = $derived(userTextSegments(text));
</script>

{#snippet content(segment: UserTextSegment)}{#if segment.type === 'link'}<a href={segment.url} target="_blank" rel="noopener noreferrer">{segment.text}</a>{:else}{segment.value}{/if}{/snippet}

<!--
  Kept on one line on purpose: this element is whitespace-pre-wrap (so the
  user's own line breaks survive), which would also render any whitespace the
  template put between these tags.
-->
<p class={['whitespace-pre-wrap', className]}>{#each segments as segment, i (i)}{#if segment.strong && segment.em}<strong><em>{@render content(segment)}</em></strong>{:else if segment.strong}<strong>{@render content(segment)}</strong>{:else if segment.em}<em>{@render content(segment)}</em>{:else}{@render content(segment)}{/if}{/each}</p>
