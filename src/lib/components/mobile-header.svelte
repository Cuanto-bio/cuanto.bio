<script lang="ts">
import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
import { page } from '$app/state';
import { BASE_ROUTES } from '$lib/nav-tabs';
import { nav } from '$lib/navigation.svelte';

function backNeeded(currentHref: string) {
  return (
    !BASE_ROUTES.includes(currentHref) &&
    !BASE_ROUTES.includes(`${currentHref}/`)
  );
}

function labelFromUrl(href: string): string | null {
  const p = new URL(href).pathname;
  if (p === '/protocols' || p === '/protocols/') return 'Protocols';
  if (p === '/surveys' || p === '/surveys/') return 'Surveys';
  if (p === '/app/surveys' || p === '/app/surveys/') return 'Your Surveys';
  if (p === '/app/protocols/following') return 'Followed Protocols';
  if (p.startsWith('/surveys/')) return 'Survey';
  if (p.startsWith('/app/surveys/')) return 'Survey';
  if (p.startsWith('/protocols/')) return 'Protocol';
  if (p.startsWith('/app/protocols/')) return 'Protocol';
  return null;
}

// nav.previousUrl is the top of the in-session history stack (JS heap only,
// not persisted). It's null on first load or after a refresh.
const previousUrl = $derived(nav.previousUrl);
const label = $derived(
  previousUrl && backNeeded(page.url.pathname)
    ? labelFromUrl(previousUrl)
    : null,
);
</script>

{#if previousUrl && label}
  <div class="mobile-header bg-muted border-border border-b">
    <a
      href={previousUrl}
      class="inline-flex items-center gap-0.5 text-[0.8125rem] font-bold no-underline transition-opacity hover:opacity-75"
      style="color: var(--sidebar-primary)"
    >
      <ChevronLeftIcon size={16} />
      {label}
    </a>
  </div>
{/if}

<style>
  /* Only what Tailwind can't express: pointer: coarse gating */
  .mobile-header {
    display: none;
  }

  @media (max-width: 767px) and (pointer: coarse) {
    .mobile-header {
      display: flex;
      height: 36px;
      align-items: center;
      padding: 0 12px;
    }
  }
</style>
